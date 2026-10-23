import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Add student contains single entry and CSV upload with a downloadable example, safe replacement and Escape", async ({
  page,
}, testInfo) => {
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption("versioned-source");
  await expect(page.locator("textarea, .bulk-import")).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add student", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", {
    name: "Add students",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Student username", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "One student", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog
    .getByRole("group", { name: "Add students using" })
    .getByRole("button", { name: "CSV file", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Student username", { exact: true }),
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
    "student02 · duration 120 minutes · webcam not required",
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
  await expect(row).toContainText("Duration: 120 minutes");
  await expect(row).toContainText("Not required");
  await add.click();
  await expect(
    dialog.getByLabel("Student username", { exact: true }),
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
  // This exact-version exam exercises actual enrollment-time grant issuance,
  // not a mocked catalog or automatic legacy backfill.
  await page.setViewportSize({ width: 430, height: 1000 });
  await row
    .getByRole("button", { name: "Actions for student student02", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  const grants = page.getByRole("dialog", {
    name: "Attempt grants for student02",
    exact: true,
  });
  await expect(grants).toContainText("Saved allowance: 120 minutes");
  await expect(grants).toContainText("revision 1");
  expect(
    await grants.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    grants.getByLabel("Exact attested template hash", { exact: true }),
  ).toHaveValue("a".repeat(64));
  await grants.getByLabel("Allowance seconds", { exact: true }).fill("5400");
  await grants
    .getByLabel("Reason", { exact: true })
    .fill("Explicit unused browser grant revision");
  let lost = false;
  const requests: any[] = [];
  await page.route("**/api/admin/grants/*/revise", async (route) => {
    requests.push(route.request().postDataJSON());
    const reply = await route.fetch();
    if (!lost) {
      lost = true;
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ response: reply });
  });
  await grants
    .getByRole("button", { name: "Revise unused grant", exact: true })
    .click();
  await expect(grants.getByRole("alert")).toBeVisible();
  await expect(
    grants.getByLabel("Allowance seconds", { exact: true }),
  ).toBeDisabled();
  await grants
    .getByRole("button", { name: "Retry original revision", exact: true })
    .click();
  await expect(grants).toContainText("revision 2");
  await expect(grants).toContainText("Saved allowance: 90 minutes");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await grants.getByText("Immutable revision history", { exact: true }).click();
  await expect(grants.locator("details li")).toHaveCount(2);
  await grants
    .getByLabel("Reason", { exact: true })
    .fill("Withdraw this unused browser grant");
  await grants
    .getByRole("button", { name: "Revoke unused grant", exact: true })
    .click();
  await expect(grants).toContainText("REVOKED");
  await expect(
    grants.getByRole("button", { name: "Revise unused grant", exact: true }),
  ).toHaveCount(0);
  await grants
    .getByRole("button", { name: "Close grants", exact: true })
    .click();
  await expect(row).toContainText("Duration: 120 minutes");
  await expect(row).toContainText("Initial grant: 90 min · REVOKED");
});
