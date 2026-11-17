import { test, expect } from "@playwright/test";
import { fixture, gate, openPreflight } from "./transition-fixture.js";

for (const failed of ["challenge", "upload"]) {
  test(`preflight recovers a cancelled ${failed} without another media prompt, stale modal or clock`, async ({
    page,
  }) => {
    const f = await fixture(
      page,
      "NONE",
      "student",
      `capture-${failed}`,
      300,
      true,
    );
    Object.assign(f.model.attempt, { monitoring_mode: "v1" });
    const recovery = gate();
    let failedOnce = false,
      challenges = 0;
    const frames: { challenge: string; seq: number }[] = [];
    await page.route("**/capture-challenges", async (route) => {
      challenges++;
      if (failed === "challenge" && !failedOnce) {
        failedOnce = true;
        return route.abort("failed");
      }
      if (failedOnce) await recovery.promise;
      await route.fulfill({
        json: { challenge: `fresh-${challenges}`, after_sequence: 0 },
      });
    });
    await page.route("**/frames/challenged", async (route) => {
      const frame = route.request().postDataJSON();
      if (failed === "upload" && !failedOnce) {
        failedOnce = true;
        return route.abort("failed");
      }
      frames.push({ challenge: frame.challenge, seq: frame.seq });
      await route.fulfill({ json: { ok: true } });
    });
    let starts = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/begin")) starts++;
    });
    try {
      await openPreflight(page, f);
      await page
        .getByRole("button", { name: "1. Share entire screen", exact: true })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({
            hasText: "Sharing check delayed. Retrying automatically.",
          }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "1. Share entire screen",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: "2. Enable webcam", exact: true })
        .click();
      await page
        .getByRole("button", { name: "3. Enter fullscreen", exact: true })
        .click();
      await page
        .getByRole("button", { name: "4. Lock keyboard", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Start exam", exact: true }),
      ).toBeDisabled();
      expect(f.model.attempt.start).toBeNull();
      expect(starts).toBe(0);
      recovery.release();
      await expect(
        page.getByRole("button", { name: "Start exam", exact: true }),
      ).toBeEnabled();
      expect(
        await page.evaluate(() => (window as any).__screenCaptureRequests),
      ).toBe(1);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(challenges).toBeGreaterThanOrEqual(3);
      expect(f.model.attempt.start).toBeNull();
      expect(starts).toBe(0);
      expect(
        f.model.messages.filter((message) => message.type === "incident"),
      ).toEqual([]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      recovery.release();
    }
  });
}
