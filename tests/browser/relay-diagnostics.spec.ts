import { test, expect, type Page } from "@playwright/test";
import { waitForStressPasswordPrompt } from "../fixtures/stress-navigation.js";

async function diagnostics(page: Page) {
  const response = await page.request.get("/api/fixture/transport-diagnostics");
  expect(response.ok(), await response.text()).toBe(true);
  const value = await response.json();
  expect(value).toMatchObject({
    relayReadyAt: expect.any(Object),
    relayReferences: expect.any(Object),
    observations: expect.any(Array),
    attempts: expect.any(Array),
  });

  return value;
}

async function assertBrowserSSH(page: Page) {
  const response = await page.request.get("/api/login-test");
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json()).browserSSH).toBe(true);
}

for (const expires of [false, true])
  test(`real WASM relay ${expires ? "expires at sixty seconds" : "survives a sixteen-second startup delay"} without starting time`, async ({
    page,
  }, info) => {
    test.setTimeout(expires ? 90000 : 45000);
    await page.goto("/");
    await assertBrowserSSH(page);
    await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
    const username = expires ? "relaydiag02" : "relaydiag01";
    await page.getByLabel("Username").fill(username);
    const startedAt = Date.now();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click({ timeout: 5000 });
    let readyAt = 0;
    await expect
      .poll(
        async () => {
          const data = await diagnostics(page);
          return (readyAt = data.relayReadyAt[username] || 0);
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    if (expires) {
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 70000 });
      await expect(page.getByRole("alert")).toContainText(
        /Sign-in did not finish|SSH sign-in failed/,
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(59000);
      const metadata = await diagnostics(page);
      const rows = metadata.observations
        .map((r: any) => JSON.parse(r.detail))
        .filter((v: any) => v.username === username);
      expect(
        rows.some(
          (v: any) =>
            (v.cause === "timeout" &&
              ["connect", "relay-ready"].includes(v.stage)) ||
            (v.cause === "operation-timeout" && v.operation === "connect"),
        ),
      ).toBe(true);
      expect(
        rows.every((v: any) => /^[a-f0-9]{24}$/.test(v.relay_reference)),
      ).toBe(true);
    } else {
      page.setDefaultTimeout(10000);
      await waitForStressPasswordPrompt(page, console.log);
      expect(Date.now() - readyAt).toBeGreaterThanOrEqual(16000);
    }
    const metadata = await diagnostics(page);
    expect(
      metadata.attempts.filter((a: any) => a.username === username),
    ).toEqual([]);
    await info.attach("relay-startup-timing", {
      body: JSON.stringify({
        expires,
        elapsedAfterRelayReadyMS: Date.now() - readyAt,
      }),
      contentType: "application/json",
    });
  });

for (const [username, mode, code] of [
  ["relaydiag03", "private", 4001],
  ["relaydiag04", "normal", 1000],
  ["relaydiag05", "going-away", 1001],
  ["relaydiag06", "abnormal", 1006],
] as const)
  test(`real WASM ${mode} SSH closure retains the browser code and correlated category through gateway worker IPC`, async ({
    page,
  }) => {
    test.setTimeout(30000);
    await page.goto("/");
    await assertBrowserSSH(page);
    await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
    await page.getByLabel("Username").fill(username);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click({ timeout: 5000 });
    await page
      .getByLabel("Password", { exact: true })
      .fill("shared-password", { timeout: 10000 });
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .click({ timeout: 10000 });
    await expect(
      page.getByRole("button", {
        name: "Check setup and practice",
        exact: true,
      }),
    ).toBeVisible({ timeout: 10000 });
    const session = await (await page.request.get("/api/session")).json();
    const close = await page.request.post(
      "/api/fixture/diagnostic-relay-close",
      {
        headers: {
          origin: "http://localhost:3100",
          "x-csrf-token": session.csrf,
        },
        data: { username, mode },
      },
    );
    expect(close.ok(), await close.text()).toBe(true);
    let rows: any[] = [];
    await expect
      .poll(
        async () => {
          const data = await diagnostics(page);
          rows = data.observations
            .map((r: any) => JSON.parse(r.detail))
            .filter((v: any) => v.username === username);
          return (
            rows.some(
              (v: any) =>
                v.stage === "relay-socket-close" &&
                v.cause === "peer-close" &&
                v.close_code === code,
            ) &&
            rows.some((v: any) =>
              ["ssh-wait", "ssh-keepalive"].includes(v.stage),
            )
          );
        },
        { timeout: 8000 },
      )
      .toBe(true);
    expect(
      rows.every((v: any) => /^[a-f0-9]{24}$/.test(v.relay_reference)),
    ).toBe(true);
    const correlation = await diagnostics(page);
    expect(
      rows.every(
        (v: any) => v.relay_reference === correlation.relayReferences[username],
      ),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    expect(JSON.stringify(rows)).not.toContain("shared-password");
    expect(
      rows.find(
        (v: any) =>
          v.stage === "relay-socket-close" && v.cause === "peer-close",
      ),
    ).toMatchObject({
      close_code: code,
      was_clean: mode !== "abnormal",
      visible: expect.any(Boolean),
      focused: expect.any(Boolean),
      online: expect.any(Boolean),
    });
  });

test("preflight lifecycle observations cross the real WASM control channel as diagnostics without starting or locking an attempt", async ({
  page,
}) => {
  test.setTimeout(30000);
  await page.goto("/");
  await assertBrowserSSH(page);
  await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
  await page.getByLabel("Username").fill("relaydiag07");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .click({ timeout: 5000 });
  await page
    .getByLabel("Password", { exact: true })
    .fill("shared-password", { timeout: 10000 });
  await page
    .getByRole("button", { name: "Continue", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click({ timeout: 10000 });
  await expect(
    page.getByRole("button", { name: "Start exam", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  // Explicit lifecycle fixtures exercise the real page handler/control/IPC path;
  // this is not a claim to simulate physical network loss or a browser crash.
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(
      async () => {
        const data = await diagnostics(page);
        return data.observations
          .map((r: any) => JSON.parse(r.detail))
          .filter(
            (r: any) =>
              r.username === "relaydiag07" && r.stage === "browser-lifecycle",
          )
          .map((r: any) => r.cause);
      },
      { timeout: 8000 },
    )
    .toEqual(
      expect.arrayContaining([
        "page-hide",
        "network-offline",
        "network-online",
      ]),
    );
  const data = await diagnostics(page);
  const rows = data.observations
    .map((r: any) => JSON.parse(r.detail))
    .filter((r: any) => r.username === "relaydiag07");
  expect(rows.find((r: any) => r.cause === "page-hide")).toMatchObject({
    page_persisted: true,
    relay_reference: data.relayReferences.relaydiag07,
  });
  expect(JSON.stringify(rows)).not.toContain("shared-password");
  expect(
    data.attempts.find((a: any) => a.username === "relaydiag07"),
  ).toMatchObject({ state: "PREPARING", start: null, deadline: null });
});
