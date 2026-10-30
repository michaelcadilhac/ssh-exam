import { test, expect, type Page } from "@playwright/test";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Observe every DOM commit, so a form that disappears before an assertion still fails.
async function watchSignIn(page: Page) {
  await page.addInitScript(() => {
    (window as any).__signInFrames = [];
    (window as any).__watchSignIn = true;
    new MutationObserver(() => {
      if (!(window as any).__watchSignIn) return;
      for (const heading of document.querySelectorAll("form h2")) {
        if (
          /^(Sign in to your exam|Instructor sign-in|Test your SSH login)$/.test(
            heading.textContent || "",
          )
        )
          (window as any).__signInFrames.push(heading.textContent);
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
async function noSignIn(page: Page) {
  await expect(page.locator("form")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__signInFrames)).toEqual([]);
}

for (const path of ["/", "/admin"]) {
  test(`restoring an administrator at ${path} never renders a sign-in form`, async ({
    page,
  }) => {
    const session = deferred(),
      settings = deferred();
    await watchSignIn(page);
    await page.route("**/api/session", async (route) => {
      await session.promise;
      await route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    });
    await page.route("**/api/login-test", async (route) => {
      await settings.promise;
      await route.fulfill({ json: { loginOnly: false } });
    });
    await page.route("**/api/admin/exams", (route) =>
      route.fulfill({ json: [] }),
    );
    try {
      await page.goto(path);
      await expect(page.getByRole("status")).toHaveText("Loading…");
      await noSignIn(page);
      session.release();
      await expect(page.getByRole("status")).toHaveText("Loading…");
      await noSignIn(page);
      settings.release();
      await expect(
        page.getByRole("button", { name: "Administration", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Selected exam")).toHaveValue("");
      await noSignIn(page);
    } finally {
      session.release();
      settings.release();
    }
  });
}

test("restoring a student waits for exam details and does not mistake service failures for sign-out", async ({
  page,
}) => {
  const details = deferred();
  let failSession = true;
  await watchSignIn(page);
  await page.route("**/api/session", (route) =>
    route.fulfill(
      failSession
        ? { status: 503, json: { error: "Session service unavailable" } }
        : {
            json: {
              role: "student",
              username: "student09",
              exam: "sandbox",
              csrf: "fixture",
            },
          },
    ),
  );
  await page.route("**/api/login-test", (route) =>
    route.fulfill({ json: { loginOnly: true } }),
  );
  await page.route("**/api/student/exam", async (route) => {
    await details.promise;
    await route.fulfill({
      json: { loginOnly: true, jump: "jump", class: "class" },
    });
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Session service unavailable",
    );
    await noSignIn(page);
    failSession = false;
    await page.getByRole("button", { name: "Retry loading" }).click();
    await expect(page.getByRole("status")).toHaveText("Loading…");
    await noSignIn(page);
    details.release();
    await expect(
      page.getByRole("heading", { name: "SSH sign-in succeeded" }),
    ).toBeVisible();
    await noSignIn(page);
  } finally {
    details.release();
  }
});

test("signed-out startup waits for configuration before choosing the correct sign-in form", async ({
  page,
}) => {
  const settings = deferred();
  await watchSignIn(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 401, json: { error: "Authentication required" } }),
  );
  await page.route("**/api/login-test", async (route) => {
    await settings.promise;
    await route.fulfill({
      json: { loginOnly: true, jump: "jump", class: "class" },
    });
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Loading…");
    await noSignIn(page);
    settings.release();
    await expect(
      page.getByRole("heading", { name: "Test your SSH login" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__signInFrames),
    ).not.toContain("Sign in to your exam");
    await expect(page.getByLabel("Exam ID", { exact: true })).toHaveCount(0);
  } finally {
    settings.release();
  }
});

test("SSH completion retains its dialog through delayed session/exam loading and a recoverable failure", async ({
  page,
}) => {
  const complete = deferred(),
    firstDetails = deferred(),
    retryDetails = deferred();
  let completing = false,
    detailRequests = 0,
    completeRequests = 0;
  await watchSignIn(page);
  await page.route("**/api/auth/complete", async (route) => {
    completing = true;
    completeRequests++;
    await complete.promise;
    await route.continue();
  });
  await page.route("**/api/student/exam", async (route) => {
    detailRequests++;
    if (detailRequests === 1) {
      await firstDetails.promise;
      await route.fulfill({
        status: 503,
        json: { error: "Exam service unavailable" },
      });
    } else {
      await retryDetails.promise;
      await route.continue();
    }
  });
  const stillAuthenticating = async () => {
    await expect(
      page.getByRole("heading", { name: "Server sign-in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sign in to your exam" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Username")).toHaveCount(0);
    await expect(
      page.getByText("Signed in as student10", { exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__signInFrames)).toEqual(
      [],
    );
  };
  try {
    await page.goto("/");
    await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
    await page.getByLabel("Username").fill("student10");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    await page.evaluate(() => {
      (window as any).__signInFrames = [];
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Host authentication messages")).toContainText(
      "Enter number 42",
    );
    await expect.poll(() => completing).toBe(true);
    await expect(page.getByRole("status")).toHaveText("Opening your exam…");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await stillAuthenticating();
    await page.screenshot({ path: test.info().outputPath("opening-exam.png") });
    complete.release();
    await expect.poll(() => detailRequests).toBe(1);
    await stillAuthenticating();
    firstDetails.release();
    await expect(page.getByRole("alert")).toContainText(
      "Exam service unavailable",
    );
    await stillAuthenticating();
    await page.getByRole("button", { name: "Retry opening exam" }).click();
    await expect.poll(() => detailRequests).toBe(2);
    await stillAuthenticating();
    retryDetails.release();
    await expect(
      page.getByRole("button", { name: "Check setup and practice" }),
    ).toBeVisible();
    expect(completeRequests).toBe(1);
    expect(await page.evaluate(() => (window as any).__signInFrames)).toEqual(
      [],
    );
    await expect(
      page.getByRole("heading", { name: "Server sign-in" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to your exam" }),
    ).toBeVisible();
  } finally {
    complete.release();
    firstDetails.release();
    retryDetails.release();
  }
});
