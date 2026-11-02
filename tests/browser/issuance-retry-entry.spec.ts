import { expect, test } from "@playwright/test";

for (const applied of [false, true]) {
  test(`a saved creation request remains accessible when its student already has a next attempt (applied=${applied})`, async ({
    page,
  }) => {
    page.setDefaultTimeout(6000);
    const exam = "creation-retry-entry",
      actor = "retry-instructor",
      username = "amy";
    const reviewId = "22222222-2222-4222-8222-222222222222";
    const grantId = "33333333-3333-4333-8333-333333333333";
    const settings = {
      id: exam,
      name: "Midterm",
      template: "sample-exam",
      template_version: "a".repeat(64),
      duration: 5400,
      webcam: false,
      terminals: 4,
      earliest: Date.now() - 60000,
      latest: Date.now() + 3600000,
    };
    const body = {
      revision: "b".repeat(64),
      request: "44444444-4444-4444-8444-444444444444",
      replacement_policy: "single-unused-v1",
    };
    const key = `exam-admin-review:${JSON.stringify([actor, exam, "NEW_ADDITIONAL_TEMPLATE_GRANTS", [username]])}`;
    await page.addInitScript(
      ({ key, reviewId, body }) =>
        sessionStorage.setItem(
          key,
          JSON.stringify({
            review: reviewId,
            pending: {
              operation: "confirm",
              path: `/admin/grant-issuance/${reviewId}/confirm`,
              body,
            },
          }),
        ),
      { key, reviewId, body },
    );
    let confirmed = applied;
    const writes: { path: string; body: unknown }[] = [];
    const review = () => ({
      id: reviewId,
      exam,
      actor,
      kind: "NEW_ADDITIONAL_TEMPLATE_GRANTS",
      status: confirmed ? "CONFIRMED" : "REVIEW",
      revision: body.revision,
      created: Date.now(),
      expires: Date.now() + 900000,
      rows: [{ username, settings, work: { kind: "empty" }, replaces: [] }],
      issued: confirmed ? [{ username, grant: grantId, replaced: [] }] : [],
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST")
        writes.push({ path, body: route.request().postDataJSON() });
      if (path === "/api/session")
        return route.fulfill({
          json: { role: "admin", username: actor, csrf: "fixture" },
        });
      if (path === "/api/login-test")
        return route.fulfill({ json: { loginOnly: false, browserSSH: false } });
      if (path === "/api/admin/exams")
        return route.fulfill({
          json: [{ ...settings, revision: "c".repeat(64) }],
        });
      if (path.endsWith("/dashboard"))
        return route.fulfill({
          json: {
            serverNow: Date.now(),
            total: 1,
            counts: { students: 1 },
            incidents: [],
            students: [
              {
                username,
                removable: false,
                hasNextAttempt: true,
                enrollment: { duration: null, webcam: null },
                latestSettings: settings,
                unusedAttempt: {
                  id: grantId,
                  username,
                  exam,
                  settings,
                  revision: 1,
                  status: "AVAILABLE",
                  claims: [],
                  work: { kind: "empty" },
                },
                attempts: [],
              },
            ],
          },
        });
      if (path === `/api/admin/grant-issuance/${reviewId}`)
        return route.fulfill({ json: review() });
      if (path === `/api/admin/grant-issuance/${reviewId}/confirm`) {
        confirmed = true;
        return route.fulfill({ json: review() });
      }
      if (path.endsWith("/source-setup"))
        return route.fulfill({ json: { rows: [] } });
      if (path.endsWith("/grant-reviews"))
        return route.fulfill({ json: { actor, exam, rows: [], next: null } });
      if (path.endsWith("/attempts"))
        return route.fulfill({
          json: { attempts: [], next: null, scanned: 0 },
        });
      return route.fulfill({ json: {} });
    });
    await page.goto("/admin");
    await page.getByLabel("Selected exam", { exact: true }).selectOption(exam);
    await expect(
      page.getByRole("button", {
        name: `Add next attempt for ${username}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Resume saved request (1)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    if (!applied)
      await dialog
        .getByRole("button", { name: "Retry same request", exact: true })
        .click();
    await expect(
      dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
    ).toBeVisible();
    expect(writes).toEqual(
      applied
        ? []
        : [{ path: `/api/admin/grant-issuance/${reviewId}/confirm`, body }],
    );
    await expect(
      dialog.getByRole("button", { name: "Review", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Resume saved request (1)",
        exact: true,
      }),
    ).toHaveCount(0);
  });
}
