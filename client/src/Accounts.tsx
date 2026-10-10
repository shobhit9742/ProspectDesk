import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Mail,
  Plus,
  RefreshCw,
  Link2,
  ShieldCheck,
  Server,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, post, date } from "./api";
import { Button, Empty, ErrorBox, Field } from "./ui";
export default function Accounts() {
  const qc = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<any[]>("/accounts"),
  });
  const settings = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config"),
  });
  const [params, setParams] = useSearchParams();
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(""),
    [error, setError] = useState(""),
    [disconnect, setDisconnect] = useState("");
  useEffect(() => {
    const result = params.get("connection");
    if (result) {
      result === "success"
        ? toast.success(
            "Mailbox connected. Synchronize it to load conversations.",
          )
        : toast.info("Mailbox connection was cancelled.");
      setParams({}, { replace: true });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    }
  }, [params, setParams, qc]);
  async function connect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post("/accounts/smtp", {
        ...form,
        smtpPort: Number(form.smtpPort),
        imapPort: 993,
      });
      setShow(false);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("SMTP and IMAP verified. Mailbox connected.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sync(id: string) {
    setSyncing(id);
    try {
      const result = await post(`/accounts/${id}/sync`);
      toast.success(
        `Synchronization complete. ${result.scanned} messages processed.`,
      );
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    } catch (e: any) {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } finally {
      setSyncing("");
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Connected Inboxes</h1>
          <p>Your accounts, ready for conversations inside ProspectDesk.</p>
        </div>
        <Button disabled={busy} onClick={() => setShow(!show)}>
          <Plus size={17} />
          Connect mailbox
        </Button>
      </div>
      <div className="connection-options">
        <div>
          <span className="provider-letter google">G</span>
          <div>
            <h3>Google / Gmail</h3>
            <p>Connect with Google authorization.</p>
          </div>
          <Button
            variant="secondary"
            disabled={!settings.data?.google}
            onClick={() => window.location.assign("/api/oauth/google/start")}
          >
            {settings.data?.google ? "Connect Google" : "Setup required"}
          </Button>
        </div>
        <div>
          <span className="provider-letter microsoft">M</span>
          <div>
            <h3>Microsoft / Outlook</h3>
            <p>Connect with Microsoft authorization.</p>
          </div>
          <Button
            variant="secondary"
            disabled={!settings.data?.microsoft}
            onClick={() => window.location.assign("/api/oauth/microsoft/start")}
          >
            {settings.data?.microsoft ? "Connect Microsoft" : "Setup required"}
          </Button>
        </div>
        <div>
          <span className="provider-letter">
            <Server size={21} />
          </span>
          <div>
            <h3>SMTP + IMAP</h3>
            <p>Use a mailbox or app password over TLS.</p>
          </div>
          <Button variant="secondary" onClick={() => setShow(true)}>
            Connect
          </Button>
        </div>
      </div>
      {settings.isError && <ErrorBox message={settings.error.message} />}
      {(!settings.data?.google || !settings.data?.microsoft) && (
        <p className="notice">
          OAuth connections require this app's client ID, client secret, and
          callback URL. See the setup guide in the README. SMTP/IMAP can be
          connected independently.
        </p>
      )}
      {show && (
        <section className="connect-form">
          <div className="panel-heading">
            <h2>Connect an SMTP / IMAP mailbox</h2>
            <button
              aria-label="Close mailbox form"
              disabled={busy}
              onClick={() => setShow(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={connect}>
            <div className="form-grid">
              <Field label="Display name">
                <input name="name" placeholder="Work mailbox" required />
              </Field>
              <Field label="Mailbox email">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@company.com"
                />
              </Field>
              <Field label="Login username">
                <input
                  name="username"
                  autoComplete="off"
                  required
                  placeholder="Usually your email address"
                />
              </Field>
              <Field label="Mailbox / app password">
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field label="SMTP hostname">
                <input
                  name="smtpHost"
                  required
                  placeholder="smtp.company.com"
                />
              </Field>
              <Field label="SMTP security">
                <select name="smtpPort" defaultValue="587">
                  <option value="587">Port 587 · STARTTLS required</option>
                  <option value="465">Port 465 · TLS</option>
                </select>
              </Field>
              <Field label="IMAP hostname">
                <input
                  name="imapHost"
                  required
                  placeholder="imap.company.com"
                />
              </Field>
              <Field label="IMAP security">
                <input value="Port 993 · TLS" disabled />
              </Field>
            </div>
            <p className="muted security-note">
              <ShieldCheck size={16} />
              Credentials are encrypted on the server. Connection verifies both
              sending and reading access without sending a message.
            </p>
            <ErrorBox message={error} />
            <div className="form-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setShow(false)}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                <Link2 size={16} />
                Verify & connect
              </Button>
            </div>
          </form>
        </section>
      )}
      <section className="account-section">
        <div className="panel-heading">
          <h2>Your mailboxes</h2>
          <span className="badge neutral">
            {accounts.data?.length || 0} connected
          </span>
        </div>
        {accounts.isPending ? (
          <p className="list-loading">Loading mailboxes…</p>
        ) : accounts.isError ? (
          <ErrorBox message={accounts.error.message} />
        ) : accounts.data?.length ? (
          <div className="account-list">
            {accounts.data.map((a: any) => (
              <article key={a._id} className="account-row">
                <span className="account-icon">
                  <Mail size={22} />
                </span>
                <div className="account-info">
                  <h3>{a.name}</h3>
                  <p>{a.email}</p>
                  <small>
                    {a.provider === "google"
                      ? "Google"
                      : a.provider === "microsoft"
                        ? "Microsoft"
                        : "SMTP / IMAP"}{" "}
                    ·{" "}
                    {a.lastSync
                      ? `Last sync ${date(a.lastSync)}`
                      : "Not synchronized yet"}
                  </small>
                  {a.lastError && (
                    <p className="account-error">{a.lastError}</p>
                  )}
                </div>
                <span
                  className={`badge ${a.status === "error" ? "warning" : "success"}`}
                >
                  {a.status === "error" ? (
                    <AlertCircle size={13} />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}{" "}
                  {a.status === "error" ? "Needs attention" : "Connected"}
                </span>
                <Button
                  variant="secondary"
                  busy={syncing === a._id}
                  disabled={!!syncing}
                  onClick={() => sync(a._id)}
                >
                  <RefreshCw size={15} />
                  Sync
                </Button>
                {disconnect === a._id ? (
                  <div className="disconnect-confirm">
                    <span>Remove connection and cached mail?</span>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        try {
                          await api(`/accounts/${a._id}`, { method: "DELETE" });
                          setDisconnect("");
                          qc.invalidateQueries({ queryKey: ["accounts"] });
                          qc.invalidateQueries({ queryKey: ["threads"] });
                          qc.invalidateQueries({ queryKey: ["thread"] });
                          qc.invalidateQueries({ queryKey: ["drafts"] });
                          toast.success(
                            "Mailbox disconnected. Provider mail was not deleted.",
                          );
                        } catch (e: any) {
                          toast.error(e.message);
                        }
                      }}
                    >
                      Disconnect
                    </Button>
                    <button onClick={() => setDisconnect("")}>Cancel</button>
                  </div>
                ) : (
                  <button
                    className="text-button muted"
                    onClick={() => setDisconnect(a._id)}
                  >
                    Disconnect
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Mail size={32} />}
            title="Bring your mailbox into your workspace"
          >
            Connect an account to send messages and read replies without opening
            another mail app.
          </Empty>
        )}
      </section>
      <div className="connection-explainer">
        <ShieldCheck size={21} />
        <div>
          <h3>Your mailbox stays yours</h3>
          <p>
            Messages are sent through the selected account. Unibox combines the
            view while keeping each conversation attached to its mailbox.
          </p>
        </div>
      </div>
    </div>
  );
}
