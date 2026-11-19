import { test, expect } from "@playwright/test";
import { fixture, gate, openPreflight, ready } from "./transition-fixture.js";

for (const outcome of [
  "active",
  "malformed-reply",
  "review",
  "generation-changed",
  "connection-changed",
  "unknown",
] as const)
  test(`lost Start reply observes ${outcome} without replaying Start`, async ({
    page,
  }, info) => {
    const f = await fixture(page, "NONE", "student", `start-reply-${outcome}`);
    const commit = gate();
    let starts = 0,
      observe = false,
      reads = 0;
    const started = Date.now(),
      deadline = started + 300000;
    f.model.status = async (route) => {
      if (observe) {
        reads++;
        await commit.promise;
      }
      await route.fulfill({ json: f.snapshot() });
    };
    await page.route("**/api/student/attempts/*/begin", async (route) => {
      starts++;
      observe = true;
      if (outcome === "malformed-reply")
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{",
        });
      else await route.abort("timedout");
    });
    try {
      await openPreflight(page, f);
      await ready(page);
      await page
        .getByRole("button", { name: "Start exam", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Start exam", exact: true })
        .click();
      await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
        "Checking whether your exam started…",
      );
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Cancel", exact: true }),
      ).toHaveCount(0);
      await expect.poll(() => reads).toBeGreaterThan(0);
      expect(starts).toBe(1);
      expect(f.model.attempt.start).toBeNull();
      if (outcome === "unknown") {
        await page.clock.install();
        commit.release();
        await page.clock.runFor(61000);
        await expect(page.getByRole("dialog")).toContainText(
          "We could not confirm whether your exam started",
        );
      } else {
        Object.assign(f.model.attempt, {
          state: outcome === "review" ? "LOCKED" : "ACTIVE",
          generation:
            outcome === "review" || outcome === "generation-changed" ? 1 : 0,
          start: started,
          deadline,
        });
        if (outcome === "connection-changed") {
          await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        }
        commit.release();
        if (outcome === "active" || outcome === "malformed-reply") {
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(page.locator(".winbox")).toHaveCount(1);
          await expect(page.locator(".terminal[aria-busy]")).toHaveAttribute(
            "aria-busy",
            "false",
          );
          await expect(page.locator(".xterm-helper-textarea")).toBeEnabled();
          const input = page.locator(".xterm-helper-textarea");
          await input.focus();
          await input.pressSequentially("echo preserved");
          await expect
            .poll(() =>
              f.model.messages
                .filter((m) => m.type === "input")
                .map((m) => m.data)
                .join(""),
            )
            .toBe("echo preserved");
        } else {
          await expect(page.getByRole("dialog")).toContainText(
            outcome === "review"
              ? "instructor"
              : outcome === "generation-changed"
                ? "status changed"
                : "connection",
          );
          expect(f.model.messages.filter((m) => m.type === "open")).toEqual([]);
        }
        expect(f.model.attempt.start).toBe(started);
        expect(f.model.attempt.deadline).toBe(deadline);
      }
      expect(starts).toBe(1);
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Start exam", exact: true }),
      ).toHaveCount(0);
      if (outcome === "unknown") {
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Start exam", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Sign out", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Practice terminal", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText(
            "Open a practice terminal to try your tools before the exam.",
            { exact: true },
          ),
        ).toHaveCount(0);
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Time may already be running" }),
        ).toBeVisible();
        expect(starts).toBe(1);
      }
      await page.screenshot({
        path: info.outputPath(`start-reply-${outcome}.png`),
      });
    } finally {
      commit.release();
    }
  });
