import {
  expect,
  type Page,
  type Route,
  type WebSocketRoute,
  type Dialog,
  type Locator,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { OPERATION_TIMEOUT_MS } from "../../packages/protocol/timeouts.js";

// Deliberate reload/recovery scenarios must confirm leaving an unfinished
// workspace. Do not silently dismiss the new protection and test a stale page.
export async function reloadAfterConfirmingDeparture(page: Page) {
  const accept = async (dialog: Dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.accept();
  };
  page.on("dialog", accept);
  try {
    await page.reload();
  } finally {
    page.off("dialog", accept);
  }
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export async function observeScreens(page: Page) {
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
export async function resetScreens(page: Page) {
  await page.evaluate(() => {
    (window as any).__screens = [];
  });
}
export async function onlyScreens(page: Page, allowed: string[]) {
  expect(
    (await page.evaluate(() => (window as any).__screens as string[])).filter(
      (s) => !allowed.includes(s),
    ),
  ).toEqual([]);
}
export async function simulatedMedia(page: Page, webcam = false) {
  await page.addInitScript((webcam) => {
    Object.defineProperty(document, "hasFocus", {
      value: () => true,
      configurable: true,
    });
    const stream = (source = "screen") => {
      const canvas = document.createElement("canvas");
      canvas.width = webcam ? (source === "screen" ? 960 : 480) : 640;
      canvas.height = webcam ? (source === "screen" ? 540 : 360) : 480;
      const ctx = canvas.getContext("2d")!;
      let tick = 0;
      const paint = () => {
        ctx.fillStyle = "#123456";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (webcam && source === "screen") {
          ctx.font = "15px monospace";
          ctx.fillStyle = "#e8eef7";
          for (let row = 0; row < 30; row++)
            ctx.fillText(
              `terminal${(row % 4) + 1} stress.c:${row} value=${Math.imul(tick + row, 7919) >>> 0} gcc -g stress.c -o program`,
              10,
              18 + row * 17,
            );
        } else if (webcam) {
          for (let y = 0; y < 24; y++)
            for (let x = 0; x < 32; x++) {
              const n =
                (Math.imul(x + y * 32 + tick, 2654435761) >>> 8) & 0xffffff;
              ctx.fillStyle = `#${n.toString(16).padStart(6, "0")}`;
              ctx.fillRect(x * 15, y * 15, 15, 15);
            }
        }
        tick++;
      };
      paint();
      setInterval(paint, webcam ? 1000 : 100);
      const media = canvas.captureStream(webcam ? 2 : 10),
        track = media.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: "monitor" });
      return media;
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        (window as any).__screenCaptureRequests =
          ((window as any).__screenCaptureRequests || 0) + 1;
        return stream();
      },
    });
    if (webcam)
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => stream("webcam"),
      });
    Object.defineProperty(navigator, "keyboard", {
      value: { lock: async () => {}, unlock: () => {} },
    });
  }, webcam);
}
export async function fixture(
  page: Page,
  initial = "NONE",
  role = "student",
  exam = "sandbox",
  duration = 300,
) {
  await observeScreens(page);
  await simulatedMedia(page);
  const settings = {
    id: exam,
    name: "Transition fixture",
    duration,
    webcam: false,
    terminals: 4,
    template: "sample-exam",
    earliest: 0,
    latest: 8640000000000000,
  };
  const now = Date.now();
  // These UI-only ordinary fixtures model the public initial permission and
  // its preparation binding. Actual issuance/claim authority is qualified by
  // server.ts's RosterManagement producer and authenticated HTTP/SSH callers.
  const ordinarySettings = {
      ...settings,
      earliest: now - 10000,
      latest: now + 86400000,
      template_version: "a".repeat(64),
    },
    work = {
      kind: "template",
      name: settings.template,
      hash: ordinarySettings.template_version,
    },
    permission =
      role === "student" && exam !== "sandbox"
        ? {
            id: "22222222-2222-4222-8222-222222222222",
            agent: "class",
            exam,
            username: "transition",
            revision: 1,
            issued_at: now,
            actor: "fixture-operator",
            reason: "Synthetic initial ordinary permission",
            issuance: "ENROLLMENT",
            issuance_order: 1,
            initial_grant: null,
            settings: ordinarySettings,
            work,
            hash: createHash("sha256")
              .update(JSON.stringify({ settings: ordinarySettings, work }))
              .digest("hex"),
          }
        : null;
  const model = {
    signedIn: true,
    state: initial,
    attempt: {
      id: "11111111-1111-4111-8111-111111111111",
      exam,
      username: "transition",
      uid: 10001,
      settings: JSON.stringify(permission?.settings ?? settings),
      state: initial === "NONE" ? "PREPARING" : initial,
      generation: initial === "LOCKED" ? 1 : 0,
      start: initial === "LOCKED" ? now : (null as number | null),
      deadline:
        initial === "LOCKED" ? now + duration * 1000 : (null as number | null),
      protected: false,
      work_path: "/work",
      reason: "Paused for testing",
      ...(permission
        ? {
            grant_id: permission.id,
            grant_revision: permission.revision,
            grant_hash: permission.hash,
          }
        : {}),
    },
    socket: undefined as WebSocketRoute | undefined,
    bind: gate(),
    bindSeen: false,
    authenticationGap: false,
    bindings: [] as { socket: WebSocketRoute; binding: string }[],
    onBind: undefined as
      | undefined
      | ((socket: WebSocketRoute, binding: string) => Promise<void>),
    onOpen: undefined as
      | undefined
      | ((socket: WebSocketRoute, message: any) => Promise<void>),
    recover: undefined as undefined | ((route: Route) => Promise<void>),
    status: undefined as undefined | ((route: Route) => Promise<void>),
    preflight: undefined as undefined | ((route: Route) => Promise<void>),
    claim: undefined as undefined | ((route: Route) => Promise<void>),
    finish: undefined as undefined | ((route: Route) => Promise<void>),
    logout: undefined as undefined | ((route: Route) => Promise<void>),
    continuation: undefined as undefined | ((route: Route) => Promise<void>),
    finishCalls: 0,
    logoutCalls: 0,
    onMonitoring: undefined as
      | undefined
      | ((socket: WebSocketRoute, message: any) => Promise<void>),
    messages: [] as any[],
  };
  const snapshot = () => ({
    attempt: { ...model.attempt },
    serverNow: Date.now(),
    authenticationGap: model.authenticationGap,
  });
  const reservation = () => ({
    id: model.attempt.id,
    page: "fixture-page",
    settings: permission?.settings ?? settings,
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
        model.bindings.push({ socket, binding: message.binding });
        if (model.onBind) return model.onBind(socket, message.binding);
        await model.bind.promise;
        socket.send(
          JSON.stringify({
            type: "state",
            binding: message.binding,
            ...snapshot(),
          }),
        );
      } else {
        if (message.type === "open") {
          if (model.onOpen) await model.onOpen(socket, message);
          else
            socket.send(JSON.stringify({ type: "opened", pane: message.pane }));
        }
        if (model.onMonitoring) await model.onMonitoring(socket, message);
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
                exam: role === "student" ? exam : null,
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
          ...(permission
            ? {
                settings: permission.settings,
                grants: ["NONE", "PREPARING"].includes(model.state)
                  ? [
                      {
                        ...permission,
                        status: "AVAILABLE",
                        claims:
                          model.state === "NONE"
                            ? []
                            : [
                                {
                                  attempt: model.attempt.id,
                                  revision: permission.revision,
                                  hash: permission.hash,
                                  uid: model.attempt.uid,
                                  state: "PREPARING",
                                  created_at: now,
                                  ended_at: null,
                                },
                              ],
                      },
                    ]
                  : [],
                selected_grant: ["NONE", "PREPARING"].includes(model.state)
                  ? permission.id
                  : null,
              }
            : {}),
        },
      });
    if (path === "/api/student/preflight") {
      if (model.preflight) return model.preflight(route);
      model.state = "PREPARING";
      return route.fulfill({ json: reservation() });
    }
    if (path.endsWith("/recover-page"))
      return model.recover
        ? model.recover(route)
        : route.fulfill({ json: snapshot() });
    if (path.endsWith("/claim"))
      return model.claim
        ? model.claim(route)
        : route.fulfill({ json: reservation() });
    if (path.endsWith("/status"))
      return model.status
        ? model.status(route)
        : route.fulfill({ json: snapshot() });
    // These transition fixtures model capture transport only. Actual challenge
    // freshness/security is exercised against the real authenticated server.
    if (path.endsWith("/capture-challenges"))
      return route.fulfill({
        json: {
          challenge: "synthetic-challenge",
          after_sequence: 0,
          valid_for_ms: 15000,
        },
      });
    if (path.endsWith("/monitoring-readiness"))
      return route.fulfill({
        json: { complete: true, observation_only: true, age_ms: 0 },
      });
    if (path.endsWith("/begin") || path.endsWith("/continue")) {
      if (path.endsWith("/continue") && model.continuation)
        return model.continuation(route);
      model.state = "ACTIVE";
      model.attempt.state = "ACTIVE";
      model.attempt.start ||= Date.now();
      model.attempt.deadline ||= Date.now() + duration * 1000;
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
export async function openPreflight(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  f.model.bind.release();
  await page.goto("/");
  await page.getByRole("button", { name: "Check setup and practice" }).click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
}
export async function ready(page: Page, webcam = false) {
  await page.getByRole("button", { name: "1. Share entire screen" }).click();
  if (webcam)
    await page.getByRole("button", { name: "2. Enable webcam" }).click();
  await page
    .getByRole("button", { name: `${webcam ? 3 : 2}. Enter fullscreen` })
    .click();
  await page
    .getByRole("button", {
      name: `${webcam ? 4 : 3}. Lock keyboard`,
      exact: true,
    })
    .click();
}
// Window creation precedes the verified open/input acknowledgment. Pin the
// intended windows and wait for that real boundary before driving a keyboard.
export async function selectVerifiedTerminal(page: Page, pane: Locator) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  await expect(pane.locator(".terminal[aria-busy]")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 10000 },
  );
  const input = pane.locator(".xterm-helper-textarea");
  await expect(input).toBeEnabled();
  const name = (await pane.locator(".wb-title").textContent())?.trim() || "";
  expect(name).not.toBe("");
  // An open acknowledgement does not make an inert toolbar usable. Temporary
  // challenged-capture recovery keeps both toolbar and panes inert; wait for its
  // actual release, never force a click or send keys through that barrier.
  await expect(page.locator(".exam-toolbar")).not.toHaveAttribute("inert", "", {
    timeout: remaining(),
  });
  await page
    .locator(".workspace-tools > summary")
    .click({ timeout: remaining() });
  await page
    .getByLabel("Open terminals")
    .getByRole("button", { name, exact: true })
    .click({ timeout: remaining() });
  await expect(input).toBeFocused();
  return pane;
}

export async function readyTerminal(
  page: Page,
  count: number,
  index = count - 1,
) {
  const windows = page.locator(".winbox");
  await expect(windows).toHaveCount(count);
  const ids = await windows.evaluateAll((elements) =>
    elements.map((e) => e.id),
  );
  expect(new Set(ids).size).toBe(count);
  for (const id of ids) {
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    const pane = page.locator(`.winbox[id="${id}"]`);
    await expect(pane.locator(".terminal[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "false",
      { timeout: 10000 },
    );
    await expect(pane.locator(".xterm-helper-textarea")).toBeEnabled();
  }
  const pane = page.locator(`.winbox[id="${ids[index]}"]`);
  if (count > 1) {
    await selectVerifiedTerminal(page, pane);
  } else {
    await pane.locator(".xterm-screen").click({ timeout: 5000 });
  }
  await expect(pane.locator(".xterm-helper-textarea")).toBeFocused();
  await expect(windows).toHaveCount(count);
  return pane;
}
export async function begin(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  await openPreflight(page, f);
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
}
export async function confirmFinish(page: Page) {
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await resetScreens(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saving your files" }),
  ).toBeVisible();
}
