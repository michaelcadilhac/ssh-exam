import { test, expect, type Page } from "@playwright/test";

const openID = "11111111-1111-4111-8111-111111111111";
const futureID = "22222222-2222-4222-8222-222222222222";
const closed = "Practice is closed. Ask your instructor to open it.";

async function portal(page: Page, multiple = false, examID = "sandbox") {
  const now = Date.now();
  const exam = {
    id: examID,
    name: "Practice",
    duration: 300,
    webcam: false,
    terminals: 4,
    template: "sample-exam",
    template_version: "a".repeat(64),
    earliest: now - 60000,
    latest: now + 60000,
  };
  const grants = [
    {
      id: openID,
      issuance: examID === "sandbox" ? "PRACTICE" : "ADDITIONAL_TEMPLATE",
      issued_at: now,
      settings: exam,
      work: { kind: "template", name: "sample-exam" },
    },
    {
      id: futureID,
      issuance: examID === "sandbox" ? "PRACTICE" : "ADDITIONAL_TEMPLATE",
      issued_at: now,
      settings: { ...exam, earliest: now + 60000, latest: now + 120000 },
      work: { kind: "template", name: "sample-exam" },
    },
  ];
  const requests: (string | null)[] = [];
  let starts = 0;
  let revoked = false;
  let allRevoked = false;
  let reopened = false;
  let releaseFuture!: () => void;
  const futureResponse = new Promise<void>((resolve) => {
    releaseFuture = resolve;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      value: { lock: async () => {}, unlock() {} },
    });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        throw Error("Capture not used");
      },
    });
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        role: "student",
        username: "synthetic",
        exam: examID,
        csrf: "synthetic",
      },
    }),
  );
  await page.route("**/api/login-test", (route) =>
    route.fulfill({ json: { loginOnly: false } }),
  );
  await page.route("**/api/student/exam*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("grant");
    requests.push(id);
    if (revoked && id && (id === futureID || allRevoked))
      return route.fulfill({
        status: 409,
        json: {
          code: "ATTEMPT_UNAVAILABLE",
          error:
            "That attempt is no longer available. Choose Check again to see your current attempts.",
        },
      });
    if (multiple && id === futureID) await futureResponse;
    const available = allRevoked
      ? []
      : revoked
        ? [grants[0]]
        : multiple
          ? grants
          : [grants[0]];
    const selected = id
      ? available.find((g) => g.id === id)
      : available.length === 1
        ? available[0]
        : undefined;
    return route.fulfill({
      json: {
        exam,
        settings: selected?.settings ?? exam,
        enrollment: {
          exam: examID,
          username: "synthetic",
          webcam: null,
          duration: null,
          uid: 10001,
        },
        sshConnected: true,
        attempt: null,
        grants: available,
        selected_grant: selected?.id ?? null,
        practice_blocked:
          selected?.id === futureID && !reopened ? { message: closed } : null,
      },
    });
  });
  await page.route("**/api/student/preflight", (route) => {
    starts++;
    return route.fulfill({
      status: 409,
      json: allRevoked
        ? {
            code: "ATTEMPT_UNAVAILABLE",
            error:
              "That attempt is no longer available. Choose Check again to see your current attempts.",
          }
        : { error: "Not used by this display test" },
    });
  });
  return {
    requests,
    releaseFuture,
    starts: () => starts,
    revokeFuture: () => {
      revoked = true;
    },
    revokeAll: () => {
      revoked = true;
      allRevoked = true;
    },
    reopenFuture: () => {
      reopened = true;
      grants[1].settings = { ...exam };
    },
  };
}

