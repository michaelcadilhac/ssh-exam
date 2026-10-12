export let csrf = "";
export function setCsrf(v: string) {
  csrf = v;
}
export async function api(url: string, body?: any, page?: string) {
  const res = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...(page ? { "X-Page-Instance": page } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.error || "Request failed");
  return result;
}
export const socket = (url: string) =>
  new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api${url}`,
  );
export const chicago = (v: number | null) =>
  v
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(v)
    : "—";
export const remaining = (deadline: number | null, serverNow = Date.now()) => {
  if (!deadline) return "Not started";
  const secs = Math.max(0, Math.ceil((deadline - serverNow) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
};
