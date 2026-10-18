import { formatCountdown } from "../../../packages/protocol/time.js";
export let csrf = "";
export function setCsrf(v: string) {
  csrf = v;
}
export async function api(
  url: string,
  body?: any,
  page?: string,
  signal?: AbortSignal,
) {
  const res = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : undefined,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...(page ? { "X-Page-Instance": page } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok)
    throw Object.assign(Error(result.error || "Request failed"), {
      status: res.status,
    });
  return result;
}
export const socket = (url: string) =>
  new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api${url}`,
  );
const chicagoDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
export const chicago = (v: number | null) => (v ? chicagoDate.format(v) : "—");
export const remaining = (deadline: number | null, serverNow = Date.now()) => {
  if (!deadline) return "Not started";
  return formatCountdown((deadline - serverNow) / 1000);
};
