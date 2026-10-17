import { test, expect } from "@playwright/test";
import {
  gate,
  fixture,
  openPreflight,
  ready,
  begin,
  confirmFinish,
  resetScreens,
  onlyScreens,
} from "./transition-fixture.js";

test("administrator sign-out stays on its current screen during failure/retry and returns directly to instructor sign-in", async ({
  page,
}) => {
  const f = await fixture(page, "NONE", "admin"),
    response = gate();
  let fail = true,
    seen = false;
  f.model.logout = async (route) => {
    seen = true;
    await response.promise;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Sign-out unavailable" },
      });
    f.model.signedIn = false;
    await route.fulfill({ json: { ok: true } });
  };
  try {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Administration", exact: true }),
    ).toBeVisible();
    await resetScreens(page);
    await page
      .getByRole("button", { name: "Administration", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect.poll(() => seen).toBe(true);
    await expect(
      page.getByRole("button", { name: "Signing out…" }),
    ).toBeDisabled();
    await onlyScreens(page, ["admin"]);
    response.release();
    await expect(page.getByRole("alert")).toContainText("Sign-out unavailable");
    await onlyScreens(page, ["admin"]);
    fail = false;
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await page
      .getByRole("button", { name: "Administration", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Instructor sign-in" }),
    ).toBeVisible();
    await expect(page).toHaveURL("/admin");
    await onlyScreens(page, ["admin", "Instructor sign-in"]);
  } finally {
    response.release();
  }
});

test("opening preflight retains the summary until ready and never reports a fresh connection as reconnecting", async ({
  page,
}) => {
  const f = await fixture(page),
    response = gate();
  let seen = false;
  f.model.preflight = async (route) => {
    seen = true;
    await response.promise;
    f.model.state = "PREPARING";
    await route.fulfill({ json: f.reservation() });
  };
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open preflight & practice" })
      .waitFor();
    await resetScreens(page);
    await page
      .getByRole("button", { name: "Open preflight & practice" })
      .click();
    await expect.poll(() => seen).toBe(true);
    await expect(
      page.getByRole("button", { name: "Opening preflight…" }),
    ).toBeDisabled();
    await onlyScreens(page, ["summary"]);
    response.release();
    await expect.poll(() => f.model.bindSeen).toBe(true);
    await expect(page.getByText("Connecting…", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0);
    await onlyScreens(page, ["summary", "preflight"]);
    f.model.bind.release();
    await expect(
      page.getByRole("button", { name: "Practice terminal", exact: true }),
    ).toBeEnabled();
    await onlyScreens(page, ["summary", "preflight"]);
  } finally {
    response.release();
    f.model.bind.release();
  }
});

test("preflight sign-out keeps its confirmation throughout a delayed request and Escape cannot uncover the workspace", async ({
  page,
}) => {
  const f = await fixture(page),
    response = gate();
  let seen = false;
  f.model.logout = async (route) => {
    seen = true;
    await response.promise;
    f.model.signedIn = false;
    await route.fulfill({ json: { ok: true } });
  };
  try {
    await openPreflight(page, f);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await resetScreens(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect.poll(() => seen).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign out", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await onlyScreens(page, ["Sign out of the workspace?"]);
    response.release();
    await expect(
      page.getByRole("heading", { name: "Connect to your exam" }),
    ).toBeVisible();
    await onlyScreens(page, [
      "Sign out of the workspace?",
      "Connect to your exam",
    ]);
  } finally {
    response.release();
  }
});

test("a restored paused exam is covered from its first frame; continuation ignores late locked replies but honors a new lock", async ({
  page,
}) => {
  const f = await fixture(page, "LOCKED"),
    claim = gate(),
    stale = gate();
  let claimSeen = false,
    staleSeen = false,
    oldStatus: any;
  f.model.claim = async (route) => {
    claimSeen = true;
    await claim.promise;
    await route.fulfill({ json: f.reservation() });
  };
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Restore page", exact: true })
      .waitFor();
    await resetScreens(page);
    await page
      .getByRole("button", { name: "Restore page", exact: true })
      .click();
    await expect.poll(() => claimSeen).toBe(true);
    await expect(
      page.getByRole("button", { name: "Restoring exam…" }),
    ).toBeDisabled();
    await onlyScreens(page, ["summary"]);
    claim.release();
    await expect.poll(() => f.model.bindSeen).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    await onlyScreens(page, ["summary", "Exam paused"]);
    f.model.bind.release();
    await page.getByRole("button", { name: "Restore screen sharing" }).click();
    await page
      .getByRole("button", { name: "Restore fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore keyboard lock", exact: true })
      .click();
    f.model.status = async (route) => {
      if (!staleSeen) {
        staleSeen = true;
        oldStatus = f.snapshot();
        await stale.promise;
        await route.fulfill({ json: oldStatus });
      } else await route.fulfill({ json: f.snapshot() });
    };
    await expect.poll(() => staleSeen).toBe(true);
    let fail = true;
    f.model.continuation = async (route) => {
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: "Continuation unavailable" },
        });
      f.model.attempt.state = "ACTIVE";
      await route.fulfill({ json: f.snapshot() });
    };
    await page
      .getByRole("button", { name: "Continue exam", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Continuation unavailable",
    );
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    fail = false;
    await resetScreens(page);
    await page
      .getByRole("button", { name: "Continue exam", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Finish exam", exact: true }),
    ).toBeEnabled();
    stale.release();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await onlyScreens(page, ["Exam paused", "active"]);
    f.model.socket!.send(JSON.stringify({ type: "state", ...oldStatus }));
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toHaveCount(0);
    f.model.attempt.state = "LOCKED";
    f.model.attempt.generation++;
    f.send();
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
  } finally {
    claim.release();
    stale.release();
    f.model.bind.release();
  }
});

