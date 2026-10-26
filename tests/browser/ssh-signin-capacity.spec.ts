import { test, expect, type BrowserContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { observeWasmBootstrap } from "../fixtures/wasm-bootstrap-diagnostics.js";

test("sixteen packaged WASM clients authenticate without consuming exam time", async ({ browser }) => {
  test.skip(process.env.EXAM_BROWSER_SSH !== "1" || !!process.env.EXAM_BROWSER_NATIVE_BUNDLE,
    "Uses the isolated simulated SSH host fixture and real browser WASM");
  test.setTimeout(120000);
  const accounts = [...Array.from({ length: 14 }, (_, n) => `retained${String(n + 1).padStart(2, "0")}`),
    "monitoring01", "approval01"];
  const contexts: BrowserContext[] = [];
  const diagnostics: { username: string; observe: Awaited<ReturnType<typeof observeWasmBootstrap>> }[] = [];
  try {
    for (const username of accounts) {
      const context = await browser.newContext(), page = await context.newPage();
      contexts.push(context);
      page.setDefaultTimeout(10000);
      diagnostics.push({ username, observe: await observeWasmBootstrap(page) });
      await page.goto("/");
      expect(await (await page.request.get("/api/login-test")).json()).toMatchObject({ browserSSH: true });
      await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
      await page.getByLabel("Enrolled username").fill(username);
      await page.getByRole("button", { name: "Start SSH sign-in", exact: true }).click();
      await page.getByLabel("Shared SSH password").fill("shared-password");
      await page.getByRole("button", { name: "Respond to this host", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open preflight & practice", exact: true })).toBeVisible();
      const response = await page.request.get("/api/student/exam");
      expect(response.ok()).toBe(true);
      const state = await response.json();
      expect(state.attempt?.start ?? 0).toBe(0);
      expect(state.attempt?.deadline ?? 0).toBe(0);
    }
  } finally {
    await mkdir(test.info().outputDir, { recursive: true });
    await writeFile(test.info().outputPath("wasm-bootstrap.json"), JSON.stringify(await Promise.all(
      diagnostics.map(async ({ username, observe }) => ({ username, ...await observe() })),
    )), { mode: 0o600 });
    await Promise.all(contexts.map(context => context.close()));
  }
});
