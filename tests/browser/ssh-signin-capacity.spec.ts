import { test, expect, type BrowserContext } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { observeWasmBootstrap } from "../fixtures/wasm-bootstrap-diagnostics.js";

test("sixteen packaged WASM clients authenticate without consuming exam time", async ({
  browser,
  request,
}) => {
  test.skip(
    process.env.EXAM_STRESS_SEPARATE_SIGNIN === "1",
    "The manual suite runs this cohort in its mandatory fresh browser-signin phase",
  );
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1" ||
      !!process.env.EXAM_BROWSER_NATIVE_BUNDLE,
    "Uses the isolated simulated SSH host fixture and real browser WASM",
  );
  test.setTimeout(120000);
  expect(await (await request.get("/api/login-test")).json()).toMatchObject({
    browserSSH: true,
  });
  const accounts = Array.from(
    { length: 16 },
    (_, n) => `capacity${String(n + 1).padStart(2, "0")}`,
  );
  const contexts: BrowserContext[] = [];
  const resources: unknown[] = [];
  const profile = process.env.EXAM_BROWSER_PROFILE_COMPILED === "1";
  const sample = async (students: number) => {
    if (!profile) return;
    const response = await request.get("/api/fixture/runtime");
    expect(response.ok()).toBe(true);
    const runtime = await response.json();
    expect(runtime.gatewayProcess).toBe(true);
    const pids = [runtime.pid, ...runtime.workers.map((w: any) => w.pid)];
    expect(pids).toHaveLength(students + 1);
    const processes = await Promise.all(
      [...pids, runtime.fixturePID].map(async (pid: number) => {
        expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
        const [memory, stat, cgroup] = await Promise.all(
          ["smaps_rollup", "stat", "cgroup"].map((name) =>
            readFile(`/proc/${pid}/${name}`, "utf8"),
          ),
        );
        const field = (name: string) =>
          Number(memory.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1]);
        expect(cgroup).toContain("ssh-exam-profile35-");
        return {
          pid,
          role:
            pid === runtime.fixturePID
              ? "fixture"
              : pid === runtime.pid
                ? "gateway"
                : "worker",
          pss_kib: field("Pss"),
          rss_kib: field("Rss"),
          stat,
          cgroup: cgroup.trim(),
        };
      }),
    );
    resources.push({ students, at: Date.now(), processes });
  };
  const diagnostics: {
    username: string;
    observe: Awaited<ReturnType<typeof observeWasmBootstrap>>;
    alerts: () => Promise<string[]>;
  }[] = [];
  try {
    await sample(0);
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
      await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
      await page.getByLabel("Username").fill(username);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByLabel("Password", { exact: true })
        .fill("shared-password");
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
      const bootstrap = await diagnostics.at(-1)!.observe();
      expect(bootstrap.worker).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: "ready" })]),
      );
      if ([1, 4, 8, 16].includes(contexts.length))
        await sample(contexts.length);
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
    if (profile)
      await writeFile(
        test.info().outputPath("gateway-resources.json"),
        JSON.stringify(resources, null, 2),
        { mode: 0o600 },
      );
    await Promise.all(contexts.map((context) => context.close()));
  }
});
