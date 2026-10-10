import { useEffect, useId, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { LoaderCircle, AlertCircle, ArrowUpRight } from "lucide-react";
export function Button({
  children,
  busy = false,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: string;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className || ""}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ErrorBox({
  message,
  persistent = false,
}: {
  message?: string;
  persistent?: boolean;
}) {
  const id = useId();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (message && message !== previous.current) {
      toast.error(message, { id: `error-${id}`, duration: 10000 });
    }
    previous.current = message;
  }, [message, id]);
  return message && persistent ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Source({ url }: { url: string }) {
  let label = url;
  try {
    label =
      new URL(url).hostname.replace(/^www\./, "") +
      new URL(url).pathname.replace(/\/$/, "");
  } catch {}
  return (
    <a className="source" href={url} target="_blank" rel="noreferrer">
      {label}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
