import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScanLine,
  Mail,
  Inbox,
  LogOut,
  ArrowRight,
  PanelLeftClose,
  Menu,
  Globe2,
  Link2,
  MessageSquareText,
} from "lucide-react";
import { api, post } from "./api";
import { toast } from "sonner";
import { Button, ErrorBox, Field } from "./ui";
import Scanner from "./Scanner";
import Accounts from "./Accounts";
import Unibox from "./Unibox";
function Auth({ onSuccess }: { onSuccess: () => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await post(
        `/auth/${register ? "register" : "login"}`,
        Object.fromEntries(form),
      );
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <ScanLine size={21} />
          </span>
          ProspectDesk
        </div>
        <div>
          <h1>
            From first look
            <br />
            to a real conversation.
          </h1>
          <p>
            Research company websites, prepare useful context, and keep every
            mailbox conversation together.
          </p>
          <div className="story-flow">
            <span>
              <Globe2 />
              Research
            </span>
            <ArrowRight />
            <span>
              <Link2 />
              Connect
            </span>
            <ArrowRight />
            <span>
              <MessageSquareText />
              Converse
            </span>
          </div>
        </div>
        <p className="auth-foot">Company research & connected mailboxes</p>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <h2>{register ? "Create your workspace" : "Welcome back"}</h2>
          <p>
            {register
              ? "Start with company research. Connect your mailbox when you’re ready."
              : "Sign in to continue your research and conversations."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <Field label="Your name">
                <input name="name" autoComplete="name" required minLength={2} />
              </Field>
            )}
            <Field label="Email address">
              <input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field
              label="Password"
              hint={register ? "At least 10 characters." : ""}
            >
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 10 : 1}
              />
            </Field>
            <ErrorBox message={error} />
            <Button busy={busy} type="submit" className="full">
              {register ? "Create workspace" : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to ProspectDesk?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Create workspace"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
export default function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api("/auth/me"),
    retry: false,
  });
  const [mobile, setMobile] = useState(false),
    [smallScreen, setSmallScreen] = useState(
      window.matchMedia("(max-width:760px)").matches,
    );
  const sidebarRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)");
    const change = () => {
      setSmallScreen(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!smallScreen || !mobile) return;
    const root = sidebarRef.current;
    root?.querySelector<HTMLElement>(".mobile-close")?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobile(false);
        return;
      }
      if (e.key === "Tab") {
        const items = Array.from(
          root?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled)",
          ) || [],
        ).filter((el) => el.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
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
      menuRef.current?.focus();
    };
  }, [mobile, smallScreen]);
  if (me.isPending) return <div className="boot">Opening your workspace…</div>;
  if (me.isError && (me.error as Error & { status?: number }).status !== 401)
    return (
      <div className="boot">
        <div>
          <ErrorBox message="The workspace server is unavailable. Your session has not been cleared." />
          <Button onClick={() => me.refetch()}>Try again</Button>
        </div>
      </div>
    );
  if (!me.data)
    return (
      <Auth
        onSuccess={() => {
          qc.removeQueries({
            predicate: (query) => query.queryKey[0] !== "me",
          });
          qc.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  const user = me.data;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        ref={sidebarRef}
        inert={smallScreen && !mobile}
        className={`sidebar ${mobile ? "open" : ""}`}
      >
        <div className="brand">
          <span className="brand-mark">
            <ScanLine size={20} />
          </span>
          ProspectDesk
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>
        <div className="workspace-name">
          <span>PD</span>
          <div>
            My workspace<small>Research & outreach</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <NavLink to="/scanner" onClick={() => setMobile(false)}>
            <ScanLine size={19} />
            Website Scanner
          </NavLink>
          <NavLink to="/accounts" onClick={() => setMobile(false)}>
            <Mail size={19} />
            Connected Inboxes
          </NavLink>
          <NavLink to="/unibox" onClick={() => setMobile(false)}>
            <Inbox size={19} />
            Unibox
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <Link2 size={18} />
          <p>
            Research and conversations,
            <br />
            in one workspace.
          </p>
        </div>
        <div className="user">
          <span className="avatar">{user.name?.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={async () => {
              try {
                await post("/auth/logout");
                await qc.cancelQueries();
                qc.removeQueries({
                  predicate: (query) => query.queryKey[0] !== "me",
                });
                qc.setQueryData(["me"], null);
              } catch (error: any) {
                toast.error(error.message);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Dismiss navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-wrap" inert={smallScreen && mobile}>
        <header className="topbar">
          <button
            ref={menuRef}
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <span>
            Workspace <span className="crumb">/</span> Research & conversations
          </span>
          <span className="topbar-account">{user.name}</span>
        </header>
        <main id="main">
          <Routes>
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/unibox" element={<Unibox />} />
            <Route path="*" element={<Navigate to="/scanner" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
