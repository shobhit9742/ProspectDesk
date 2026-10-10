import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  Inbox,
  Mail,
  MailOpen,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  X,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, post, date } from "./api";
import { Button, Empty, ErrorBox, Field } from "./ui";
type Compose = {
  id?: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  replyMessageId?: string;
  key: string;
};
const blank = (): Compose => ({
  accountId: "",
  to: "",
  subject: "",
  body: "",
  key: crypto.randomUUID(),
});
export default function Unibox() {
  const qc = useQueryClient(),
    location = useLocation(),
    navigate = useNavigate();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<any[]>("/accounts"),
  });
  const composerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<() => void>(() => {});
  const [accountId, setAccount] = useState(""),
    [folder, setFolder] = useState("all"),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [compose, setCompose] = useState<Compose | null>(null),
    [sending, setSending] = useState(false),
    [saving, setSaving] = useState(false),
    [syncing, setSyncing] = useState(false),
    [sendError, setSendError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const [deleting, setDeleting] = useState(""),
    [confirmDelete, setConfirmDelete] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!compose || !(compose.to || compose.subject || compose.body)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [compose]);
  useEffect(() => {
    setPage(1);
    setSelected("");
  }, [accountId, folder, debounced]);
  useEffect(() => {
    if (location.state?.compose) {
      setCompose({ ...blank(), ...location.state.compose });
      navigate("/unibox", { replace: true, state: null });
    }
  }, [location.state, navigate]);
  useEffect(() => {
    if (!compose) return;
    const previous = document.activeElement as HTMLElement;
    const root = composerRef.current;
    const selector =
      "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)";
    root?.querySelector<HTMLElement>(selector)?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending && !saving) {
        closeRef.current();
        return;
      }
      if (e.key === "Tab") {
        const fields = Array.from(
          root?.querySelectorAll<HTMLElement>(selector) || [],
        );
        const first = fields[0],
          last = fields.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [!!compose, sending, saving]);
  const threads = useQuery({
    refetchInterval: 30000,
    queryKey: ["threads", accountId, folder, debounced, page],
    queryFn: () =>
      api(
        `/threads?${new URLSearchParams({ ...(accountId ? { accountId } : {}), folder: folder === "drafts" ? "all" : folder, search: debounced, page: String(page) })}`,
      ),
  });
  const messages = useQuery({
    queryKey: ["thread", selected],
    queryFn: () => api<any[]>(`/thread?key=${encodeURIComponent(selected)}`),
    enabled: !!selected,
    refetchInterval: 30000,
  });
  const drafts = useQuery({
    queryKey: ["drafts"],
    queryFn: () => api<any[]>("/drafts"),
  });
  const visibleDrafts =
    drafts.data?.filter(
      (draft: any) =>
        (!accountId || draft.accountId === accountId) &&
        (!debounced ||
          `${draft.to} ${draft.subject} ${draft.body}`
            .toLowerCase()
            .includes(debounced.toLowerCase())),
    ) || [];
  const currentAccount = (id: string) =>
    accounts.data?.find((a: any) => a._id === id);
  const latest = messages.data?.at(-1);
  async function sync() {
    setSyncing(true);
    try {
      const result = await post(
        accountId ? `/accounts/${accountId}/sync` : "/sync",
      );
      const errors = result.results?.filter((r: any) => r.error) || [];
      errors.length
        ? toast.error(`${errors.length} mailbox connection(s) need attention.`)
        : toast.success("Mailbox synchronization complete.");
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["thread"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }
  async function changeMessage(action: string) {
    if (!latest) return;
    try {
      await api(`/messages/${latest._id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      qc.invalidateQueries({ queryKey: ["thread"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      toast.success(
        action === "archive"
          ? "Message archived."
          : action === "restore"
            ? "Message restored to Inbox."
            : "Message status updated.",
      );
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  function reply() {
    const incoming = messages.data
      ?.filter((m: any) => m.folder !== "sent" && !m.isBounce)
      .at(-1);
    if (!incoming) {
      toast.info("There is no incoming message to reply to yet.");
      return;
    }
    const to = incoming.from.match(/<([^>]+)>/)?.[1] || incoming.from;
    setCompose({
      ...blank(),
      accountId: incoming.accountId,
      to,
      subject: incoming.subject.startsWith("Re:")
        ? incoming.subject
        : `Re: ${incoming.subject}`,
      body: "",
      replyMessageId: incoming._id,
    });
    setSendError("");
    setUncertain(false);
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!compose || sending || saving) return;
    setSending(true);
    setSendError("");
    let submitted = false;
    try {
      const draft = await post("/drafts", {
        id: compose.id,
        accountId: compose.accountId,
        to: compose.to,
        subject: compose.subject,
        body: compose.body,
        replyMessageId: compose.replyMessageId,
        key: compose.key,
      });
      const draftId = draft._id || compose.id;
      setCompose({ ...compose, id: draftId });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      submitted = true;
      const result = await post("/send", compose);
      toast.success("Message accepted by the sending provider.");
      if (result.warning) toast.warning(result.warning);
      if (draftId) {
        try {
          await api(`/drafts/${draftId}`, { method: "DELETE" });
        } catch {
          toast.warning(
            "Message accepted, but its saved draft could not be removed. Do not resend it.",
          );
        }
      }
      setCompose(null);
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["thread"] });
      qc.invalidateQueries({ queryKey: ["drafts"] });
    } catch (e: any) {
      setSendError(e.message);
      if (submitted && ![400, 404, 422, 429].includes(e.status)) {
        setUncertain(true);
        setSendError(
          `${e.message} This draft is retained. Check the provider's Sent folder and refresh before considering another send.`,
        );
      }
    } finally {
      setSending(false);
    }
  }
  async function save(closeAfter = false) {
    if (!compose || saving || sending) return;
    setSaving(true);
    try {
      const draft = await post("/drafts", {
        id: compose.id,
        accountId: compose.accountId || undefined,
        to: compose.to,
        subject: compose.subject,
        body: compose.body,
        replyMessageId: compose.replyMessageId,
        key: compose.key,
      });
      setCompose((current) =>
        current?.key === compose.key ? { ...current, id: draft._id } : current,
      );
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Draft saved in ProspectDesk.");
      if (closeAfter) setCompose(null);
    } catch (e: any) {
      setSendError(e.message);
    } finally {
      setSaving(false);
    }
  }
  closeRef.current = () => {
    if (sending || saving) return;
    if (compose && (compose.to || compose.subject || compose.body))
      void save(true);
    else setCompose(null);
  };
  async function deleteDraft(id: string) {
    setDeleting(id);
    try {
      await api(`/drafts/${id}`, { method: "DELETE" });
      setConfirmDelete("");
      qc.invalidateQueries({ queryKey: ["drafts"] });
      toast.success("Draft deleted.");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting("");
    }
  }
  function newCompose() {
    setCompose({
      ...blank(),
      accountId: accountId || accounts.data?.[0]?._id || "",
    });
    setSendError("");
    setUncertain(false);
  }
  return (
    <div className="page unibox-page">
      <div className="page-heading">
        <div>
          <h1>Unibox</h1>
          <p>Every conversation. The right mailbox. One place.</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            busy={syncing}
            disabled={!accounts.data?.length}
            onClick={sync}
          >
            <RefreshCw size={16} />
            Refresh mail
          </Button>
          <Button onClick={newCompose}>
            <Plus size={17} />
            Compose
          </Button>
        </div>
      </div>
      <div className={`mail-workspace ${selected ? "has-selection" : ""}`}>
        <aside className="mail-folders">
          <h2>Mailboxes</h2>
          <button
            className={accountId === "" ? "active" : ""}
            onClick={() => setAccount("")}
          >
            <Inbox size={16} />
            All accounts
          </button>
          {accounts.data?.map((a: any) => (
            <button
              key={a._id}
              className={accountId === a._id ? "active" : ""}
              onClick={() => setAccount(a._id)}
            >
              <span className="account-dot" />
              <span className="truncate">{a.email}</span>
            </button>
          ))}
          {accounts.isError && <ErrorBox message={accounts.error.message} />}
          <hr />
          <h2>Views</h2>
          {[
            ["all", "All conversations", Inbox],
            ["inbox", "Inbox", Mail],
            ["sent", "Sent", Send],
            ["drafts", "Drafts", FilePenLine],
            ["archive", "Archived", Archive],
            ["junk", "Junk", AlertCircle],
            ["bounces", "Delivery notices", AlertCircle],
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              className={folder === id ? "active" : ""}
              onClick={() => setFolder(id)}
            >
              <Icon size={16} />
              {label}
              {id === "drafts" && !!visibleDrafts.length && (
                <span className="count">{visibleDrafts.length}</span>
              )}
            </button>
          ))}
          <div className="mail-folder-footer">
            <Button variant="quiet" onClick={() => navigate("/accounts")}>
              <Plus size={15} />
              Connect account
            </Button>
            <small>
              Refresh reads a bounded set of recent messages. No automatic
              sends.
            </small>
          </div>
        </aside>
        <section className="thread-list">
          <div className="thread-search">
            <Search size={17} />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="thread-list-heading">
            <strong>
              {folder === "drafts" ? "Saved drafts" : "Conversations"}
            </strong>
            <span>
              {folder === "drafts"
                ? visibleDrafts.length || 0
                : threads.data?.total || 0}
            </span>
          </div>
          {folder === "drafts" ? (
            <div>
              {drafts.isError && <ErrorBox message={drafts.error.message} />}
              {drafts.isPending && (
                <p className="list-loading">Loading drafts…</p>
              )}
              {visibleDrafts.map((d: any) => (
                <div key={d._id}>
                  <button
                    className="thread-item"
                    key={d._id}
                    onClick={() => {
                      setCompose({ ...blank(), ...d, id: d._id });
                      setSendError("");
                      setUncertain(!!d.sendStatus);
                      if (d.sendStatus)
                        setSendError(
                          `Previous submission: ${d.sendStatus}. Check the provider's Sent folder before creating a new message.`,
                        );
                    }}
                  >
                    <strong>{d.subject || "Untitled draft"}</strong>
                    <span>{d.to || "No recipient yet"}</span>
                    <p>{d.body.slice(0, 90) || "Empty draft"}</p>
                  </button>
                  <div className="draft-actions">
                    {d.sendStatus && (
                      <small className="notice">
                        Submission {d.sendStatus}
                      </small>
                    )}
                    {confirmDelete === d._id ? (
                      <>
                        <span>Delete this saved draft?</span>
                        <Button
                          variant="danger"
                          busy={deleting === d._id}
                          onClick={() => deleteDraft(d._id)}
                        >
                          Delete draft
                        </Button>
                        <button onClick={() => setConfirmDelete("")}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        aria-label={`Delete draft ${d.subject || "Untitled draft"}`}
                        onClick={() => setConfirmDelete(d._id)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!drafts.isPending &&
                !drafts.isError &&
                !visibleDrafts.length && (
                  <Empty icon={<FilePenLine size={25} />} title="No drafts yet">
                    Save a message before sending and return to it here.
                  </Empty>
                )}
            </div>
          ) : threads.isError ? (
            <ErrorBox message={threads.error.message} />
          ) : threads.isPending ? (
            <p className="list-loading">Loading conversations…</p>
          ) : threads.data?.items.length ? (
            <>
              <div className="thread-items">
                {threads.data.items.map((t: any) => (
                  <button
                    key={t._id}
                    className={`thread-item ${selected === t._id ? "selected" : ""} ${t.unread ? "unread" : ""}`}
                    onClick={() => setSelected(t._id)}
                  >
                    <div className="thread-top">
                      <strong>
                        {t.latest.folder === "sent"
                          ? t.latest.to.join(", ")
                          : t.latest.from}
                      </strong>
                      <small>{date(t.latest.date)}</small>
                    </div>
                    <span>{t.latest.subject}</span>
                    <p>{t.latest.body.slice(0, 110)}</p>
                    <div className="thread-bottom">
                      <small>{currentAccount(t.latest.accountId)?.email}</small>
                      {t.hasBounce ? (
                        <span className="badge warning">Delivery notice</span>
                      ) : (
                        <small>
                          {t.count} message{t.count === 1 ? "" : "s"}
                        </small>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="pagination">
                <button
                  aria-label="Previous page"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>Page {page}</span>
                <button
                  aria-label="Next page"
                  disabled={page * 30 >= threads.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <Empty icon={<Inbox size={27} />} title="No conversations here">
              {accounts.data?.length
                ? "Refresh your mailboxes, or try another view."
                : "Connect a mailbox to bring conversations here."}
            </Empty>
          )}
        </section>
        <section className="message-panel">
          {selected && latest ? (
            <>
              <div className="message-toolbar">
                <button
                  className="mobile-back"
                  aria-label="Back to conversations"
                  onClick={() => setSelected("")}
                >
                  <ArrowLeft size={18} />
                </button>
                <span>{currentAccount(latest.accountId)?.email}</span>
                <div>
                  <button
                    aria-label={
                      ["archive", "junk"].includes(latest.folder)
                        ? "Restore latest message to Inbox"
                        : "Archive latest message"
                    }
                    onClick={() =>
                      changeMessage(
                        ["archive", "junk"].includes(latest.folder)
                          ? "restore"
                          : "archive",
                      )
                    }
                  >
                    {["archive", "junk"].includes(latest.folder) ? (
                      <Inbox size={17} />
                    ) : (
                      <Archive size={17} />
                    )}
                  </button>
                  <button
                    aria-label={
                      latest.unread
                        ? "Mark latest message read"
                        : "Mark latest message unread"
                    }
                    onClick={() =>
                      changeMessage(latest.unread ? "read" : "unread")
                    }
                  >
                    {latest.unread ? (
                      <MailOpen size={17} />
                    ) : (
                      <Mail size={17} />
                    )}
                  </button>
                </div>
              </div>
              <div className="message-heading">
                <h2>{latest.subject}</h2>
                <span className="muted">
                  {messages.data?.length} messages in this conversation
                </span>
              </div>
              <div className="messages">
                {messages.data?.map((m: any) => (
                  <article className="message" key={m._id}>
                    <div className="message-meta">
                      <span className="avatar">
                        {m.from.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{m.from}</strong>
                        <small>To: {m.to.join(", ")}</small>
                      </div>
                      <time>{date(m.date)}</time>
                    </div>
                    {m.isBounce && (
                      <p className="notice warning">
                        Delivery notification. This is not a prospect reply.
                      </p>
                    )}
                    <div className="message-body">
                      {m.body || "(No plain-text body)"}
                    </div>
                    {m.status === "provider_accepted" && (
                      <p className="delivery-note">
                        Sending provider accepted this message. Delivery and
                        inbox placement are unconfirmed.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <div className="reply-bar">
                <Button variant="secondary" onClick={reply}>
                  <Reply size={16} />
                  Reply through this account
                </Button>
              </div>
            </>
          ) : messages.isError ? (
            <ErrorBox message={messages.error.message} />
          ) : (
            <Empty
              icon={<MailOpen size={40} />}
              title="Make room for the conversation"
            >
              Select a thread to read its messages and reply from the connected
              account.
            </Empty>
          )}
        </section>
      </div>
      {compose && (
        <div className="compose-backdrop">
          <section
            ref={composerRef}
            className="composer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-title"
          >
            <div className="panel-heading">
              <h2 id="compose-title">
                {compose.replyMessageId ? "Reply" : "New message"}
              </h2>
              <button
                aria-label="Close composer"
                disabled={sending || saving}
                onClick={() => closeRef.current()}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={send}>
              <div className="compose-fields">
                <Field label="Send from">
                  <select
                    required
                    value={compose.accountId}
                    disabled={!!compose.replyMessageId || sending || saving}
                    onChange={(e) =>
                      setCompose({ ...compose, accountId: e.target.value })
                    }
                  >
                    <option value="">Select a connected mailbox</option>
                    {accounts.data?.map((a: any) => (
                      <option key={a._id} value={a._id}>
                        {a.email}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="To">
                  <input
                    type="email"
                    required
                    value={compose.to}
                    readOnly={!!compose.replyMessageId}
                    disabled={sending || saving}
                    onChange={(e) =>
                      setCompose({ ...compose, to: e.target.value })
                    }
                  />
                </Field>
                <Field label="Subject">
                  <input
                    required
                    maxLength={250}
                    value={compose.subject}
                    readOnly={!!compose.replyMessageId}
                    disabled={sending || saving}
                    onChange={(e) =>
                      setCompose({ ...compose, subject: e.target.value })
                    }
                  />
                </Field>
                <Field label="Message">
                  <textarea
                    required
                    rows={9}
                    disabled={sending || saving}
                    value={compose.body}
                    onChange={(e) =>
                      setCompose({ ...compose, body: e.target.value })
                    }
                  />
                </Field>
                <ErrorBox message={sendError} persistent={uncertain} />
                {!accounts.data?.length && (
                  <p className="notice">
                    Connect a mailbox before sending. You can save this as a
                    draft.
                  </p>
                )}
                <p className="muted">
                  Closing the composer or pressing Escape saves your text as a
                  draft. Sending submits this message through the selected
                  mailbox. Review the recipient and content first.
                </p>
              </div>
              <div className="composer-footer">
                <Button
                  variant="secondary"
                  type="button"
                  busy={saving}
                  disabled={sending}
                  onClick={() => save()}
                >
                  <FilePenLine size={16} />
                  Save draft
                </Button>
                <Button
                  type="submit"
                  busy={sending}
                  disabled={!compose.accountId || uncertain || saving}
                >
                  <Send size={16} />
                  Send message
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
