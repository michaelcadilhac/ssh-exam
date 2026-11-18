import { test, expect } from "@playwright/test";
import { fixture, gate, openPreflight, ready } from "./transition-fixture.js";

for (const mode of ["busy", "unknown", "late"] as const)
  test(`Start ${mode} keeps the appropriate recovery workflow`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 850 });
    const f = await fixture(page, "NONE", "student", `start-health-${mode}`);
    const pending = gate();
    let starts = 0;
    await page.route("**/api/student/attempts/*/begin", async (route) => {
      starts++;
      if (starts !== 1) return route.fallback();
      await pending.promise;
      return route.fulfill({
        status: mode !== "unknown" ? 409 : 400,
        json:
          mode !== "unknown"
            ? {
                code: "EXAM_SETUP_BUSY",
                error:
                  "The server is checking exam setup. Wait a moment, then try again.",
              }
            : {
                error:
                  "Exam setup could not be confirmed. Check the current attempt status before retrying; your instructor can review the recorded failure.",
              },
      });
    });
    try {
      await openPreflight(page, f);
      await ready(page);
      await page
        .getByRole("button", { name: "Start exam", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Start exam", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Preparing exam…", exact: true }),
      ).toBeDisabled();
      await expect.poll(() => starts).toBe(1);
      if (mode === "late") {
        Object.assign(f.model.attempt, {
          state: "ACTIVE",
          start: Date.now(),
          deadline: Date.now() + 300000,
        });
        f.send();
        await expect(
          page.getByRole("button", { name: "Finish exam", exact: true }),
        ).toBeVisible();
      }
      pending.release();
      if (mode === "busy") {
        await expect(
          dialog.getByRole("heading", { name: "Start your exam?" }),
        ).toBeVisible();
        await expect(dialog.getByRole("alert")).toHaveText(
          "The server is checking exam setup. Wait a moment, then try again.",
        );
        await expect(
          dialog.getByRole("button", { name: "Start exam", exact: true }),
        ).toBeEnabled();
        await expect(dialog).not.toContainText(
          /examctl|nonce|grant|native|Workspace error/,
        );
        expect(f.model.attempt.start).toBeNull();
        expect(starts).toBe(1);
        await page.screenshot({
          path: info.outputPath("start-health-busy-mobile.png"),
        });
        await dialog
          .getByRole("button", { name: "Start exam", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Finish exam", exact: true }),
        ).toBeEnabled();
        expect(starts).toBe(2); // Only the student's second explicit click.
      } else {
        await expect(
          dialog.getByRole("heading", { name: "Workspace error" }),
        ).toBeVisible();
        await expect(dialog).toContainText(
          mode === "late"
            ? "The server is checking exam setup"
            : "Check the current attempt status before retrying",
        );
        await expect(
          dialog.getByRole("button", { name: "Start exam", exact: true }),
        ).toHaveCount(0);
        expect(starts).toBe(1);
      }
    } finally {
      pending.release();
    }
  });
