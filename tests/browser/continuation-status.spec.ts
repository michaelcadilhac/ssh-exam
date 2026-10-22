import { test, expect } from "@playwright/test";
import { fixture, begin, simulatedMedia, ready } from "./transition-fixture.js";

// UI-only scoped metadata fixtures, not native retained-buffer qualification.
async function paused(
  page: Parameters<typeof fixture>[0],
  authenticationGap: boolean,
) {
  const f = await fixture(page, "NONE", "student", "approval-fixture");
  let revision = 1,
    state = "waiting",
    expires: number | null = null,
    offset = 0;
  f.model.status = async (route) => {
    const serverNow = Date.now() + offset;
    await route.fulfill({
      json: {
        ...f.snapshot(),
        serverNow,
        authenticationGap,
        attempt: { ...f.model.attempt, continuation_revision: revision },
        continuation: {
          v: 1,
          attempt: f.model.attempt.id,
          generation: f.model.attempt.generation,
          revision,
          state,
          expires,
          observedAt: serverNow,
          execution: false,
        },
      },
    });
  };
  await begin(page, f);
  Object.assign(f.model.attempt, {
    state: "LOCKED",
    generation: 1,
    continuation_revision: 1,
    reason: "Paused for synthetic review",
  });
  f.model.state = "LOCKED";
  f.model.authenticationGap = authenticationGap;
  f.send();
  await expect(
    page.locator('[data-continuation-state="waiting"]'),
  ).toBeVisible();
  return {
    f,
    update: (next: string, until: number | null = null) => {
      revision++;
      state = next;
      expires = until;
    },
    setOffset: (n: number) => {
      offset = n;
    },
  };
}

for (const width of [1280, 430])
  for (const authenticationGap of [false, true])
    test(`approval updates in place without unlocking or automatic sign-in (${authenticationGap ? "lost" : "retained"} metadata path, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      const p = await paused(page, authenticationGap);
      const requests: string[] = [];
      page.on("request", (r) => {
        if (
          r.method() === "POST" &&
          /\/(reauth|continue|review-request)$/.test(r.url())
        )
          requests.push(r.url());
      });
      p.update("approved", Date.now() + 60000);
      await expect(
        page.getByRole("heading", {
          name: "Continuation approved",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.locator('[data-continuation-state="approved"]'),
      ).toContainText(
        authenticationGap
          ? "SSH is disconnected"
          : "only if it is actually disconnected",
      );
      await expect(
        page.getByText("Request instructor review", { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".lock-overlay")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.keyboard.type("must-not-reach-a-terminal");
      expect(p.f.model.messages.filter((m) => m.type === "input")).toEqual([]);
      expect(requests).toEqual([]);
      if (authenticationGap)
        await expect(
          page.getByRole("button", { name: "Reconnect SSH", exact: true }),
        ).toBeVisible();
      else {
        await expect(
          page.getByRole("button", { name: "Reconnect SSH", exact: true }),
        ).toBeHidden();
        await expect(
          page.getByRole("button", {
            name: "Continue exam after authorization",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: "Continue exam after authorization",
            exact: true,
          })
          .click();
        await expect(page.locator(".lock-overlay")).toHaveCount(0);
        await expect(
          page.getByText("Exam resumed. The clock continues.", { exact: true }),
        ).toBeVisible();
        expect(
          requests.filter((url) => url.endsWith("/continue")),
        ).toHaveLength(1);
        expect(
          requests.filter(
            (url) => url.endsWith("/review-request") || url.endsWith("/reauth"),
          ),
        ).toEqual([]);
      }
    });

test("expired and revoked approvals stay explicit, and stale revision/new-generation replies cannot revive them", async ({
  page,
}) => {
  const p = await paused(page, false);
  p.update("approved", Date.now() + 3000);
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Approval expired", exact: true }),
  ).toBeVisible({ timeout: 7000 });
  p.setOffset(-10000);
  await page.waitForTimeout(2300);
  await expect(
    page.getByRole("heading", { name: "Approval expired", exact: true }),
  ).toBeVisible();
  p.setOffset(0);
  p.update("revoked", Date.now() + 60000);
  await expect(
    page.locator('[data-continuation-state="revoked"]'),
  ).toContainText("no longer valid");
  // Newer envelope time cannot make an older review revision current.
  p.f.model.status = async (route) => {
    const serverNow = Date.now() + 1000;
    await route.fulfill({
      json: {
        ...p.f.snapshot(),
        serverNow,
        continuation: {
          v: 1,
          attempt: p.f.model.attempt.id,
          generation: 1,
          revision: 2,
          state: "approved",
          expires: serverNow + 60000,
          observedAt: serverNow,
          execution: false,
        },
      },
    });
  };
  await page.waitForTimeout(2300);
  await expect(
    page.locator('[data-continuation-state="revoked"]'),
  ).toBeVisible();
  Object.assign(p.f.model.attempt, { generation: 2, continuation_revision: 4 });
  p.f.send();
  await expect(
    page.locator('[data-continuation-state="superseded"]'),
  ).toContainText("does not cover");
  await expect(page.locator(".lock-overlay")).toBeVisible();
});

test("real gateway approval reaches the paused WASM SSH page without reload, repeated review or automatic reauthentication", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("approval-feedback");
  await page.getByLabel("Enrolled username").fill("approval01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const original = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.locator('[data-continuation-state="waiting"]'),
  ).toBeVisible();
  const posts: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/(reauth|continue|review-request)$/.test(r.url())
    )
      posts.push(r.url());
  });
  const loggedIn = await request.post("/api/admin/login", {
    headers: { origin: "http://localhost:3100" },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(loggedIn.ok()).toBe(true);
  const selected = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  expect(
    (
      await request.post(`/api/admin/attempts/${original.id}/authorize`, {
        headers: {
          origin: "http://localhost:3100",
          "x-csrf-token": (await loggedIn.json()).csrf,
        },
        data: {
          generation: selected.generation,
          revision: selected.revision,
          requestID: crypto.randomUUID(),
          reason: "Reviewed synthetic live student approval feedback",
        },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-continuation-state="approved"]'),
  ).toContainText("SSH is disconnected");
  await expect(
    page.getByRole("button", { name: "Reconnect SSH", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("continuation-approved.png"),
  });
  expect(posts).toEqual([]);
  const paused = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(paused.state).toBe("LOCKED");
  expect(paused.deadline).toBe(original.deadline);
  expect(paused.original_deadline).toBe(original.original_deadline);
});
