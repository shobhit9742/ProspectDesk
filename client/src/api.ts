export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-ProspectDesk": "1",
      ...init.headers,
    },
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Check that the API is running.",
    );
  }
  if (!res.ok) { const error = new Error(data.error || "Request failed.") as Error & { status: number }; error.status=res.status; throw error; }
  return data;
}
export const post = (path: string, body: any = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
