import type { Page } from "@playwright/test";
import { OPERATION_TIMEOUT_MS } from "../../packages/protocol/timeouts.js";

// Only the public welcome GET, before credentials or an attempt exist. A remote
// generator's network-change cancellation may be retried once; exam operations
// and every other failure retain their original refusal.
export async function openUnauthenticatedStressWelcome(
  page: Pick<Page, "goto" | "waitForTimeout">,
  origin: string,
  note: (message: string) => void,
) {
  try {
    return await page.goto(origin, { timeout: 10000 });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("net::ERR_NETWORK_CHANGED"))
      throw error;
    note(JSON.stringify({ phase: "welcome-network-retry", error: error.message, retries: 1 }));
    await page.waitForTimeout(500);
    return page.goto(origin, { timeout: 10000 });
  }
}

// Capture verification precedes the HTTP Start. Observe the two public stages
// separately, using the existing operation budget for each, without retrying Start.
export async function waitForStressStartResponse(
  page: Pick<Page, "waitForRequest">,
  note: (message: string) => void,
) {
  const started = performance.now();
  const request = await page.waitForRequest(
    request => new URL(request.url()).pathname.endsWith("/begin") && request.method() === "POST",
    { timeout: OPERATION_TIMEOUT_MS },
  );
  const requested = performance.now();
  note(JSON.stringify({ phase: "start-request", preparation_ms: Math.round(requested - started) }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      request.response(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Start response exceeded the 60-second operation budget")), OPERATION_TIMEOUT_MS);
      }),
    ]);
    if (!response) throw Error("Start request ended without an HTTP response");
    note(JSON.stringify({ phase: "start-response", status: response.status(), response_ms: Math.round(performance.now() - requested) }));
    return response;
  } finally {
    clearTimeout(timer);
  }
}
