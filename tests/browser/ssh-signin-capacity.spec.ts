import { test, expect, type BrowserContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { observeWasmBootstrap } from "../fixtures/wasm-bootstrap-diagnostics.js";

test("sixteen packaged WASM clients authenticate without consuming exam time", async ({
  browser,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1" ||
      !!process.env.EXAM_BROWSER_NATIVE_BUNDLE,
    "Uses the isolated simulated SSH host fixture and real browser WASM",
  );
  test.setTimeout(120000);
  const accounts = Array.from(
    { length: 16 },
    (_, n) => `capacity${String(n + 1).padStart(2, "0")}`,
  );
  const contexts: BrowserContext[] = [];
  const diagnostics: {
    username: string;
    observe: Awaited<ReturnType<typeof observeWasmBootstrap>>;
    alerts: () => Promise<string[]>;
  }[] = [];
  try {
    for (const username of accounts) {
      const context = await browser.newContext(),
        page = await context.newPage();
      contexts.push(context);
      page.setDefaultTimeout(10000);
      diagnostics.push({
        username,
        observe: await observeWasmBootstrap(page),
        alerts: () => page.getByRole("alert").allTextContents(),
      });
      await page.goto("/");
      expect(
        await (await page.request.get("/api/login-test")).json(),
      ).toMatchObject({ browserSSH: true });
      await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
      await page.getByLabel("Username").fill(username);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByLabel("Password", { exact: true }).fill("shared-password");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: "Check setup and practice",
          exact: true,
        }),
      ).toBeVisible();
      const response = await page.request.get("/api/student/exam");
      expect(response.ok()).toBe(true);
      const state = await response.json();
      expect(state.attempt?.start ?? 0).toBe(0);
      expect(state.attempt?.deadline ?? 0).toBe(0);
    }
  } finally {
    await mkdir(test.info().outputDir, { recursive: true });
    await writeFile(
      test.info().outputPath("wasm-bootstrap.json"),
      JSON.stringify(
        await Promise.all(
          diagnostics.map(async ({ username, observe, alerts }) => ({
            username,
            ...(await observe()),
            alerts: await alerts(),
          })),
        ),
      ),
      { mode: 0o600 },
    );
    await Promise.all(contexts.map((context) => context.close()));
  }
});
