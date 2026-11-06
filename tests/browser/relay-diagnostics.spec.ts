import { test, expect } from "@playwright/test";

for (const expires of [false, true])
  test(`real WASM relay ${expires ? "expires at sixty seconds" : "survives a sixteen-second startup delay"} without starting time`, async ({
    page,
  }, info) => {
    test.setTimeout(expires ? 90000 : 45000);
    await page.goto("/");
    expect(
      (await (await page.request.get("/api/login-test")).json()).browserSSH,
    ).toBe(true);
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
          const data = await (
            await page.request.get("/api/fixture/transport-diagnostics")
          ).json();
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
      const metadata = await (
        await page.request.get("/api/fixture/transport-diagnostics")
      ).json();
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
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible({
        timeout: 25000,
      });
      expect(Date.now() - readyAt).toBeGreaterThanOrEqual(16000);
    }
    const metadata = await (
      await page.request.get("/api/fixture/transport-diagnostics")
    ).json();
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

test("real WASM SSH loss retains only a correlated close category through gateway worker IPC", async ({
  page,
}) => {
  test.setTimeout(30000);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
  await page.getByLabel("Username").fill("relaydiag03");
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
    page.getByRole("button", { name: "Check setup and practice", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const session = await (await page.request.get("/api/session")).json();
  const close = await page.request.post("/api/fixture/diagnostic-relay-close", {
    headers: { origin: "http://localhost:3100", "x-csrf-token": session.csrf },
    data: { username: "relaydiag03" },
  });
  expect(close.ok(), await close.text()).toBe(true);
  let rows: any[] = [];
  await expect
    .poll(
      async () => {
        const data = await (
          await page.request.get("/api/fixture/transport-diagnostics")
        ).json();
        rows = data.observations
          .map((r: any) => JSON.parse(r.detail))
          .filter((v: any) => v.username === "relaydiag03");
        return rows.some((v: any) =>
          ["ssh-wait", "ssh-keepalive"].includes(v.stage),
        );
      },
      { timeout: 8000 },
    )
    .toBe(true);
  expect(rows.every((v: any) => /^[a-f0-9]{24}$/.test(v.relay_reference))).toBe(
    true,
  );
  const correlation = await (
    await page.request.get("/api/fixture/transport-diagnostics")
  ).json();
  expect(
    rows.every(
      (v: any) => v.relay_reference === correlation.relayReferences.relaydiag03,
    ),
  ).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE");
  expect(JSON.stringify(rows)).not.toContain("shared-password");
});
