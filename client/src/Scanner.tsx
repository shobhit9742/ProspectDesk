import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ScanLine,
  ArrowRight,
  Globe2,
  Copy,
  Download,
  Sparkles,
  Clock3,
  Check,
  ExternalLink,
  Mail,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { api, post, download, date } from "./api";
import { Button, Empty, ErrorBox, Field, Source } from "./ui";
export default function Scanner() {
  const qc = useQueryClient(),
    navigate = useNavigate();
  const history = useQuery({
    queryKey: ["scans"],
    queryFn: () => api<any[]>("/scans"),
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<any>("/config"),
  });
  const objectiveVersion = useRef(0);
  const emailRevision = useRef(0);
  const [recipient, setRecipient] = useState(""),
    [emailOptions, setEmailOptions] = useState<any>(null),
    [composingEmails, setComposingEmails] = useState(false);
  function discardEmails() {
    emailRevision.current++;
    setEmailOptions(null);
    setComposingEmails(false);
  }
  const selectionVersion = useRef(0),
    activeScanId = useRef("");
  const [url, setUrl] = useState(""),
    [scan, setScan] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [objective, setObjective] = useState(""),
    [context, setContext] = useState<any>(null),
    [generating, setGenerating] = useState(false),
    [contextError, setContextError] = useState(""),
    [savingContext, setSavingContext] = useState(false),
    [contextEdited, setContextEdited] = useState(false),
    [copied, setCopied] = useState(-1);
  const warnedScan = useRef("");
  useEffect(() => {
    if (scan && warnedScan.current !== scan._id) {
      warnedScan.current = scan._id;
      if (scan.warnings?.length)
        toast.warning("Some website pages could not be read", {
          description: scan.warnings.join("\n"),
          duration: 10000,
          id: "scan-warnings",
        });
    }
  }, [scan]);
  async function run(force = false) {
    discardEmails();
    const version = ++selectionVersion.current;
    activeScanId.current = "";
    setBusy(true);
    setScan(null);
    setGenerating(false);
    setError("");
    setContextError("");
    setContext(null);
    setContextEdited(false);
    try {
      const result = await post("/scans", {
        url: force && scan ? scan.url : url,
        force,
      });
      if (version !== selectionVersion.current) return;
      activeScanId.current = result._id;
      setScan(result);
      setUrl(result.url);
      const last = result.contexts?.at(-1);
      setContext(last || null);
      setObjective(last?.objective || "");
      qc.invalidateQueries({ queryKey: ["scans"] });
      toast.success(
        result.cached
          ? "Opened the recent scan."
          : "Website research is ready.",
      );
    } catch (e: any) {
      if (version === selectionVersion.current) setError(e.message);
    } finally {
      if (version === selectionVersion.current) setBusy(false);
    }
  }
  async function open(id: string) {
    discardEmails();
    setContextEdited(false);
    const version = ++selectionVersion.current;
    activeScanId.current = "";
    setBusy(true);
    setScan(null);
    setGenerating(false);
    setError("");
    setContextError("");
    setContext(null);
    try {
      const result = await api(`/scans/${id}`);
      if (version !== selectionVersion.current) return;
      activeScanId.current = result._id;
      setScan(result);
      setUrl(result.url);
      const last = result.contexts?.at(-1);
      setContext(last || null);
      setObjective(last?.objective || "");
    } catch (e: any) {
      if (version === selectionVersion.current) setError(e.message);
    } finally {
      if (version === selectionVersion.current) setBusy(false);
    }
  }
  async function generate() {
    discardEmails();
    setContextEdited(false);
    const origin = scan._id,
      version = selectionVersion.current;
    const objectiveRevision = objectiveVersion.current;
    setGenerating(true);
    setCopied(-1);
    setContextError("");
    try {
      const result = await post(`/scans/${origin}/context`, { objective });
      if (
        version === selectionVersion.current &&
        origin === activeScanId.current &&
        objectiveRevision === objectiveVersion.current
      )
        setContext(result);
    } catch (e: any) {
      if (
        version === selectionVersion.current &&
        origin === activeScanId.current &&
        objectiveRevision === objectiveVersion.current
      )
        setContextError(e.message);
    } finally {
      if (
        version === selectionVersion.current &&
        origin === activeScanId.current &&
        objectiveRevision === objectiveVersion.current
      )
        setGenerating(false);
    }
  }
  async function composeEmails() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      setContextError(
        "Enter a valid recipient email address beside the website URL.",
      );
      return;
    }
    const revision = ++emailRevision.current,
      version = selectionVersion.current;
    setComposingEmails(true);
    setContextError("");
    setEmailOptions(null);
    try {
      const result = await post(`/scans/${scan._id}/emails`, {
        recipient: recipient.trim(),
        objective,
        points: context.points.map((p: any) => p.text),
      });
      if (
        revision === emailRevision.current &&
        version === selectionVersion.current
      )
        setEmailOptions(result);
    } catch (error: any) {
      if (revision === emailRevision.current) setContextError(error.message);
    } finally {
      if (revision === emailRevision.current) setComposingEmails(false);
    }
  }
  function chooseEmail(variation: any) {
    const to = emailOptions.recipient;
    discardEmails();
    navigate("/unibox", {
      state: {
        compose: { to, subject: variation.subject, body: variation.body },
      },
    });
  }
  const exportResearch = () =>
    download(
      `${scan.company.replace(/[^a-z0-9]/gi, "-")}-research.json`,
      JSON.stringify(
        {
          company: scan.company,
          url: scan.url,
          facts: scan.facts,
          pages: scan.pages.map((p: any) => ({
            url: p.url,
            title: p.title,
            fetchedAt: p.fetchedAt,
          })),
          context,
        },
        null,
        2,
      ),
      "application/json",
    );
  const contextText = () =>
    context.points
      .map(
        (p: any, i: number) =>
          `${i + 1}. ${p.text}\nSources: ${p.sources.join(", ")}`,
      )
      .join("\n\n");
  async function saveContext() {
    const origin = scan._id,
      version = selectionVersion.current,
      revision = objectiveVersion.current;
    setSavingContext(true);
    try {
      const result = await post(`/scans/${origin}/context/edit`, {
        objective: context.objective,
        contextId: context.id,
        points: context.points.map((point: any) => point.text),
      });
      if (
        origin === activeScanId.current &&
        version === selectionVersion.current &&
        revision === objectiveVersion.current
      ) {
        setContext(result);
        setContextEdited(false);
        toast.success("Context edits saved to research history.");
      }
    } catch (error: any) {
      if (version === selectionVersion.current) setContextError(error.message);
    } finally {
      setSavingContext(false);
    }
  }
  return (
    <div className="page scanner-page">
      <div className="page-heading">
        <div>
          <h1>Website Scanner</h1>
          <p>A clearer picture of a company, straight from its website.</p>
        </div>
        <span className="badge neutral">
          <Globe2 size={14} />
          Public website research
        </span>
      </div>
      <form
        className="scan-bar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="url-input">
          <Globe2 size={19} />
          <input
            aria-label="Company website URL"
            placeholder="Enter a company website, e.g. example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <input
          className="recipient-input"
          aria-label="Recipient email address"
          type="email"
          placeholder="Recipient email address"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            discardEmails();
          }}
        />
        <Button type="submit" busy={busy} disabled={!url.trim()}>
          <ScanLine size={17} />
          {busy ? "Scanning website…" : "Scan website"}
        </Button>
      </form>
      <div className="scan-caption">
        <span>
          Reads up to 3 public pages. Facts include their original sources.
        </span>
        {scan && (
          <button disabled={busy} onClick={() => run(true)}>
            Refresh scan
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="research-grid generator-workspace">
        <section className="research-panel">
          <div className="panel-heading">
            <h2>Company research</h2>
            {scan && (
              <Button variant="quiet" onClick={exportResearch}>
                <Download size={15} />
                Export
              </Button>
            )}
          </div>
          {busy ? (
            <div className="scan-loading">
              <ScanLine size={34} className="pulse" />
              <h3>Reading the company website</h3>
              <p>
                Collecting public pages and preserving the evidence behind each
                fact.
              </p>
              <div className="loading-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : !scan ? (
            <>
              <Empty
                icon={<ScanLine size={31} />}
                title="Start with a company website"
              >
                See what the company says about itself, with links you can
                inspect.
              </Empty>
              <div className="research-guide">
                <div>
                  <Globe2 size={18} />
                  <strong>Website facts</strong>
                  <span>Descriptions, statements, and public contacts.</span>
                </div>
                <div>
                  <ExternalLink size={18} />
                  <strong>Traceable sources</strong>
                  <span>Open the page behind each finding.</span>
                </div>
                <div>
                  <Sparkles size={18} />
                  <strong>Useful context</strong>
                  <span>
                    Prepare research points for your next conversation.
                  </span>
                </div>
              </div>
            </>
          ) : (
            <details className="research-disclosure">
              <summary>
                Review {scan.facts.length} website facts for {scan.company}
              </summary>
              <div className="research-content">
                <div className="company-title">
                  <span className="company-icon">
                    <Globe2 size={24} />
                  </span>
                  <div>
                    <h3>{scan.company}</h3>
                    <a href={scan.url} target="_blank" rel="noreferrer">
                      {new URL(scan.url).hostname}
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
                <div className="scan-meta">
                  <span>
                    <Check size={14} />
                    {scan.pages.length} pages read
                  </span>
                  <span>
                    <Clock3 size={14} />
                    {date(scan.createdAt)}
                  </span>
                  {scan.cached && <span>Cached result</span>}
                </div>
                {scan.warnings?.map((w: string) => (
                  <p className="notice" key={w}>
                    {w}
                  </p>
                ))}
                <p className="evidence-note">
                  These are statements found on the website, not independently
                  verified company claims.
                </p>
                <div className="facts">
                  {scan.facts.map((f: any, i: number) => (
                    <article className="fact" key={i}>
                      <span className="fact-kind">{f.kind}</span>
                      <p>{f.text}</p>
                      <Source url={f.source} />
                      <details>
                        <summary>View supporting excerpt</summary>
                        <blockquote>{f.excerpt}</blockquote>
                      </details>
                    </article>
                  ))}
                </div>
                {!scan.facts.length && (
                  <p>No reliable facts were extracted. Try another website.</p>
                )}
                <div className="pages-read">
                  <h3>Pages read</h3>
                  {scan.pages.map((p: any) => (
                    <div key={p.url}>
                      <FileText size={15} />
                      <Source url={p.url} />
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </section>
        <section className="context-panel">
          <div className="panel-heading">
            <h2>
              <Sparkles size={18} />
              Email details & context
            </h2>
          </div>
          <div className="context-body">
            {config.data && (
              <p className="notice">
                {config.data.ai
                  ? "AI-assisted context is available."
                  : "Template mode — no AI provider configured. Uses relevant website excerpts and suggested discussion questions."}
              </p>
            )}
            <p>
              Turn website evidence into talking points for an individual
              conversation.
            </p>
            <Field label="What is your outreach objective?">
              <textarea
                rows={4}
                value={objective}
                onChange={(e) => {
                  discardEmails();
                  objectiveVersion.current++;
                  setObjective(e.target.value);
                  setContext(null);
                  setContextEdited(false);
                  setContextError("");
                  setGenerating(false);
                  setCopied(-1);
                }}
                placeholder="For example: introduce our acquisition search and understand the company's services."
                maxLength={2000}
              />
            </Field>
            <Button
              className="full"
              busy={generating}
              disabled={!scan || busy || objective.trim().length < 10}
              onClick={generate}
            >
              <Sparkles size={16} />
              Generate context
              <ArrowRight size={15} />
            </Button>
            {!scan && (
              <small className="muted">
                Scan a website to unlock context generation.
              </small>
            )}
            <ErrorBox message={contextError} />
            {context ? (
              <>
                <p className="notice">{context.notice}</p>
                <div className="context-fields">
                  {context.points.map((p: any, i: number) => (
                    <div className="context-point" key={i}>
                      <div className="point-header">
                        <strong>
                          Context point {i + 1}{" "}
                          <span className="muted">
                            ({p.text.trim().split(/\s+/).filter(Boolean).length}{" "}
                            words)
                          </span>
                        </strong>
                        <button
                          aria-label={`Copy context point ${i + 1}`}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(p.text);
                              setCopied(i);
                            } catch {
                              toast.error(
                                "Clipboard unavailable. Select and copy the text.",
                              );
                            }
                          }}
                        >
                          {copied === i ? (
                            <Check size={15} />
                          ) : (
                            <Copy size={15} />
                          )}
                        </button>
                      </div>
                      <textarea
                        aria-label={`Edit context point ${i + 1}`}
                        rows={5}
                        disabled={savingContext}
                        value={p.text}
                        onChange={(e) => {
                          discardEmails();
                          setContextEdited(true);
                          setContext({
                            ...context,
                            points: context.points.map((x: any, j: number) =>
                              j === i ? { ...x, text: e.target.value } : x,
                            ),
                          });
                        }}
                      />
                      {p.sources.map((s: string) => (
                        <Source key={s} url={s} />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="context-actions">
                  <Button
                    variant="secondary"
                    busy={savingContext}
                    disabled={!contextEdited}
                    onClick={saveContext}
                  >
                    Save edits
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      download("outreach-context.txt", contextText())
                    }
                  >
                    <Download size={15} />
                    Download
                  </Button>
                  <Button
                    variant="secondary"
                    busy={composingEmails}
                    disabled={busy || generating || savingContext}
                    onClick={composeEmails}
                  >
                    <Mail size={15} />
                    Compose
                  </Button>
                </div>
                <small className="muted">
                  Edits are included in copies and downloads. Use Save edits to
                  keep them in research history.
                </small>
              </>
            ) : (
              <div className="context-placeholder">
                <Sparkles size={25} />
                <p>
                  Your context points will appear here with links to supporting
                  evidence.
                </p>
              </div>
            )}
          </div>
        </section>
        <section aria-label="Email variations" className="generated-emails">
          <div className="panel-heading">
            <h2>
              <Mail size={18} />
              Generated emails
            </h2>
          </div>
          <div className="context-body">
            {emailOptions ? (
              <>
                <p className="notice">{emailOptions.notice}</p>
                <p>
                  To: {emailOptions.recipient}. Choose one email to edit and
                  send. The other two will be discarded. Select your sending
                  mailbox in the composer.
                </p>
                <div className="email-options-grid">
                  {emailOptions.variations.map(
                    (variation: any, index: number) => (
                      <article className="email-option" key={index}>
                        <h3>
                          {index + 1}. {variation.label}
                        </h3>
                        <Field label={`Subject for variation ${index + 1}`}>
                          <input
                            value={variation.subject}
                            maxLength={500}
                            onChange={(e) => {
                              const subject = e.target.value;
                              setEmailOptions(
                                (current: any) =>
                                  current && {
                                    ...current,
                                    variations: current.variations.map(
                                      (item: any, i: number) =>
                                        i === index
                                          ? { ...item, subject }
                                          : item,
                                    ),
                                  },
                              );
                            }}
                          />
                        </Field>
                        <Field label={`Message for variation ${index + 1}`}>
                          <textarea
                            className="email-option-body"
                            rows={16}
                            value={variation.body}
                            maxLength={20000}
                            onChange={(e) => {
                              const body = e.target.value;
                              setEmailOptions(
                                (current: any) =>
                                  current && {
                                    ...current,
                                    variations: current.variations.map(
                                      (item: any, i: number) =>
                                        i === index ? { ...item, body } : item,
                                    ),
                                  },
                              );
                            }}
                          />
                        </Field>
                        <Button
                          disabled={
                            !variation.subject.trim() || !variation.body.trim()
                          }
                          onClick={() => chooseEmail(variation)}
                        >
                          Use variation {index + 1}
                        </Button>
                      </article>
                    ),
                  )}
                </div>
              </>
            ) : (
              <div className="context-placeholder">
                <Mail size={25} />
                <p>
                  {composingEmails
                    ? "Writing three collaboration-focused email variations…"
                    : "Review your context points, then click Compose to generate three email variations."}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="history">
        <div className="panel-heading">
          <h2>
            <Clock3 size={18} />
            Recent research
          </h2>
          <span className="muted">Last 30 scans</span>
        </div>
        {history.isError ? (
          <ErrorBox message={history.error.message} />
        ) : history.data?.length ? (
          <div className="history-list">
            {history.data.map((s: any) => (
              <button key={s._id} onClick={() => open(s._id)}>
                <Globe2 size={17} />
                <span>
                  <strong>{s.company}</strong>
                  <small>{new URL(s.url).hostname}</small>
                </span>
                <span>{date(s.createdAt)}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <p className="history-empty">
            Your completed scans will be saved here.
          </p>
        )}
      </section>
    </div>
  );
}
