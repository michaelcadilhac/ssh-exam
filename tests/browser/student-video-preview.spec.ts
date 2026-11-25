import { test, expect, type Page } from "@playwright/test";
import { fixture, openPreflight, ready } from "./transition-fixture.js";
import { captureMetadata, isChallengedCapture } from "./capture-requests.js";

async function setup(page: Page, exam: string) {
  const runtime = await page.request.get("/api/login-test");
  expect(runtime.ok()).toBe(true);
  expect((await runtime.json()).browserSSH).toBe(true);
  const f = await fixture(page, "NONE", "student", exam, 300, true);
  await openPreflight(page, f);
  await ready(page, true);
  return f;
}

async function start(page: Page) {
  await page
    .getByRole("button", { name: "Start exam", exact: true })
    .click({ timeout: 5000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click({ timeout: 5000 });
}

async function popOutPreview(page: Page) {
  // Model an existing pop-out or a browser override of the disable request.
  // The actual Chromium Picture-in-Picture API, stream and exit are exercised.
  await page.evaluate(async () => {
    const preview =
      document.querySelector<HTMLVideoElement>("#camera-preview")!;
    preview.disablePictureInPicture = false;
    await preview.requestPictureInPicture();
    (window as any).__previewStream = preview.srcObject;
  });
  expect(await page.evaluate(() => !!document.pictureInPictureElement)).toBe(
    true,
  );
}

test("student preview blocks native picture-in-picture and camera recording continues after Start", async ({
  page,
}) => {
  let cameraFrames = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (isChallengedCapture(request.url()) ||
        new URL(request.url()).pathname.endsWith("/frames")) &&
      captureMetadata(request).source === "webcam"
    )
      cameraFrames++;
  });
  const f = await setup(page, "preview-disabled");
  const preview = page.locator("#camera-preview");
  await expect(preview).toHaveJSProperty("disablePictureInPicture", true);
  const refused = await preview.evaluate(async (element: HTMLVideoElement) => {
    try {
      await element.requestPictureInPicture();
      return { opened: true, message: "" };
    } catch (error) {
      return { opened: false, message: (error as Error).message };
    }
  });
  expect(refused.opened).toBe(false);
  expect(refused.message).toContain("disablePictureInPicture");
  await page.evaluate(() => {
    (window as any).__previewStream =
      document.querySelector<HTMLVideoElement>("#camera-preview")!.srcObject;
  });
  await start(page);
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  const before = cameraFrames;
  await expect
    .poll(() => cameraFrames, { timeout: 8000 })
    .toBeGreaterThan(before);
  expect(
    await page.evaluate(() =>
      (window as any).__previewStream
        .getVideoTracks()
        .every((track: MediaStreamTrack) => track.readyState === "live"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.pictureInPictureElement),
  ).toBeNull();
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  expect(
    f.model.messages.filter((message) => message.type === "incident"),
  ).toEqual([]);
});

test("Start and Resume close an existing native camera pop-out before requesting authority", async ({
  page,
}) => {
  const f = await setup(page, "preview-close");
  await popOutPreview(page);
  let starts = 0,
    resumes = 0;
  for (const operation of ["begin", "continue"]) {
    await page.route(
      `**/api/student/attempts/*/${operation}`,
      async (route) => {
        expect(
          await page.evaluate(() => document.pictureInPictureElement),
        ).toBeNull();
        if (operation === "begin") {
          expect(f.model.attempt.start).toBeNull();
          starts++;
        } else resumes++;
        await route.fallback();
      },
    );
  }
  await start(page);
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  expect(starts).toBe(1);
  const original = { ...f.model.attempt };
  f.model.state = "LOCKED";
  f.model.attempt.state = "LOCKED";
  f.model.attempt.generation++;
  f.send();
  await expect(
    page.getByRole("heading", {
      name: "Instructor review required",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const video = document.createElement("video");
    video.srcObject = (window as any).__previewStream;
    video.muted = true;
    await video.play();
    await video.requestPictureInPicture();
  });
  expect(await page.evaluate(() => !!document.pictureInPictureElement)).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "Resume exam", exact: true })
    .click({ timeout: 5000 });
  await expect(
    page.getByRole("heading", {
      name: "Instructor review required",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(resumes).toBe(1);
  expect(f.model.attempt.start).toBe(original.start);
  expect(f.model.attempt.deadline).toBe(original.deadline);
});

test("a refused pop-out close leaves Start retryable without starting the clock", async ({
  page,
}) => {
  const f = await setup(page, "preview-refusal");
  await popOutPreview(page);
  await page.evaluate(() => {
    (window as any).__exitPreview =
      document.exitPictureInPicture.bind(document);
    document.exitPictureInPicture = async () => {
      throw new DOMException("Synthetic browser refusal", "NotAllowedError");
    };
  });
  let starts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/begin")) starts++;
  });
  await start(page);
  const error = page.getByRole("dialog");
  await expect(error).toContainText(
    "Close the floating video preview, click the exam page, then try again.",
  );
  expect(starts).toBe(0);
  expect(f.model.attempt.start).toBeNull();
  expect(f.model.attempt.deadline).toBeNull();
  expect(await page.evaluate(() => !!document.pictureInPictureElement)).toBe(
    true,
  );
  await error.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    document.exitPictureInPicture = (window as any).__exitPreview;
  });
  await start(page);
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  expect(starts).toBe(1);
  expect(
    await page.evaluate(() => document.pictureInPictureElement),
  ).toBeNull();
});
