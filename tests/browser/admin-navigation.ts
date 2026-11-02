import { test, type Page, type Response } from "@playwright/test";

// Cold browser contexts share one real fixture server/IP. Honor its limiter,
// including on reload; never reset counters, spoof identities or relax policy.
export async function visitAdmin(page: Page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const limited: Response[] = [];
    const observe = (response: Response) => {
      if (
        response.status() === 429 &&
        response.request().method() === "GET" &&
        ["document", "script", "stylesheet"].includes(
          response.request().resourceType(),
        )
      )
        limited.push(response);
    };
    let response: Response | null = null;
    page.on("response", observe);
    try {
      response = await page.goto("/admin", { timeout: 15000 });
    } finally {
      page.off("response", observe);
    }
    const throttled = limited.filter(
      (r) => new URL(r.url()).origin === new URL(page.url()).origin,
    );
    if (response?.status() === 200 && !throttled.length) return;
    if (!throttled.length || attempt !== 0)
      throw Error(
        `Admin fixture navigation refused: HTTP ${response?.status()}`,
      );
    const waits = throttled.map((r) => Number(r.headers()["retry-after"]));
    if (
      waits.some(
        (seconds) =>
          !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60,
      )
    )
      throw Error("Admin fixture returned an unusable Retry-After delay");
    const seconds = Math.max(...waits);
    await test.info().attach("admin-navigation-rate-limit", {
      contentType: "application/json",
      body: JSON.stringify({
        status: 429,
        retry_after_seconds: seconds,
        responses: await Promise.all(
          throttled.map(async (r) => ({
            path: new URL(r.url()).pathname,
            type: r.request().resourceType(),
            response: (await r.text()).slice(0, 512),
          })),
        ),
      }),
    });
    const delay = seconds * 1000 + 100;
    test.setTimeout(test.info().timeout + delay);
    await page.waitForTimeout(delay);
  }
}
