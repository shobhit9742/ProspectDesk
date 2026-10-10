import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import { Account, Message } from "./models.js";
import {
  AppError,
  decrypt,
  encrypt,
  publicHost,
  safeError,
} from "./security.js";

export function normalizeMessageId(value: string) {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}
export function detectBounce(from: string, subject: string, contentType = "") {
  return (
    /mailer-daemon|postmaster/i.test(from) ||
    /delivery status notification|undeliverable|delivery failure|mail delivery failed/i.test(
      subject,
    ) ||
    /multipart\/report/i.test(contentType)
  );
}
export async function storeMessage(
  userId: string,
  accountId: string,
  message: any,
) {
  const refs = (message.references || []).map(normalizeMessageId);
  const id = normalizeMessageId(message.messageId || message.externalId);
  let parent: any = null;
  if (refs.length)
    parent = await Message.findOne({
      userId,
      accountId,
      messageId: { $in: refs },
    })
      .sort({ date: 1 })
      .lean();
  const threadKey = message.providerThreadId
    ? `${accountId}:${message.providerThreadId}`
    : parent?.threadKey || `${accountId}:${refs[0] || id}`;
  // Never merge conversations using subject alone, or across accounts.
  const same = await Message.findOne({ accountId, userId, messageId: id });
  await Message.updateOne(
    same ? { _id: same._id } : { accountId, externalId: message.externalId },
    {
      $set: {
        ...message,
        userId,
        accountId,
        messageId: id,
        references: refs,
        threadKey,
      },
    },
    { upsert: true },
  );
}
async function smtpTransport(secrets: any) {
  const address = (await publicHost(secrets.smtpHost))[0];
  return nodemailer.createTransport({
    host: address.address,
    port: secrets.smtpPort,
    secure: secrets.smtpPort === 465,
    requireTLS: secrets.smtpPort !== 465,
    tls: { servername: secrets.smtpHost, rejectUnauthorized: true },
    auth: { user: secrets.username, pass: secrets.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}
async function imapClient(secrets: any) {
  const address = (await publicHost(secrets.imapHost))[0];
  const client = new ImapFlow({
    host: address.address,
    port: secrets.imapPort || 993,
    secure: true,
    servername: secrets.imapHost,
    auth: { user: secrets.username, pass: secrets.password },
    tls: { rejectUnauthorized: true },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    maxIdleTime: 15000,
  });
  // ImapFlow closes failed connections and rejects pending commands, but also
  // emits transport errors after login. Handle that event so a dropped mailbox
  // connection cannot terminate the API through EventEmitter's default behavior.
  client.on("error", () => {});
  return client;
}
export async function verifySmtp(secrets: any) {
  let transport: any;
  try {
    transport = await smtpTransport(secrets);
    await transport.verify();
  } catch (error) {
    throw mailboxConnectionError("SMTP", error);
  } finally {
    transport?.close();
  }
  let imap: ImapFlow | undefined;
  try {
    imap = await imapClient(secrets);
    await imap.connect();
  } catch (error) {
    throw mailboxConnectionError("IMAP", error);
  } finally {
    imap?.close();
  }
}
export function mailboxConnectionError(stage: "SMTP" | "IMAP", error: any) {
  const code = String(error?.code || ""),
    message = String(error?.message || "");
  let reason =
    "Connection failed. Check the hostname, TLS port, and provider settings.";
  if (/ENOTFOUND|EAI_AGAIN|ENODATA/.test(code + message))
    reason =
      "Hostname could not be resolved. Check the server address supplied by your mail provider.";
  else if (
    error?.responseCode === 535 ||
    error?.authenticationFailed ||
    /EAUTH|AUTHENTICATIONFAILED|authentication failed|invalid credentials|login failed/i.test(
      code + message,
    )
  )
    reason =
      "Authentication was rejected. Check the login username and mailbox/app password; your provider may require OAuth.";
  else if (/CERT|TLS|SSL|certificate|self.signed/i.test(code + message))
    reason =
      "TLS certificate validation failed. Use the provider's correct server hostname. Certificate verification remains enabled.";
  else if (/ETIMEDOUT|timeout|timed out/i.test(code + message))
    reason =
      "Connection timed out. Check the port and whether your network or provider blocks access.";
  else if (/ECONNREFUSED/.test(code + message))
    reason = "Connection refused. Check the server hostname and port.";
  else if (error instanceof AppError) reason = safeError(error);
  return new AppError(422, `${stage} verification failed: ${reason}`);
}
async function providerToken(account: any) {
  const secrets = decrypt(account.encrypted);
  if (secrets.expiresAt > Date.now() + 60000) return secrets.accessToken;
  const microsoft = account.provider === "microsoft";
  const body = new URLSearchParams({
    client_id: microsoft
      ? process.env.MICROSOFT_CLIENT_ID!
      : process.env.GOOGLE_CLIENT_ID!,
    client_secret: microsoft
      ? process.env.MICROSOFT_CLIENT_SECRET!
      : process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: secrets.refreshToken,
  });
  if (microsoft)
    body.set("scope", "offline_access User.Read Mail.ReadWrite Mail.Send");
  const url = microsoft
    ? `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/token`
    : "https://oauth2.googleapis.com/token";
  const response = await fetch(url, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError(
      401,
      "Mailbox authorization expired. Reconnect the account.",
    );
  const token: any = await response.json();
  const refreshed = encrypt({
    ...secrets,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || secrets.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  });
  await Account.updateOne(
    { _id: account._id },
    {
      $set: {
        encrypted: refreshed,
      },
    },
  );
  account.encrypted = refreshed;
  return token.access_token;
}
async function providerRequest(
  account: any,
  path: string,
  init: RequestInit = {},
) {
  const token = await providerToken(account);
  const base =
    account.provider === "google"
      ? "https://gmail.googleapis.com/gmail/v1/users/me/"
      : "https://graph.microsoft.com/v1.0/me/";
  const response = await fetch(base + path, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(account.provider === "microsoft"
        ? { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' }
        : {}),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 429 : 502,
      `Mailbox provider returned HTTP ${response.status}. ${response.status === 429 ? "Wait before retrying." : "Check account permissions or reconnect."}`,
    );
  return response.status === 204 || response.status === 202
    ? null
    : response.json();
}
function gmailBody(payload: any): string {
  if (payload.mimeType === "text/plain" && payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload.parts || []) {
    const text = gmailBody(part);
    if (text) return text;
  }
  return "";
}
async function syncGoogle(account: any, userId: string) {
  const list: any = await providerRequest(
    account,
    "messages?maxResults=50&q=" +
      encodeURIComponent("in:anywhere -in:trash -in:drafts"),
  );
  let count = 0;
  for (const item of list.messages || []) {
    const m: any = await providerRequest(
      account,
      `messages/${encodeURIComponent(item.id)}?format=full`,
    );
    const headers = Object.fromEntries(
      (m.payload.headers || []).map((h: any) => [
        h.name.toLowerCase(),
        h.value,
      ]),
    );
    const from = headers.from || "",
      to = headers.to || "";
    const folder = m.labelIds?.includes("SENT")
      ? "sent"
      : m.labelIds?.includes("INBOX")
        ? "inbox"
        : m.labelIds?.includes("SPAM")
          ? "junk"
          : "archive";
    let body = gmailBody(m.payload);
    if (!body) {
      const raw: any = await providerRequest(
        account,
        `messages/${encodeURIComponent(item.id)}?format=raw`,
      );
      const parsed = await simpleParser(Buffer.from(raw.raw, "base64url"));
      body = parsed.text || "";
    }
    await storeMessage(userId, String(account._id), {
      externalId: m.id,
      messageId: headers["message-id"] || m.id,
      references: (headers.references || headers["in-reply-to"] || "")
        .split(/\s+/)
        .filter(Boolean),
      providerThreadId: m.threadId,
      from,
      to: [to],
      subject: headers.subject || "(No subject)",
      body: body.slice(0, 100000),
      date: new Date(Number(m.internalDate)),
      folder,
      unread: m.labelIds?.includes("UNREAD") || false,
      isBounce: detectBounce(
        from,
        headers.subject || "",
        headers["content-type"],
      ),
      status: folder === "sent" ? "provider_accepted" : "received",
    });
    count++;
  }
  return count;
}
async function syncMicrosoft(account: any, userId: string) {
  let count = 0;
  for (const folder of ["inbox", "sentitems", "archive", "junkemail"]) {
    const data: any = await providerRequest(
      account,
      `mailFolders/${folder}/messages?$top=30&$orderby=receivedDateTime%20desc&$select=id,conversationId,internetMessageId,internetMessageHeaders,from,toRecipients,subject,body,receivedDateTime,isRead`,
    );
    for (const m of data.value || []) {
      const from = m.from?.emailAddress?.address || "",
        to = m.toRecipients?.map((r: any) => r.emailAddress.address) || [];
      const headers = Object.fromEntries(
        (m.internetMessageHeaders || []).map((h: any) => [
          h.name.toLowerCase(),
          h.value,
        ]),
      );
      await storeMessage(userId, String(account._id), {
        externalId: m.id,
        providerThreadId: m.conversationId,
        messageId: m.internetMessageId || m.id,
        references: (headers.references || headers["in-reply-to"] || "")
          .split(/\s+/)
          .filter(Boolean),
        from,
        to,
        subject: m.subject || "(No subject)",
        body: (m.body?.content || "").slice(0, 100000),
        date: new Date(m.receivedDateTime),
        folder:
          folder === "sentitems"
            ? "sent"
            : folder === "junkemail"
              ? "junk"
              : folder,
        unread: !m.isRead,
        isBounce: detectBounce(from, m.subject || ""),
        status: folder === "sentitems" ? "provider_accepted" : "received",
      });
      count++;
    }
  }
  return count;
}
async function syncImap(account: any, userId: string) {
  const imap = await imapClient(decrypt(account.encrypted));
  let count = 0;
  try {
    await imap.connect();
    const folders = await imap.list();
    const selected = folders.filter(
      (f) =>
        f.path === "INBOX" ||
        ["\\Sent", "\\Archive", "\\Junk"].includes(f.specialUse || ""),
    );
    // Collect each folder before storing; no additional IMAP commands during fetch iterator.
    for (const folder of selected) {
      const lock = await imap.getMailboxLock(folder.path, { readOnly: true });
      try {
        const mailbox = imap.mailbox;
        if (!mailbox || !mailbox.exists) continue;
        const range = `${Math.max(1, mailbox.exists - 49)}:*`;
        const collected: any[] = [];
        for await (const item of imap.fetch(range, {
          source: true,
          flags: true,
          envelope: true,
          uid: true,
        })) {
          if (!item.source || item.source.length > 2_000_000) continue;
          const m = await simpleParser(item.source);
          const recipients = Array.isArray(m.to)
            ? m.to.flatMap((a) => a.value.map((v) => v.address || ""))
            : m.to?.value.map((v) => v.address || "") || [];
          const from = m.from?.value[0]?.address || "";
          collected.push({
            externalId: `${folder.path}:${mailbox.uidValidity}:${item.uid}`,
            providerFolder: folder.path,
            providerUid: item.uid,
            messageId: m.messageId || `${folder.path}:${item.uid}`,
            references: [
              ...(typeof m.references === "string"
                ? [m.references]
                : m.references || []),
              ...(m.inReplyTo ? [m.inReplyTo] : []),
            ],
            from,
            to: recipients,
            subject: m.subject || "(No subject)",
            body: (m.text || "").slice(0, 100000),
            date: m.date || new Date(),
            folder:
              folder.path === "INBOX"
                ? "inbox"
                : folder.specialUse === "\\Sent"
                  ? "sent"
                  : folder.specialUse === "\\Junk"
                    ? "junk"
                    : "archive",
            unread: !item.flags?.has("\\Seen"),
            isBounce: detectBounce(
              from,
              m.subject || "",
              String(m.headers.get("content-type") || ""),
            ),
            status:
              folder.specialUse === "\\Sent" ? "provider_accepted" : "received",
          });
        }
        for (const m of collected) {
          await storeMessage(userId, String(account._id), m);
          count++;
        }
      } finally {
        lock.release();
      }
    }
    return count;
  } finally {
    imap.close();
  }
}
const syncing = new Set<string>();
export async function syncAccount(accountId: string, userId: string) {
  if (syncing.has(accountId))
    throw new AppError(409, "This account is already synchronizing.");
  const account = await Account.findOne({ _id: accountId, userId }).select(
    "+encrypted",
  );
  if (!account) throw new AppError(404, "Account not found.");
  syncing.add(accountId);
  try {
    const count =
      account.provider === "google"
        ? await syncGoogle(account, userId)
        : account.provider === "microsoft"
          ? await syncMicrosoft(account, userId)
          : await syncImap(account, userId);
    await Account.updateOne(
      { _id: accountId, userId },
      { $set: { status: "connected", lastSync: new Date(), lastError: "" } },
    );
    return { accountId, scanned: count };
  } catch (e) {
    const error = safeError(e);
    await Account.updateOne(
      { _id: accountId, userId },
      { $set: { status: "error", lastError: error } },
    );
    throw new AppError(502, error);
  } finally {
    syncing.delete(accountId);
  }
}
export async function sendMessage(
  account: any,
  input: { to: string; subject: string; body: string; replyTo?: any },
) {
  const original = input.replyTo;
  let messageId = `<${randomUUID()}@${account.email.split("@")[1]}>`;
  const references = original
    ? [...(original.references || []), original.messageId]
        .map((s: string) => `<${normalizeMessageId(s)}>`)
        .join(" ")
    : undefined;
  const mail = {
    from: account.email,
    to: input.to,
    subject: input.subject,
    text: input.body,
    messageId,
    ...(original
      ? { inReplyTo: `<${normalizeMessageId(original.messageId)}>`, references }
      : {}),
  };
  let externalId = messageId,
    providerThreadId = original?.providerThreadId,
    sentFolderWarning = "";
  if (account.provider === "google") {
    const composer = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const raw = await composer.sendMail(mail);
    const result: any = await providerRequest(account, "messages/send", {
      method: "POST",
      body: JSON.stringify({
        raw: Buffer.from(raw.message as Buffer).toString("base64url"),
        ...(providerThreadId ? { threadId: providerThreadId } : {}),
      }),
    });
    externalId = result.id;
    providerThreadId = result.threadId;
  } else if (account.provider === "microsoft") {
    const draft: any = original
      ? await providerRequest(
          account,
          `messages/${encodeURIComponent(original.externalId)}/createReply`,
          { method: "POST", body: "{}" },
        )
      : await providerRequest(account, "messages", {
          method: "POST",
          body: JSON.stringify({
            subject: input.subject,
            body: { contentType: "Text", content: input.body },
            toRecipients: [{ emailAddress: { address: input.to } }],
          }),
        });
    if (original)
      await providerRequest(
        account,
        `messages/${encodeURIComponent(draft.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            body: { contentType: "Text", content: input.body },
          }),
        },
      );
    await providerRequest(
      account,
      `messages/${encodeURIComponent(draft.id)}/send`,
      { method: "POST", body: "{}" },
    );
    externalId = draft.id;
    providerThreadId = draft.conversationId;
    messageId = draft.internetMessageId || messageId;
  } else {
    const secrets = decrypt(account.encrypted),
      transport = await smtpTransport(secrets);
    try {
      const info = await transport.sendMail(mail);
      if (!info.accepted?.length)
        throw new AppError(
          502,
          "The SMTP server did not accept the recipient.",
        );
    } finally {
      transport.close();
    }
    // Append after acceptance. Failure here must never trigger a second send.
    let imap: ImapFlow | undefined;
    try {
      imap = await imapClient(secrets);
      await imap.connect();
      const sent = (await imap.list()).find((f) => f.specialUse === "\\Sent");
      if (sent) {
        const composed = await nodemailer
          .createTransport({ streamTransport: true, buffer: true })
          .sendMail(mail);
        await imap.append(sent.path, composed.message as Buffer, ["\\Seen"]);
      } else
        sentFolderWarning =
          "SMTP accepted the message, but no Sent folder was found.";
    } catch {
      sentFolderWarning =
        "SMTP accepted the message, but saving the Sent-folder copy failed. Do not resend solely for this reason.";
    } finally {
      imap?.close();
    }
  }
  const record = {
    externalId,
    providerThreadId,
    messageId,
    references: original
      ? [...(original.references || []), original.messageId]
      : [],
    from: account.email,
    to: [input.to],
    subject: input.subject,
    body: input.body,
    date: new Date(),
    folder: "sent",
    unread: false,
    isBounce: false,
    status: "provider_accepted",
  };
  await storeMessage(account.userId, String(account._id), record);
  return {
    status: "provider_accepted",
    messageId,
    warning: sentFolderWarning,
    notice:
      "Accepted by the sending provider. Recipient delivery and inbox placement are not confirmed.",
  };
}
export async function updateRemoteMessage(
  account: any,
  message: any,
  action: "read" | "unread" | "archive" | "restore",
) {
  if (account.provider === "google")
    await providerRequest(
      account,
      `messages/${encodeURIComponent(message.externalId)}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          removeLabelIds:
            action === "read"
              ? ["UNREAD"]
              : action === "archive"
                ? ["INBOX"]
                : action === "restore"
                  ? ["SPAM"]
                  : [],
          addLabelIds:
            action === "unread"
              ? ["UNREAD"]
              : action === "restore"
                ? ["INBOX"]
                : [],
        }),
      },
    );
  else if (account.provider === "microsoft") {
    if (action === "archive" || action === "restore") {
      const moved: any = await providerRequest(
        account,
        `messages/${encodeURIComponent(message.externalId)}/move`,
        {
          method: "POST",
          body: JSON.stringify({
            destinationId: action === "restore" ? "inbox" : "archive",
          }),
        },
      );
      if (moved?.id) message.externalId = moved.id;
    } else
      await providerRequest(
        account,
        `messages/${encodeURIComponent(message.externalId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isRead: action === "read" }),
        },
      );
  } else {
    if (!message.providerUid || !message.providerFolder)
      throw new AppError(
        409,
        "Synchronize this sent message before changing its mailbox state.",
      );
    const imap = await imapClient(decrypt(account.encrypted));
    try {
      await imap.connect();
      const lock = await imap.getMailboxLock(message.providerFolder);
      try {
        if (action === "read")
          await imap.messageFlagsAdd(message.providerUid, ["\\Seen"], {
            uid: true,
          });
        else if (action === "unread")
          await imap.messageFlagsRemove(message.providerUid, ["\\Seen"], {
            uid: true,
          });
        else {
          const folder = (await imap.list()).find((f) =>
            action === "restore"
              ? f.path.toUpperCase() === "INBOX"
              : f.specialUse === "\\Archive",
          );
          if (!folder)
            throw new AppError(
              409,
              `This mailbox has no ${action === "restore" ? "Inbox" : "archive"} folder.`,
            );
          const moved = await imap.messageMove(
            message.providerUid,
            folder.path,
            { uid: true },
          );
          if (!moved || !moved.uidMap?.get(message.providerUid))
            throw new AppError(
              409,
              "Message moved, but its new UID was not returned. Synchronize before changing it again.",
            );
          const uid = moved.uidMap.get(message.providerUid)!;
          message.providerFolder = folder.path;
          message.providerUid = uid;
          message.externalId = `${folder.path}:${moved.uidValidity}:${uid}`;
        }
      } finally {
        lock.release();
      }
    } finally {
      imap.close();
    }
  }
  if (action === "archive") message.folder = "archive";
  else if (action === "restore") message.folder = "inbox";
  else message.unread = action === "unread";
  await message.save();
}
