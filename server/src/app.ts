import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import MongoStore from "connect-mongo";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { config } from "./config.js";
import { Account, Draft, Message, Scan, SendAttempt, User } from "./models.js";
import { AppError, encrypt, safeError } from "./security.js";
import { scanWebsite } from "./scanner.js";
import { generateContext } from "./context.js";
import { generateEmailVariations } from "./emails.js";
import {
  sendMessage,
  syncAccount,
  updateRemoteMessage,
  verifySmtp,
} from "./mail.js";
declare module "express-session" {
  interface SessionData {
    userId: string;
    oauth?: { state: string; provider: string; expires: number };
  }
}
const asyncRoute = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const userView = (user: any) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
});
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record id.");
const smtpSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(100),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
  smtpHost: z.string().min(3).max(200),
  smtpPort: z.union([z.literal(465), z.literal(587)]),
  imapHost: z.string().min(3).max(200),
  imapPort: z.literal(993),
});
const sendSchema = z.object({
  accountId: idSchema,
  to: z.email(),
  subject: z
    .string()
    .min(1)
    .max(250)
    .refine((s) => !/[\r\n]/.test(s)),
  body: z.string().min(1).max(100000),
  replyMessageId: idSchema.optional(),
  key: z.string().uuid(),
});
const localScanLocks = new Set<string>();
export function createApp(options: { sessionStore?: session.Store } = {}) {
  const app = express();
  if (config.production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(cors({ origin: config.appUrl, credentials: true }));
  app.use(express.json({ limit: "256kb" }));
  app.use(
    session({
      secret: config.sessionSecret || "test-session-secret-only",
      name: "prospectdesk.sid",
      resave: false,
      saveUninitialized: false,
      store:
        options.sessionStore || MongoStore.create({ mongoUrl: config.mongo }),
      cookie: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  // Protect cookie-authenticated mutations, including requests without an Origin header.
  app.use("/api", (req, res, next) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers["x-prospectdesk"] !== "1"
    ) {
      res.status(403).json({ error: "Missing request protection header." });
      return;
    }
    if (req.headers.origin && req.headers.origin !== config.appUrl) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, app: "ProspectDesk" }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts. Try again later." },
  });
  app.post(
    "/api/auth/register",
    authLimit,
    asyncRoute(async (req: any, res: any) => {
      const data = z
        .object({
          name: z.string().min(2).max(80),
          email: z.email(),
          password: z.string().min(10).max(128),
        })
        .parse(req.body);
      const email = data.email.toLowerCase();
      if (await User.exists({ email }))
        throw new AppError(
          409,
          "An account already exists with this email. Sign in instead.",
        );
      const user = await User.create({
        ...data,
        email,
        passwordHash: await bcrypt.hash(data.password, 12),
        password: undefined,
      });
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((e: any) => (e ? reject(e) : resolve())),
      );
      req.session.userId = String(user._id);
      res.status(201).json(userView(user));
    }),
  );
  app.post(
    "/api/auth/login",
    authLimit,
    asyncRoute(async (req: any, res: any) => {
      const data = z
        .object({ email: z.email(), password: z.string().min(1).max(128) })
        .parse(req.body);
      const user = await User.findOne({ email: data.email.toLowerCase() });
      if (
        !user?.passwordHash ||
        !(await bcrypt.compare(data.password, user.passwordHash))
      )
        throw new AppError(401, "Email or password is incorrect.");
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((e: any) => (e ? reject(e) : resolve())),
      );
      req.session.userId = String(user._id);
      res.json(userView(user));
    }),
  );
  app.post(
    "/api/auth/logout",
    asyncRoute(async (req: any, res: any) => {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((e: any) => (e ? reject(e) : resolve())),
      );
      res.clearCookie("prospectdesk.sid");
      res.json({ ok: true });
    }),
  );
  app.use("/api", (req, res, next) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    next();
  });
  app.get(
    "/api/auth/me",
    asyncRoute(async (req: any, res: any) => {
      const user = await User.findById(req.session.userId);
      if (!user) throw new AppError(401, "Sign in to continue.");
      res.json(userView(user));
    }),
  );
  app.get("/api/config", (_req, res) =>
    res.json({
      google: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      microsoft: !!(
        process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
      ),
      ai: !!process.env.AI_API_KEY,
      smtp: !!config.credentialKey,
    }),
  );
  app.get(
    "/api/scans",
    asyncRoute(async (req: any, res: any) =>
      res.json(
        await Scan.find({ userId: req.session.userId })
          .select("-pages.text")
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
      ),
    ),
  );
  app.get(
    "/api/scans/:id",
    asyncRoute(async (req: any, res: any) => {
      const scan = await Scan.findOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      }).lean();
      if (!scan) throw new AppError(404, "Scan not found.");
      res.json(scan);
    }),
  );
  app.post(
    "/api/scans",
    asyncRoute(async (req: any, res: any) => {
      const { url, force } = z
        .object({
          url: z.string().min(3).max(2000),
          force: z.boolean().optional(),
        })
        .parse(req.body);
      if (localScanLocks.has(req.session.userId))
        throw new AppError(
          409,
          "A scan is already running. Wait for it to finish.",
        );
      if (!force) {
        const cached = await Scan.findOne({
          userId: req.session.userId,
          inputUrl: url,
          createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
        }).lean();
        if (cached) {
          res.json({ ...cached, cached: true });
          return;
        }
      }
      localScanLocks.add(req.session.userId);
      try {
        const result = await scanWebsite(url);
        const scan = await Scan.create({
          ...result,
          userId: req.session.userId,
          inputUrl: url,
          contexts: [],
        });
        res.status(201).json(scan);
      } finally {
        localScanLocks.delete(req.session.userId);
      }
    }),
  );
  app.post(
    "/api/scans/:id/context",
    asyncRoute(async (req: any, res: any) => {
      const scan = await Scan.findOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      });
      if (!scan) throw new AppError(404, "Scan not found.");
      const { objective } = z
        .object({ objective: z.string().trim().min(10).max(2000) })
        .parse(req.body);
      const result = {
        ...(await generateContext(scan, objective)),
        id: randomUUID(),
      };
      scan.contexts = [
        ...scan.contexts.slice(-9),
        { ...result, createdAt: new Date() },
      ];
      await scan.save();
      res.json(result);
    }),
  );
  app.post(
    "/api/scans/:id/context/edit",
    asyncRoute(async (req: any, res: any) => {
      const data = z
        .object({
          objective: z.string().min(10).max(2000),
          contextId: z.string().uuid().optional(),
          points: z.array(z.string().trim().min(1).max(5000)).min(1).max(3),
        })
        .parse(req.body);
      const scan = await Scan.findOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      });
      if (!scan) throw new AppError(404, "Scan not found.");
      const original: any = [...scan.contexts]
        .reverse()
        .find(
          (context: any) =>
            context.objective === data.objective &&
            (!data.contextId || context.id === data.contextId),
        );
      if (!original || original.points.length !== data.points.length)
        throw new AppError(
          409,
          "Generate context for this objective before saving edits.",
        );
      const result = {
        ...original,
        edited: true,
        createdAt: new Date(),
        notice:
          "Edited research draft. Source links are retained; review your changes against the original evidence.",
        points: original.points.map((point: any, i: number) => ({
          ...point,
          text: data.points[i],
        })),
      };
      scan.contexts = [...scan.contexts.slice(-9), result];
      await scan.save();
      res.json(result);
    }),
  );
  app.post(
    "/api/scans/:id/emails",
    asyncRoute(async (req: any, res: any) => {
      const scan = await Scan.findOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      });
      if (!scan) throw new AppError(404, "Scan not found.");
      const data = z
        .object({
          recipient: z.string().trim().email(),
          objective: z.string().trim().min(10).max(2000),
          points: z.array(z.string().trim().min(1).max(5000)).min(1).max(3),
        })
        .parse(req.body);
      res.json({
        ...(await generateEmailVariations(
          scan.company || "the company",
          data.objective,
          data.points,
        )),
        recipient: data.recipient,
      });
    }),
  );
  app.get(
    "/api/accounts",
    asyncRoute(async (req: any, res: any) =>
      res.json(
        await Account.find({ userId: req.session.userId })
          .sort({ createdAt: 1 })
          .lean(),
      ),
    ),
  );
  app.post(
    "/api/accounts/smtp",
    asyncRoute(async (req: any, res: any) => {
      const data = smtpSchema.parse(req.body);
      await verifySmtp(data);
      const account = await Account.findOneAndUpdate(
        { userId: req.session.userId, email: data.email.toLowerCase() },
        {
          $set: {
            name: data.name,
            provider: "smtp",
            status: "connected",
            encrypted: encrypt(data),
            lastError: "",
          },
        },
        { upsert: true, new: true },
      );
      const view = account!.toObject();
      delete view.encrypted;
      res.status(201).json(view);
    }),
  );
  app.delete(
    "/api/accounts/:id",
    asyncRoute(async (req: any, res: any) => {
      const accountId = idSchema.parse(req.params.id),
        query = { accountId, userId: req.session.userId };
      if (
        !(await Account.findOne({ _id: accountId, userId: req.session.userId }))
      )
        throw new AppError(404, "Account not found.");
      await Account.deleteOne({ _id: accountId, userId: req.session.userId });
      await Message.deleteMany(query);
      await Draft.deleteMany(query);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/accounts/:id/sync",
    asyncRoute(async (req: any, res: any) => {
      const id = idSchema.parse(req.params.id);
      if (!(await Account.exists({ _id: id, userId: req.session.userId })))
        throw new AppError(404, "Account not found.");
      res.json(await syncAccount(id, req.session.userId));
    }),
  );
  app.post(
    "/api/sync",
    asyncRoute(async (req: any, res: any) => {
      const accounts = await Account.find({ userId: req.session.userId });
      const results = [];
      for (const a of accounts) {
        try {
          results.push(await syncAccount(String(a._id), req.session.userId));
        } catch (e) {
          results.push({ accountId: String(a._id), error: safeError(e) });
        }
      }
      res.json({ results });
    }),
  );
  app.get(
    "/api/oauth/:provider/start",
    asyncRoute(async (req: any, res: any) => {
      const provider = z
          .enum(["google", "microsoft"])
          .parse(req.params.provider),
        google = provider === "google";
      const clientId = google
        ? process.env.GOOGLE_CLIENT_ID
        : process.env.MICROSOFT_CLIENT_ID;
      if (!clientId)
        throw new AppError(
          503,
          `${google ? "Google" : "Microsoft"} OAuth is not configured. Add this project's client credentials first.`,
        );
      const state = randomBytes(24).toString("hex");
      req.session.oauth = {
        state,
        provider,
        expires: Date.now() + 10 * 60 * 1000,
      };
      const redirectUri = `${config.apiUrl}/api/oauth/${provider}/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: google
          ? "openid email https://www.googleapis.com/auth/gmail.modify"
          : "offline_access User.Read Mail.ReadWrite Mail.Send",
        ...(google
          ? { access_type: "offline", prompt: "consent" }
          : { prompt: "select_account" }),
      });
      const url = google
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/authorize`;
      res.redirect(`${url}?${params}`);
    }),
  );
  app.get(
    "/api/oauth/:provider/callback",
    asyncRoute(async (req: any, res: any) => {
      const flow = req.session.oauth;
      delete req.session.oauth;
      if (
        !flow ||
        flow.provider !== req.params.provider ||
        flow.state !== req.query.state ||
        flow.expires < Date.now()
      )
        throw new AppError(
          400,
          "OAuth request expired or does not match. Start the connection again.",
        );
      if (req.query.error) {
        res.redirect(`${config.appUrl}/accounts?connection=cancelled`);
        return;
      }
      const code = z.string().min(1).parse(req.query.code),
        google = flow.provider === "google";
      const tokenUrl = google
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: (google
          ? process.env.GOOGLE_CLIENT_ID
          : process.env.MICROSOFT_CLIENT_ID)!,
        client_secret: (google
          ? process.env.GOOGLE_CLIENT_SECRET
          : process.env.MICROSOFT_CLIENT_SECRET)!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${config.apiUrl}/api/oauth/${flow.provider}/callback`,
      });
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenResponse.ok)
        throw new AppError(
          502,
          "The provider could not complete authorization. Reconnect the account.",
        );
      const token: any = await tokenResponse.json();
      if (!token.refresh_token)
        throw new AppError(
          422,
          "No offline-access token was returned. Reconnect and grant the requested mailbox access.",
        );
      const profileResponse = await fetch(
        google
          ? "https://www.googleapis.com/oauth2/v2/userinfo"
          : "https://graph.microsoft.com/v1.0/me",
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!profileResponse.ok)
        throw new AppError(502, "Could not identify the connected mailbox.");
      const profile: any = await profileResponse.json(),
        email = z
          .email()
          .parse(
            google ? profile.email : profile.mail || profile.userPrincipalName,
          )
          .toLowerCase();
      await Account.findOneAndUpdate(
        { userId: req.session.userId, email },
        {
          $set: {
            name: profile.name || profile.displayName || email,
            provider: flow.provider,
            status: "connected",
            lastError: "",
            encrypted: encrypt({
              accessToken: token.access_token,
              refreshToken: token.refresh_token,
              expiresAt: Date.now() + token.expires_in * 1000,
            }),
          },
        },
        { upsert: true, new: true },
      );
      res.redirect(`${config.appUrl}/accounts?connection=success`);
    }),
  );
  app.get(
    "/api/threads",
    asyncRoute(async (req: any, res: any) => {
      const params = z
        .object({
          accountId: idSchema.optional(),
          folder: z
            .enum(["all", "inbox", "sent", "archive", "junk", "bounces"])
            .default("all"),
          search: z.string().max(200).default(""),
          page: z.coerce.number().int().min(1).default(1),
        })
        .parse(req.query);
      const match: any = { userId: req.session.userId };
      if (params.accountId) match.accountId = params.accountId;
      if (params.folder !== "all" && params.folder !== "bounces")
        match.folder = params.folder;
      if (params.folder === "bounces") match.isBounce = true;
      if (params.search) {
        const regex = params.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        match.$or = [
          { subject: { $regex: regex, $options: "i" } },
          { from: { $regex: regex, $options: "i" } },
          { to: { $regex: regex, $options: "i" } },
        ];
      }
      const grouped = await Message.aggregate([
        { $match: match },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: "$threadKey",
            latest: { $first: "$$ROOT" },
            count: { $sum: 1 },
            unread: { $sum: { $cond: ["$unread", 1, 0] } },
            hasBounce: { $max: "$isBounce" },
          },
        },
        { $sort: { "latest.date": -1 } },
        {
          $facet: {
            items: [{ $skip: (params.page - 1) * 30 }, { $limit: 30 }],
            total: [{ $count: "count" }],
          },
        },
      ]);
      res.json({
        items: grouped[0]?.items || [],
        total: grouped[0]?.total[0]?.count || 0,
        page: params.page,
      });
    }),
  );
  app.get(
    "/api/thread",
    asyncRoute(async (req: any, res: any) => {
      const key = z.string().max(500).parse(req.query.key);
      res.json(
        await Message.find({ userId: req.session.userId, threadKey: key })
          .sort({ date: 1 })
          .lean(),
      );
    }),
  );
  app.patch(
    "/api/messages/:id",
    asyncRoute(async (req: any, res: any) => {
      const { action } = z
        .object({ action: z.enum(["read", "unread", "archive", "restore"]) })
        .parse(req.body);
      const message = await Message.findOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      });
      if (!message) throw new AppError(404, "Message not found.");
      const account = await Account.findOne({
        _id: message.accountId,
        userId: req.session.userId,
      }).select("+encrypted");
      if (!account) throw new AppError(404, "Mailbox not found.");
      await updateRemoteMessage(account, message, action);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/send",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 10,
      message: { error: "Please wait before sending more messages." },
    }),
    asyncRoute(async (req: any, res: any) => {
      const data = sendSchema.parse(req.body);
      const account = await Account.findOne({
        _id: data.accountId,
        userId: req.session.userId,
      }).select("+encrypted");
      if (!account) throw new AppError(404, "Mailbox not found.");
      let original: any = null;
      if (data.replyMessageId) {
        original = await Message.findOne({
          _id: data.replyMessageId,
          userId: req.session.userId,
          accountId: data.accountId,
        });
        if (!original)
          throw new AppError(
            404,
            "Original message not found in this account.",
          );
        if (original.isBounce)
          throw new AppError(422, "Do not reply to a delivery notification.");
        const address =
          (original.from || "").match(/<([^>]+)>/)?.[1] || original.from;
        if (address.toLowerCase() !== data.to.toLowerCase())
          throw new AppError(
            400,
            "Reply recipient must match the original sender.",
          );
        if (
          original.subject !== data.subject &&
          `Re: ${original.subject}` !== data.subject
        )
          throw new AppError(400, "Keep the original subject when replying.");
      }
      const previous = await SendAttempt.findOne({
        userId: req.session.userId,
        key: data.key,
      });
      if (previous)
        throw new AppError(
          409,
          `This send request is already ${previous.status}. Check Sent and synchronize before deciding to resend.`,
        );
      try {
        await SendAttempt.create({
          userId: req.session.userId,
          key: data.key,
          status: "submitting",
        });
      } catch (e: any) {
        if (e.code === 11000)
          throw new AppError(409, "This send request is already processing.");
        throw e;
      }
      try {
        const result = await sendMessage(account, {
          ...data,
          replyTo: original,
        });
        await SendAttempt.updateOne(
          { userId: req.session.userId, key: data.key },
          {
            $set: { status: "provider_accepted", messageId: result.messageId },
          },
        );
        res.json(result);
      } catch (e) {
        await SendAttempt.updateOne(
          { userId: req.session.userId, key: data.key },
          { $set: { status: "uncertain" } },
        );
        throw new AppError(
          502,
          `${safeError(e)} Submission may be uncertain. Check the provider's Sent folder before retrying.`,
        );
      }
    }),
  );
  app.get(
    "/api/drafts",
    asyncRoute(async (req: any, res: any) => {
      const drafts = await Draft.find({ userId: req.session.userId })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
      const attempts = await SendAttempt.find({
        userId: req.session.userId,
        key: { $in: drafts.map((draft: any) => draft.key).filter(Boolean) },
      }).lean();
      res.json(
        drafts.map((draft: any) => ({
          ...draft,
          sendStatus: attempts.find((attempt: any) => attempt.key === draft.key)
            ?.status,
        })),
      );
    }),
  );
  app.post(
    "/api/drafts",
    asyncRoute(async (req: any, res: any) => {
      const data = z
        .object({
          id: idSchema.optional(),
          accountId: idSchema.optional(),
          replyMessageId: idSchema.optional(),
          key: z.string().uuid().optional(),
          to: z.string().max(300),
          subject: z.string().max(250),
          body: z.string().max(100000),
        })
        .parse(req.body);
      const { id, ...fields } = data;
      if (
        fields.accountId &&
        !(await Account.exists({
          _id: fields.accountId,
          userId: req.session.userId,
        }))
      )
        throw new AppError(404, "Account not found.");
      if (id) {
        const draft = await Draft.findOneAndUpdate(
          { _id: id, userId: req.session.userId },
          {
            $set: fields,
            ...(!fields.accountId ? { $unset: { accountId: 1 } } : {}),
          },
          { new: true },
        );
        if (!draft) throw new AppError(404, "Draft not found.");
        res.json(draft);
      } else
        res
          .status(201)
          .json(await Draft.create({ ...fields, userId: req.session.userId }));
    }),
  );
  app.delete(
    "/api/drafts/:id",
    asyncRoute(async (req: any, res: any) => {
      await Draft.deleteOne({
        _id: idSchema.parse(req.params.id),
        userId: req.session.userId,
      });
      res.json({ ok: true });
    }),
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });
  const clientDist = path.resolve(process.cwd(), "../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(clientDist, "index.html")),
    );
  }
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: err.issues
          .map((i: any) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    if (err.code === 11000) {
      res.status(409).json({ error: "This record already exists." });
      return;
    }
    res.status(err.status || 500).json({
      error: err.status
        ? safeError(err)
        : "The operation could not be completed. Try again or check the server configuration.",
    });
  });
  return app;
}
