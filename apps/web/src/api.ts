import { OPERATION_TIMEOUT_MS } from "../../../packages/protocol/timeouts.js";
import { formatCountdown } from "../../../packages/protocol/time.js";
import { countdownMS } from "../../../packages/protocol/timer.js";
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
  return request(
    url,
    body === undefined ? undefined : JSON.stringify(body),
    page,
    signal,
    "application/json",
  );
}
export async function apiBinary(
  url: string,
  body: Uint8Array<ArrayBuffer>,
  page: string,
  signal?: AbortSignal,
) {
  return request(url, body, page, signal, "application/vnd.ssh-exam-capture");
}
async function request(
  url: string,
  body: BodyInit | undefined,
  page: string | undefined,
  signal: AbortSignal | undefined,
  contentType: string,
) {
  const res = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(OPERATION_TIMEOUT_MS)])
      : AbortSignal.timeout(OPERATION_TIMEOUT_MS),
    headers: {
      "Content-Type": contentType,
      "X-CSRF-Token": csrf,
      ...(page ? { "X-Page-Instance": page } : {}),
    },
    body,
  });
  const result = await res.json();
  if (!res.ok)
    throw Object.assign(Error(result.error || "Request failed"), {
      status: res.status,
      code: typeof result.code === "string" ? result.code : undefined,
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
export const attemptRemaining = (a: any, serverNow = Date.now()) =>
  a.start ? formatCountdown(countdownMS(a, serverNow) / 1000) : "Not started";
