import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import { simulatedMedia, ready } from "./transition-fixture.js";

const origin = "https://127.0.0.1:9444";
const native = z
  .object({
    private_guest: z.literal(true),
    attempt: z
      .object({
        id: z.string().uuid(),
        username: z.literal("examq"),
        uid: z.number().int().min(1000),
        state: z.string(),
        start: z.number(),
        deadline: z.number(),
        // Native Attempt omits an unset original_deadline before Begin.
        original_deadline: z.number().default(0),
        access_state: z.string(),
        checksum: z.string(),
        grant: z.object({ id: z.string().uuid() }).passthrough(),
        registered_owner: z.record(z.string(), z.unknown()).optional(),
        ssh_exited_owner: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

test("genuine SSH loss uses reviewed protected work and a new chosen allowance without reopening the original attempt", async ({
  browser,
  request,
}) => {
  test.skip(
    !process.env.EXAM_BROWSER_NATIVE_BUNDLE ||
      process.env.EXAM_BROWSER_NATIVE_SSH_RECOVERY !== "1",
    "Requires the guarded single-student native recovery fixture",
  );
  // Two real authentications, native collection/verification, reviewed issuance,
  // explicit root disposition and source synchronization fit this finite budget.
  test.setTimeout(300000);
  const metadata = await (
    await request.get("/api/fixture/native-ready")
  ).json();
  expect(metadata).toMatchObject({
    privateGuest: true,
    sshRecovery: true,
    large: false,
  });
  if (process.env.EXAM_BROWSER_NATIVE_RELEASE === "1")
    expect(metadata.releaseNative).toBe(true);
  expect(
    metadata.students.map((s: { username: string }) => s.username),
  ).toEqual(["examq"]);
  const login = await request.post("/api/admin/login", {
    headers: { origin },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const headers = { origin, "x-csrf-token": (await login.json()).csrf };
  const inspect = async (id: string) => {
    const response = await request.get("/api/fixture/native-state", {
      params: { attempt: id },
      timeout: 10000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return native.parse(await response.json());
  };
  const operator = async (
    id: string,
    action: "stop" | "verify" | "source-sync" | "release" | "finish",
    grant?: string,
  ) => {
    const response = await request.post("/api/fixture/native-ssh-recovery", {
      headers,
      data: { attempt: id, action, grant },
      timeout: 135000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const value = await response.json();
    native.parse(value);
    return value;
  };
  const grantInfo = async (id: string) =>
    (await request.get(`/api/admin/grants/${id}`)).json();
  const publicAttempts = async () =>
    (
      await (
        await request.get("/api/admin/attempts", { params: { q: "examq" } })
      ).json()
    ).attempts as any[];
  const preflight = async (context: BrowserContext, grant?: string) => {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await simulatedMedia(page);
    await page.goto(origin);
    await page.getByLabel("Exam ID", { exact: true }).fill("native-browser");
    await page.getByLabel("Username").fill("examq");
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    const summaryReady = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/student/exam" &&
        response.status() === 200,
      { timeout: 20000 },
    );
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    const summary = await (await summaryReady).json();
    const open = page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    });
    await expect(open).toBeVisible();
    if (grant) {
      expect(summary.grants.map((g: { id: string }) => g.id)).toContain(grant);
      const chooser = page.getByRole("combobox", {
        name: "Choose an attempt",
        exact: true,
      });
      if (await chooser.count()) await chooser.selectOption(grant);
    }
    await open.click();
    await ready(page);
    const prepared = (
      await (await page.request.get("/api/student/exam")).json()
    ).attempt;
    expect(prepared).toMatchObject({
      state: "PREPARING",
      start: null,
      deadline: null,
    });
    if (grant) expect(prepared.grant_id).toBe(grant);
    return { page, prepared };
  };
  const begin = async (page: Page) => {
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Start exam", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/student/exam")).json()).attempt
            ?.state,
        { timeout: 25000 },
      )
      .toBe("ACTIVE");
    await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
    await expect(page.locator(".xterm-helper-textarea")).toBeEnabled();
    await expect(page.locator('.terminal[aria-busy="false"]')).toHaveCount(1);
    return (await (await page.request.get("/api/student/exam")).json()).attempt;
  };
  const command = async (page: Page, text: string, marker: string) => {
    const input = page.locator(".xterm-helper-textarea");
    await expect(input).toBeEnabled();
    await page.locator(".xterm-screen").click();
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.type(text, { delay: 25 });
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(marker, {
      timeout: 15000,
    });
  };
  const contexts: BrowserContext[] = [];
  try {
    const first = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(first);
    const old = await preflight(first);
    const started = await begin(old.page);
    const original = (await inspect(started.id)).attempt;
    expect(original.deadline - original.start).toBe(5400000);
    await command(
      old.page,
      "printf 'SAVED-before-genuine-SSH-loss\\n' > /work/recovery-proof.txt; printf 'FIRST-%s\\n' SAVED",
      "FIRST-SAVED",
    );
    await command(
      old.page,
      "IFS= read -r saved < /work/recovery-proof.txt; printf 'CONFIRMED:%s\\n' \"$saved\"",
      "CONFIRMED:SAVED-before-genuine-SSH-loss",
    );
    // Actual noncooperative browser/SSH destruction, not a missing heartbeat.
    await first.close();
    await expect
      .poll(
        async () => {
          const a = (await inspect(original.id)).attempt;
          return (
            a.state === "LOCKED" &&
            !!a.ssh_exited_owner &&
            JSON.stringify(a.ssh_exited_owner) ===
              JSON.stringify(a.registered_owner)
          );
        },
        { timeout: 25000 },
      )
      .toBe(true);
    const lost = (await inspect(original.id)).attempt;
    expect(lost).toMatchObject({
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      access_state: "HELD",
      grant: original.grant,
    });
    await operator(original.id, "stop");
    await expect
      .poll(async () => (await inspect(original.id)).attempt.state, {
        timeout: 45000,
      })
      .toBe("COMPLETED");
    const verified = await operator(original.id, "verify");
    expect(verified.verified_files).toEqual(["recovery-proof.txt"]);
    expect(verified.live_source_changed).toBe(true);
    expect(verified.attempt.access_state).toBe("HELD");
    await expect
      .poll(
        async () =>
          (await publicAttempts()).find((a) => a.id === original.id)?.state,
        { timeout: 25000 },
      )
      .toBe("COMPLETED");

    const definitions = await (await request.get("/api/admin/exams")).json();
    const definition = definitions.find(
      (exam: { id: string }) => exam.id === "native-browser",
    );
    expect(definition).toBeTruthy();
    const work = {
      kind: "saved",
      attempt: original.id,
      checksum: verified.attempt.checksum,
    };
    const preview = await request.post(
      "/api/admin/exams/native-browser/grants/additional-preview",
      {
        headers,
        data: {
          definition_revision: definition.revision,
          template_version: definition.template_version,
          usernames: ["examq"],
          duration: 1200,
          earliest: Date.now() - 1000,
          latest: Date.now() + 600000,
          work,
          reason:
            "Instructor reviews NEW twenty-minute attempt after positive SSH loss",
          request: crypto.randomUUID(),
        },
      },
    );
    expect(preview.ok(), await preview.text()).toBe(true);
    const review = await preview.json();
    const confirmed = await request.post(
      `/api/admin/grant-issuance/${review.id}/confirm`,
      {
        headers,
        data: { revision: review.revision, request: crypto.randomUUID() },
      },
    );
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    const grant = (await confirmed.json()).issued[0].grant as string;
    expect(await grantInfo(grant)).toMatchObject({
      status: "PENDING_NATIVE",
      settings: { duration: 1200 },
      work,
      claims: [],
    });
    // Issuance and native retention neither start time nor release the old hold.
    const synchronized = await operator(original.id, "source-sync", grant);
    expect(synchronized.legacy_revoked).toMatchObject({
      disposition: "revoked",
      exam: "native-browser",
      username: "examq",
      duration: 3600,
      source_attempt: original.id,
      revocation: {
        version: 1,
        original_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(await grantInfo(grant)).toMatchObject({
      status: "AVAILABLE",
      claims: [],
    });
    expect((await inspect(original.id)).attempt.access_state).toBe("HELD");
    const released = (await operator(original.id, "release")).attempt;
    expect(["OVERRIDDEN", "RELEASED"]).toContain(released.access_state);
    expect(released).toMatchObject({
      policy_state: "NORMAL",
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      checksum: verified.attempt.checksum,
    });
    await expect
      .poll(
        async () =>
          ["OVERRIDDEN", "RELEASED"].includes(
            (await publicAttempts()).find((a) => a.id === original.id)
              ?.access_state,
          ),
        { timeout: 25000 },
      )
      .toBe(true);

    const second = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(second);
    const next = await preflight(second, grant);
    expect(next.prepared.id).not.toBe(original.id);
    expect(JSON.parse(next.prepared.settings).duration).toBe(1200);
    expect(JSON.parse(next.prepared.grant_work)).toEqual(work);
    expect((await inspect(next.prepared.id)).attempt).toMatchObject({
      start: 0,
      deadline: 0,
      original_deadline: 0,
      grant: { id: grant },
    });
    expect((await grantInfo(grant)).status).toBe("AVAILABLE");
    const active = await begin(next.page);
    expect(active.id).toBe(next.prepared.id);
    expect(active.deadline - active.start).toBe(1200000);
    expect(active.original_deadline).toBe(active.deadline);
    await command(
      next.page,
      "cat /work/recovery-proof.txt",
      "SAVED-before-genuine-SSH-loss",
    );
    await command(
      next.page,
      "printf 'NEW-20-MINUTE-ATTEMPT\\n' > /work/recovery-result.txt; printf 'SECOND-%s\\n' SAVED",
      "SECOND-SAVED",
    );
    await next.page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await next.page
      .getByRole("dialog")
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await publicAttempts()).find((a) => a.id === active.id)?.state,
        { timeout: 45000 },
      )
      .toBe("COMPLETED");
    const completed = await operator(active.id, "finish");
    expect(completed.preservation).toBe("FULL");
    expect(completed.verified_files).toEqual([
      "recovery-proof.txt",
      "recovery-result.txt",
    ]);
    expect(completed.attempt).toMatchObject({
      start: active.start,
      deadline: active.deadline,
      original_deadline: active.original_deadline,
      access_state: "HELD",
      protected: true,
    });
    expect(completed.source).toMatchObject({
      id: original.id,
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      checksum: verified.attempt.checksum,
      grant: original.grant,
    });
  } catch (error) {
    const pages = contexts.flatMap((context) => context.pages());
    const observed = await Promise.all(
      pages.map(async (page) => {
        try {
          return {
            terminal: (await page.locator(".xterm-rows").allTextContents())
              .join("\n")
              .slice(-4096),
            notices: (
              await page
                .locator('.lock-overlay, .terminal-notice, [role="alert"]')
                .allTextContents()
            )
              .join("\n")
              .slice(-2048),
          };
        } catch {
          return { closed: true };
        }
      }),
    );
    await test.info().attach("c7-student-boundary", {
      body: JSON.stringify(observed),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
