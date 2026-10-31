import { test, expect, type Page } from "@playwright/test";
import { simulatedMedia, ready, readyTerminal } from "./transition-fixture.js";
const origin = "http://localhost:3100";
async function signIn(page: Page, exam: string, username: string) {
  await page.getByLabel("Exam ID", { exact: true }).fill(exam);
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
async function begin(page: Page, exam: string, user: string) {
  await simulatedMedia(page);
  await page.goto("/");
  await signIn(page, exam, user);
  await page.getByRole("button", { name: "Check setup and practice" }).click();
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await readyTerminal(page, 1);
  return (await (await page.request.get("/api/student/exam")).json()).attempt;
}
async function echo(page: Page, word: string) {
  const pane = await readyTerminal(page, 1);
  await page.keyboard.type(`probe-${word}`);
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-rows")).toContainText(
    `Echo: probe-${word}`,
  );
}
async function restore(page: Page, admin: Page, headers: any, id: string) {
  const selected = await (
    await admin.request.get(`/api/admin/attempts/${id}/interruption`)
  ).json();
  const grant = await admin.request.post(
    `/api/admin/attempts/${id}/authorize`,
    {
      headers,
      data: {
        generation: selected.generation,
        revision: selected.revision,
        requestID: crypto.randomUUID(),
        reason: "Reviewed synthetic worker interruption",
      },
    },
  );
  expect(grant.ok()).toBe(true);
  const history = async () =>
    (
      await (
        await admin.request.get(
          `/api/admin/exams/isolation-a/dashboard?review=${id}`,
        )
      ).json()
    ).reviewAttempt.interruptions;
  const approved = (await history()).at(-1);
  expect(approved.outcome).toBeNull();
  expect(approved.ended).toBeNull();
  expect(approved.authorizations.at(-1).actor).toBe("instructor");
  expect(approved.authorizations.at(-1).used_at).toBeUndefined();

  await page.reload();
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await signIn(page, "isolation-a", "isolation01");
  const claimed = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/student/attempts/${id}/claim`,
  );
  await page
    .getByRole("button", {
      name: "Resume exam",
      exact: true,
    })
    .click();
  expect((await claimed).status()).toBe(200);
  await expect(page.locator(".lock-overlay")).toBeVisible();
  await expect(page.locator(".winbox")).toHaveCount(0);
  for (const name of [
    "Restore screen sharing",
    "Restore fullscreen",
    "Restore keyboard lock",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  const continued = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/student/attempts/${id}/continue`,
  );
  await page
    .getByRole("button", {
      name: "Resume exam",
      exact: true,
    })
    .click();
  expect((await continued).status()).toBe(200);
  await expect(page.locator(".lock-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await readyTerminal(page, 1);
  const resumed = (await history()).at(-1);
  expect(resumed.id).toBe(approved.id);
  expect(resumed.outcome).toBe("resumed");
  expect(resumed.ended).toBeGreaterThanOrEqual(resumed.opened);
  expect(resumed.authorizations.at(-1).used_at).toBe(resumed.ended);
}
test("attempt exceptions, unhandled rejections, process death and hangs leave another active SSH exam working and send recoverable email alerts", async ({
  browser,
}) => {
  test.setTimeout(200000);
  const a = await browser.newContext(),
    b = await browser.newContext(),
    instructor = await browser.newContext();
  const alice = await a.newPage(),
    bob = await b.newPage(),
    admin = await instructor.newPage();
  const runtime = async () =>
    (await admin.request.get(origin + "/api/fixture/runtime")).json();
  try {
    const originalA = await begin(alice, "isolation-a", "isolation01");
    // Begin completed after the first start packet: this is a conservative
    // lower bound for waiting out that server-side authentication window.
    const authenticationWindowStarted = Date.now();
    const originalB = await begin(bob, "isolation-b", "isolation02");
    const login = await admin.request.post(origin + "/api/admin/login", {
      headers: { origin },
      data: { username: "instructor", password: "fixture-password" },
    });
    const headers = { origin, "x-csrf-token": (await login.json()).csrf };
    const initial = await runtime();
    const bobPid = initial.workers.find(
      (w: any) => w.username === "isolation02",
    ).pid;
    expect(bobPid).not.toBe(initial.pid);
    await echo(alice, "saved");
    await alice.keyboard.type("save saved answer");
    await alice.keyboard.press("Enter");
    await expect(alice.locator(".xterm-rows")).toContainText(
      "Saved fixture text",
    );
    for (const [index, fault] of [
      "exception",
      "rejection",
      "kill",
      "hang",
      "heap",
    ].entries()) {
      if (index === 0)
        await admin.request.post(origin + "/api/fixture/mail", {
          headers,
          data: { reject: true },
        });
      const crashed = await admin.request.post(origin + "/api/fixture/fault", {
        headers,
        data: { username: "isolation01", fault },
      });
      expect(crashed.ok(), await crashed.text()).toBe(true);
      const crashedPid = (await crashed.json()).pid;
      expect(crashedPid).not.toBe(bobPid);
      await expect(
        alice.getByRole("heading", { name: "Instructor review required" }),
      ).toBeVisible({ timeout: 20000 });
      const data = await runtime();
      expect(data.pid).toBe(initial.pid);
      expect(
        data.workers.find((w: any) => w.username === "isolation02").pid,
      ).toBe(bobPid);
      expect(data.workers.some((w: any) => w.pid === crashedPid)).toBe(false);
      await expect
        .poll(async () =>
          (await runtime()).panes.filter(
            (p: any) => p.attempt === originalA.id,
          ),
        )
        .toHaveLength(0);
      await echo(bob, fault);
      const stateB = (await (await bob.request.get("/api/student/exam")).json())
        .attempt;
      expect(stateB).toMatchObject({
        id: originalB.id,
        state: "ACTIVE",
        deadline: originalB.deadline,
        original_deadline: originalB.original_deadline,
      });
      await alice
        .getByRole("button", { name: "Reconnect SSH", exact: true })
        .click();
      await expect(alice.getByRole("alert")).toContainText(
        "Ask your instructor to approve resuming",
      );
      const alerts = data.outbox.filter(
        (m: any) => m.subject === "Exam connection failure: isolation01",
      );
      expect(alerts).toHaveLength(index + 1);
      expect(alerts[index].body).toContain("Exam: isolation-a");
      expect(alerts[index].body).toContain("Student: isolation01");
      expect(alerts[index].body).toContain(`Attempt: ${originalA.id}`);
      expect(JSON.stringify(data.outbox)).not.toMatch(
        /synthetic-private-secret|terminal contents|shared-password|Class agent unavailable/,
      );
      if (index === 0) {
        await expect
          .poll(
            async () =>
              (await runtime()).outbox.find(
                (m: any) =>
                  m.subject === "Exam connection failure: isolation01",
              )?.tries,
            { timeout: 10000 },
          )
          .toBeGreaterThan(0);
        await admin.request.post(origin + "/api/fixture/mail", {
          headers,
          data: { reject: false },
        });
      }
      await expect
        .poll(
          async () =>
            (await runtime()).emails.filter((m: string) =>
              m.includes("Subject: Exam connection failure: isolation01"),
            ).length,
          { timeout: 12000 },
        )
        .toBe(index + 1);
      // Initial login plus five recoveries exceed the real five-sign-ins/minute
      // protection if this fixture runs quickly. Do not disable/reset that limit
      // or retry cached credentials: wait for the original window before the
      // sixth deliberate sign-in. All fault/healthy-work assertions still run.
      if (index === 4)
        await expect
          .poll(() => Date.now() - authenticationWindowStarted, {
            timeout: 65000,
            intervals: [1000],
          })
          .toBeGreaterThanOrEqual(61000);
      await restore(alice, admin, headers, originalA.id);
      const resumed = (
        await (await alice.request.get("/api/student/exam")).json()
      ).attempt;
      expect(resumed).toMatchObject({
        id: originalA.id,
        state: "ACTIVE",
        deadline: originalA.deadline,
        original_deadline: originalA.original_deadline,
      });
      const pane = await readyTerminal(alice, 1);
      await alice.keyboard.type("cat");
      await alice.keyboard.press("Enter");
      await expect(pane.locator(".xterm-rows")).toContainText("saved answer");
      await expect(alice.locator(".winbox")).toHaveCount(1);
      expect(
        (await runtime()).panes.filter((p: any) => p.attempt === originalA.id),
      ).toHaveLength(1);
    }
    const final = await runtime();
    expect(final.pid).toBe(initial.pid);
    expect(
      final.emails.filter((m: string) =>
        m.includes("Subject: Exam connection failure: isolation01"),
      ),
    ).toHaveLength(5);
    expect(JSON.stringify(final.emails)).not.toContain(
      "synthetic-private-secret",
    );
    await echo(bob, "all-faults-survived");
    expect((await admin.request.get(origin + "/health/live")).ok()).toBe(true);
  } finally {
    await Promise.all([a.close(), b.close(), instructor.close()]);
  }
});
