import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [origin, output] = process.argv.slice(2);
assert(origin && output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const checks = [];
try {
  for (const width of [320, 430, 1280]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: 800 },
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const path of ["/", "/admin"]) {
        const response = await page.goto(origin + path, { timeout: 5000 });
        assert.equal(response.status(), 503);
        assert.equal(response.headers()["retry-after"], "60");
        await page
          .getByRole("heading", {
            name: "Exam website is temporarily unavailable",
            exact: true,
          })
          .waitFor({ timeout: 3000 });
        const retry = page.getByRole("link", {
          name: "Try again",
          exact: true,
        });
        await retry.focus({ timeout: 3000 });
        assert(
          await retry.evaluate((element) => element === document.activeElement),
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        );
        const navigation = page.waitForResponse(
          (reply) => reply.url() === origin + path,
          { timeout: 5000 },
        );
        await retry.press("Enter", { timeout: 3000 });
        assert.equal((await navigation).status(), 503);
        await page.screenshot({
          path: `${output}/maintenance-${width}-${path === "/" ? "student" : "instructor"}.png`,
        });
        checks.push({
          width,
          path,
          status: 503,
          keyboardRetry: true,
          noOverflow: true,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/browser.json`,
  JSON.stringify(
    { checks, nativeChromium: true, noAuthenticationOrMedia: true },
    null,
    2,
  ) + "\n",
);