for (const width of [1280, 430]) {
  test(`starting files are visible without opening a disclosure at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await portal(page);
    await page.goto("/");
    await expect(
      page.getByText("Starter files: sample-exam", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("details")
        .filter({ has: page.getByText("Starting files", { exact: true }) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Check setup and practice",
        exact: true,
      }),
    ).toBeEnabled();
    expect(fixture.starts()).toBe(0);
    await page.screenshot({
      path: test.info().outputPath(`starting-files-${width}.png`),
    });
  });
  test(`attempt selection refreshes availability without reserving work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await portal(page, true);
    await page.goto("/");
    const choose = page.getByRole("combobox", {
      name: "Choose an attempt",
      exact: true,
    });
    const setup = page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    });
    await expect(setup).toBeDisabled();
    try {
      await choose.selectOption(futureID, { timeout: 3000 });
      await expect.poll(() => fixture.requests).toContain(futureID);
      await expect(page.getByRole("status")).toHaveText("Checking attempt…");
      await expect(choose).toBeDisabled();
      await expect(setup).toBeDisabled();
    } finally {
      fixture.releaseFuture();
    }
    await expect(page.getByRole("status")).toContainText(closed);
    await expect(setup).toBeDisabled();
    await expect(page.locator("main")).not.toContainText(
      /examctl|Begin window/,
    );
    await page.screenshot({
      path: test.info().outputPath(`closed-practice-${width}.png`),
    });
    fixture.reopenFuture();
    await page
      .getByRole("button", { name: "Check again", exact: true })
      .click({ timeout: 3000 });
    await expect
      .poll(() => fixture.requests.filter((id) => id === futureID).length)
      .toBe(2);
    await expect(page.getByText(closed, { exact: true })).toHaveCount(0);
    await expect(setup).toBeEnabled();
    await expect(choose).toHaveValue(futureID);
    await choose.selectOption(openID, { timeout: 3000 });
    await expect.poll(() => fixture.requests).toContain(openID);
    await expect(page.getByText(closed, { exact: true })).toHaveCount(0);
    await expect(setup).toBeEnabled();
    expect(fixture.starts()).toBe(0);
  });
  test(`a stale choice can be checked again without repeating it or starting work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await portal(page, true, "synthetic-exam");
    await page.goto("/");
    const choices = page.getByRole("combobox", {
      name: "Choose an attempt",
      exact: true,
    });
    await expect(choices).toBeVisible();
    await expect(choices.locator("option")).toHaveCount(3);
    fixture.revokeFuture();
    await choices.selectOption(futureID, { timeout: 3000 });
    await expect(page.getByRole("alert")).toContainText(
      "That attempt is no longer available.",
    );
    const setup = page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    });
    await expect(setup).toBeDisabled();
    await page
      .getByRole("button", { name: "Check again", exact: true })
      .click({ timeout: 3000 });
    await expect(setup).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(fixture.requests).toEqual([null, futureID, null]);
    expect(fixture.starts()).toBe(0);
    await expect(
      page.getByText("Starter files: sample-exam", { exact: true }),
    ).toBeVisible();
    fixture.revokeAll();
    await setup.click({ timeout: 3000 });
    await expect(page.getByRole("alert")).toContainText(
      "That attempt is no longer available.",
    );
    await page
      .getByRole("button", { name: "Check again", exact: true })
      .click({ timeout: 3000 });
    await expect(page.getByRole("status")).toContainText(
      "No attempts are available to start.",
    );
    await expect(setup).toBeDisabled();
    expect(fixture.starts()).toBe(1);
    expect(fixture.requests.at(-1)).toBeNull();
    await expect(
      page.getByRole("button", { name: "Check again", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath(`refreshed-attempts-${width}.png`),
    });
  });
}

test("a stalled availability read releases the controls without starting work", async ({
  page,
}) => {
  const fixture = await portal(page, true);
  await page.goto("/");
  const choices = page.getByRole("combobox", {
    name: "Choose an attempt",
    exact: true,
  });
  await expect(choices).toBeVisible();
  await page.evaluate(() => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => original(Math.min(ms, 25));
  });
  try {
    await choices.selectOption(futureID, { timeout: 3000 });
    await expect(page.getByRole("alert")).toContainText(
      "Checking this attempt took too long.",
    );
    await expect(choices).toBeEnabled();
    await expect(choices).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", {
        name: "Check setup and practice",
        exact: true,
      }),
    ).toBeDisabled();
    expect(fixture.starts()).toBe(0);
  } finally {
    fixture.releaseFuture();
  }
});
