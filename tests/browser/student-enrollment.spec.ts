import { instructorSignIn } from "./prof-workflow-fixture.js";
import { test, expect } from "@playwright/test";
import { manageStudent, cancelUnused } from "./prof-workflow-fixture.js";
import { readFile } from "node:fs/promises";

test("Add student contains single entry and CSV upload with a downloadable example, safe replacement and Escape", async ({
  page,
}, testInfo) => {
  await instructorSignIn(page, "prof_enrollment");
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption("versioned-source");
  const examDefaults = (
    await (await page.request.get("/api/admin/exams")).json()
  ).find((exam: any) => exam.id === "versioned-source");
  expect(examDefaults).toBeDefined();
  // Exercise the trailing-zero fractional case that native inputs canonicalize.
  const firstAttemptCloses =
    Math.floor((examDefaults.latest + 60000) / 1000) * 1000 + 520;
  await expect(page.locator("textarea, .bulk-import")).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add student", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", {
    name: "Add students",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Username", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "One student", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("group", {
      name: "First attempt start dates",
      exact: true,
    }),
  ).toBeVisible();
  const nativeDates = await page.evaluate((at) => {
    const date = new Date(at),
      input = document.createElement("input");
    input.type = "datetime-local";
    input.step = "0.001";
    return [
      new Date(at - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 23),
      "2026-11-01T20:51:53.520",
      "2026-11-01T20:51:53.000",
      "2026-11-01T20:51:00.000",
    ].map((value) => {
      input.value = value;
      return input.value;
    });
  }, firstAttemptCloses);
  expect(nativeDates.slice(1)).toEqual([
    "2026-11-01T20:51:53.52",
    "2026-11-01T20:51:53",
    "2026-11-01T20:51",
  ]);
  await dialog.getByLabel("Closes", { exact: true }).fill(nativeDates[0]);

  await dialog
    .getByRole("group", { name: "Add students using" })
    .getByRole("button", { name: "CSV file", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator("textarea")).toHaveCount(0);
  const confirm = dialog.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  const downloaded = page.waitForEvent("download");
  await dialog
    .getByRole("link", { name: "Download example CSV", exact: true })
    .click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("example-roster.csv");
  const example = await readFile((await file.path())!, "utf8");
  expect(example.split("\n")[0]).toBe(
    "username,require_webcam,duration_minutes",
  );
  expect(example).toContain("student01,inherit,");
  expect(example).not.toContain("display_name");
  const upload = dialog.getByLabel("CSV file", { exact: true });
  await upload.setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "username,require_webcam,duration_minutes\nstudent02,false,120",
    ),
  });
  await expect(dialog.getByRole("status")).toContainText("1 validated row");
  await expect(confirm).toBeEnabled();
  await dialog
    .getByRole("group", { name: "Add students using" })
    .getByRole("button", { name: "CSV file", exact: true })
    .click();
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator(".preview")).toContainText(
    "student02 · time limit 120 min · webcam optional",
  );
  // Invalid replacement must not leave a previous valid import confirmable.
  await upload.setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("username,display_name\nstudent02,Alice"),
  });
  await expect(dialog.getByRole("alert")).toContainText("unsupported headers");
  await expect(confirm).toBeDisabled();
  await expect(dialog.locator(".preview")).toHaveCount(0);
  await upload.setInputFiles({
    name: "too-large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole("alert")).toContainText("File exceeds 10 MiB");
  await expect(confirm).toBeDisabled();
  await upload.setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "username,require_webcam,duration_minutes\nstudent02,false,120",
    ),
  });
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("add-students-csv.png") });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  const row = page
    .getByRole("table", { name: "Students and attempts" })
    .getByRole("row")
    .filter({ hasText: "student02" });
  await expect(row).toContainText("120 min");
  await expect(row).toContainText("Optional");
  await add.click();
  await expect(
    dialog.getByRole("textbox", { name: "Username", exact: true }),
  ).toHaveValue("");
  await dialog
    .getByRole("group", { name: "Add students using" })
    .getByRole("button", { name: "CSV file", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  // Enrollment-time issuance remains the real gateway transaction.
  await page.setViewportSize({ width: 430, height: 1000 });
  let grants = await manageStudent(page, "student02");
  await expect(grants).toContainText("120 min");
  const issued = (
    await (
      await page.request.get(
        "/api/admin/exams/versioned-source/grants?username=student02",
      )
    ).json()
  ).grants[0];
  expect(issued).toMatchObject({
    revision: 1,
    settings: {
      duration: 7200,
      template_version: "a".repeat(64),
      earliest: examDefaults.earliest,
      latest: firstAttemptCloses,
    },
  });
  expect(
    await grants.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await grants
    .getByRole("button", { name: "Edit settings", exact: true })
    .click();
  await grants.getByLabel("Time limit (minutes)", { exact: true }).fill("90");
  let lost = false;
  const requests: any[] = [];
  await page.route(
    "**/api/admin/exams/versioned-source/grants/change",
    async (route) => {
      requests.push(route.request().postDataJSON());
      const reply = await route.fetch();
      if (!lost) {
        lost = true;
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({ response: reply });
    },
  );
  await grants
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    grants.getByText("Change unconfirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    grants.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  await grants
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(
    grants.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await grants.getByRole("button", { name: "Done", exact: true }).click();
  grants = await manageStudent(page, "student02");
  await expect(grants).toContainText("90 min");
  await grants.getByText("Details and history", { exact: true }).click();
  await expect(grants).toContainText("Revision 2");
  await expect(grants).toContainText("120 min");
  await cancelUnused(grants);
  expect(
    (await (await page.request.get(`/api/admin/grants/${issued.id}`)).json())
      .status,
  ).toBe("REVOKED");
  await grants.getByRole("button", { name: "Done", exact: true }).click();
  await expect(row).toContainText("120 min");
  await expect(row).toContainText("First attempt: 90 min · Cancelled");
});