test("finish stays on collection through stale active replies, early secured events, delayed logout and logout retry", async ({
  page,
}) => {
  const f = await fixture(page),
    finish = gate(),
    logout = gate(),
    stale = gate();
  let staleSeen = false,
    finishSeen = false,
    logoutSeen = false,
    failLogout = true;
  f.model.status = async (route) => {
    if (!staleSeen && f.model.attempt.state === "ACTIVE") {
      staleSeen = true;
      const result = f.snapshot();
      await stale.promise;
      await route.fulfill({ json: result });
    } else await route.fulfill({ json: f.snapshot() });
  };
  f.model.finish = async (route) => {
    finishSeen = true;
    await finish.promise;
    await route.fulfill({ json: f.snapshot() });
  };
  f.model.logout = async (route) => {
    logoutSeen = true;
    if (failLogout)
      return route.fulfill({
        status: 503,
        json: { error: "Sign-out unavailable" },
      });
    await logout.promise;
    f.model.signedIn = false;
    await route.fulfill({ json: { ok: true } });
  };
  try {
    await begin(page, f);
    await expect.poll(() => staleSeen).toBe(true);
    await confirmFinish(page);
    await expect.poll(() => finishSeen).toBe(true);
    const incidents = f.model.messages.filter(
      (m) => m.type === "incident",
    ).length;
    f.send({ ...f.model.attempt, state: "ACTIVE" });
    // The next heartbeat must not re-arm monitoring after confirmed Finish.
    await page.waitForTimeout(2200);
    expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(
      incidents,
    );
    stale.release();
    await onlyScreens(page, ["Finish exam?", "Protecting your submission"]);
    f.model.attempt.state = "COMPLETED";
    f.model.attempt.protected = true;
    f.send();
    await expect(
      page.getByRole("heading", { name: "Protecting your submission" }),
    ).toBeVisible();
    expect(f.model.logoutCalls).toBe(0);
    await onlyScreens(page, ["Finish exam?", "Protecting your submission"]);
    finish.release();
    await expect.poll(() => logoutSeen).toBe(true);
    await expect(page.getByRole("alert")).toContainText("Sign-out unavailable");
    await expect(
      page.getByRole("heading", { name: "Submission secured", exact: true }),
    ).toHaveCount(0);
    failLogout = false;
    await page.getByRole("button", { name: "Retry sign out" }).click();
    await expect.poll(() => f.model.logoutCalls).toBe(2);
    await onlyScreens(page, ["Finish exam?", "Protecting your submission"]);
    logout.release();
    await expect(
      page.getByRole("heading", { name: "Connect to your exam" }),
    ).toBeVisible();
    await onlyScreens(page, [
      "Finish exam?",
      "Protecting your submission",
      "Connect to your exam",
    ]);
    expect(f.model.finishCalls).toBe(1);
  } finally {
    finish.release();
    logout.release();
    stale.release();
  }
});

test("an unconfirmed finish is retryable in place and a failed collection never flashes success or sign-in", async ({
  page,
}) => {
  const f = await fixture(page);
  let fail = true;
  f.model.finish = async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Finish service unavailable" },
      });
    f.model.attempt.state = "COLLECTION_FAILED";
    f.model.attempt.protected = false;
    await route.fulfill({ json: f.snapshot() });
  };
  await begin(page, f);
  await confirmFinish(page);
  await expect(page.getByRole("alert")).toContainText(
    "Finish service unavailable",
  );
  f.send({ ...f.model.attempt, state: "ACTIVE" });
  await expect(
    page.getByRole("heading", { name: "Protecting your submission" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry finishing" }).click();
  await expect(
    page.getByRole("heading", { name: "Collection requires recovery" }),
  ).toBeVisible();
  await onlyScreens(page, [
    "Finish exam?",
    "Protecting your submission",
    "Collection requires recovery",
  ]);
  expect(f.model.logoutCalls).toBe(0);
});
