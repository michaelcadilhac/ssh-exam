import {
  test,
  expect,
  type Page,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function observeScreens(page: Page) {
  await page.addInitScript(() => {
    (window as any).__screens = [];
    const visible = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].find(
        (e) => e.getClientRects().length && !e.closest("[hidden]"),
      );
    const screen = () =>
      visible('[role="dialog"] h2')?.textContent ||
      visible(".lock-overlay h1")?.textContent ||
      (visible(".workspace")
        ? visible(".preflight")
          ? "preflight"
          : "active"
        : visible(".admin")
          ? "admin"
          : visible("form h2")?.textContent ||
            (visible(".session-loading")
              ? "loading"
              : visible(".sign-in small")
                ? "summary"
                : "empty"));
    new MutationObserver(() => {
      (window as any).__screens.push(screen());
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  });
}
async function resetScreens(page: Page) {
  await page.evaluate(() => {
    (window as any).__screens = [];
  });
}
async function onlyScreens(page: Page, allowed: string[]) {
  expect(
    (await page.evaluate(() => (window as any).__screens as string[])).filter(
      (s) => !allowed.includes(s),
    ),
  ).toEqual([]);
}
async function simulatedMedia(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", {
      value: () => true,
      configurable: true,
    });
    const stream = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      setInterval(() => {
        ctx.fillStyle = "#123456";
        ctx.fillRect(0, 0, 640, 480);
      }, 100);
      const media = canvas.captureStream(10),
        track = media.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: "monitor" });
      return media;
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => stream(),
    });
    Object.defineProperty(navigator, "keyboard", {
      value: { lock: async () => {}, unlock: () => {} },
    });
  });
}
async function fixture(page: Page, initial = "NONE", role = "student") {
  await observeScreens(page);
  await simulatedMedia(page);
  const settings = {
    id: "sandbox",
    name: "Transition fixture",
    duration: 300,
    webcam: false,
    terminals: 4,
    template: "sample-exam",
    earliest: 0,
    latest: 8640000000000000,
  };
  const now = Date.now();
  const model = {
    signedIn: true,
    state: initial,
    attempt: {
      id: "11111111-1111-4111-8111-111111111111",
      exam: "sandbox",
      username: "transition",
      uid: 10001,
      settings: JSON.stringify(settings),
      state: initial === "NONE" ? "PREPARING" : initial,
      generation: initial === "LOCKED" ? 1 : 0,
      start: initial === "LOCKED" ? now : (null as number | null),
      deadline: initial === "LOCKED" ? now + 300000 : (null as number | null),
      protected: false,
      work_path: "/work",
      reason: "Paused for testing",
    },
    socket: undefined as WebSocketRoute | undefined,
    bind: gate(),
    bindSeen: false,
    status: undefined as undefined | ((route: Route) => Promise<void>),
    preflight: undefined as undefined | ((route: Route) => Promise<void>),
    claim: undefined as undefined | ((route: Route) => Promise<void>),
    finish: undefined as undefined | ((route: Route) => Promise<void>),
    logout: undefined as undefined | ((route: Route) => Promise<void>),
    continuation: undefined as undefined | ((route: Route) => Promise<void>),
    finishCalls: 0,
    logoutCalls: 0,
    messages: [] as any[],
  };
  const snapshot = () => ({
    attempt: { ...model.attempt },
    serverNow: Date.now(),
    authenticationGap: false,
  });
  const reservation = () => ({
    id: model.attempt.id,
    page: "fixture-page",
    settings,
    attempt: { ...model.attempt },
    panes: [],
  });
  await page.routeWebSocket("**/api/student/session", (socket) => {
    model.socket = socket;
    socket.onMessage(async (raw) => {
      const message = JSON.parse(String(raw));
      model.messages.push(message);
      if (message.type === "bind") {
        model.bindSeen = true;
        await model.bind.promise;
        socket.send(JSON.stringify({ type: "state", ...snapshot() }));
      }
    });
  });
  await page.routeWebSocket("**/api/admin/events", () => {});
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false, maintenance: false } });
    if (path === "/api/session")
      return route.fulfill(
        model.signedIn
          ? {
              json: {
                role,
                username: "transition",
                exam: role === "student" ? "sandbox" : null,
                csrf: "fixture",
              },
            }
          : { status: 401, json: { error: "Authentication required" } },
      );
    if (path === "/api/admin/exams") return route.fulfill({ json: [] });
    if (path === "/api/student/exam")
      return route.fulfill({
        json: {
          exam: settings,
          enrollment: { duration: null, webcam: null },
          attempt: model.state === "NONE" ? null : { ...model.attempt },
          sshConnected: true,
        },
      });
    if (path === "/api/student/preflight") {
      if (model.preflight) return model.preflight(route);
      model.state = "PREPARING";
      return route.fulfill({ json: reservation() });
    }
    if (path.endsWith("/claim"))
      return model.claim
        ? model.claim(route)
        : route.fulfill({ json: reservation() });
    if (path.endsWith("/status"))
      return model.status
        ? model.status(route)
        : route.fulfill({ json: snapshot() });
    if (path.endsWith("/begin") || path.endsWith("/continue")) {
      if (path.endsWith("/continue") && model.continuation)
        return model.continuation(route);
      model.state = "ACTIVE";
      model.attempt.state = "ACTIVE";
      model.attempt.start ||= Date.now();
      model.attempt.deadline ||= Date.now() + 300000;
      return route.fulfill({ json: snapshot() });
    }
    if (path.endsWith("/finish")) {
      model.finishCalls++;
      return model.finish
        ? model.finish(route)
        : route.fulfill({
            status: 503,
            json: { error: "Fixture finish not configured" },
          });
    }
    if (path.endsWith("/logout")) {
      model.logoutCalls++;
      if (model.logout) return model.logout(route);
      model.signedIn = false;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return {
    model,
    snapshot,
    reservation,
    send: (attempt = model.attempt) =>
      model.socket!.send(
        JSON.stringify({
          type: "state",
          attempt: { ...attempt },
          serverNow: Date.now(),
          authenticationGap: false,
        }),
      ),
  };
}
async function openPreflight(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  f.model.bind.release();
  await page.goto("/");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
}
async function ready(page: Page) {
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
}
async function begin(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await openPreflight(page, f);
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
}
async function confirmFinish(page: Page) {
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await resetScreens(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Protecting your submission" }),
  ).toBeVisible();
}

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
      page.getByRole("button", { name: "Add administrator" }),
    ).toBeVisible();
    await resetScreens(page);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
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
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
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
