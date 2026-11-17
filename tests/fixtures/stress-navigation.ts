import type { Page } from "@playwright/test";

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
