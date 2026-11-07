import { test, expect } from "@playwright/test";
import { ready } from "./transition-fixture.js";
import { decodeCaptureUpload } from "../../packages/protocol/capture-upload.js";

test("challenged video uploads and retained input stay live on a real 128 kbit upload link", async ({
  page,
}, testInfo) => {
  test.setTimeout(190000);
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    Object.defineProperty(document, "hasFocus", {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(navigator, "keyboard", {
      value: { lock: async () => {}, unlock: () => {} },
    });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 2560;
        canvas.height = 1440;
        const ctx = canvas.getContext("2d")!;
        const paint = () => {
          ctx.fillStyle = "#10141b";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.font = "22px monospace";
          ctx.fillStyle = "#d5e4f3";
          for (let row = 0; row < 50; row++)
            ctx.fillText(
              `${row}: if (items[count] != NULL) { total += 17; } // build ${Math.floor(Date.now() / 5000)}`,
              20,
              28 + row * 27,
            );
        };
        paint();
        setInterval(paint, 500);
        const stream = canvas.captureStream(10),
          track = stream.getVideoTracks()[0],
          settings = track.getSettings.bind(track);
        track.getSettings = () => ({
          ...settings(),
          displaySurface: "monitor",
        });
        return stream;
      },
      configurable: true,
    });
  });
  const sent: { encoding: string; bytes: number; key: boolean; at: number }[] =
    [];
  let accepted = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.endsWith("/frames/binary")) {
      const body = req.postDataBuffer()!,
        { metadata } = decodeCaptureUpload(body);
      sent.push({
        encoding: metadata.encoding,
        bytes: body.length,
        key: metadata.video?.key ?? false,
        at: Date.now(),
      });
    }
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith("/frames/binary") &&
      response.ok()
    )
      accepted++;
  });
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("retained-control");
  await page.getByLabel("Username").fill("retained01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 50,
    downloadThroughput: 10 * 1024 * 1024,
    uploadThroughput: 16 * 1024,
  });
  try {
    // No request interception: these uploads cross the actual throttled HTTP path.
    await ready(page);
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Start exam", exact: true })
      .click();
    await expect(page.locator(".xterm-rows")).toContainText(
      "DISPOSABLE DEVELOPMENT FIXTURE",
      { timeout: 20000 },
    );
    const original = (
      await (await page.request.get("/api/student/exam")).json()
    ).attempt;
    expect(original.state).toBe("ACTIVE");
    // The existing scheduler waits five seconds AFTER each completed upload;
    // a throttled transfer therefore extends the interval between samples.
    await expect
      .poll(() => accepted, { timeout: 145000, intervals: [1000] })
      .toBeGreaterThanOrEqual(15);
    expect(
      sent.filter((x) => x.encoding === "vp9" && x.key).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      sent.filter((x) => x.encoding === "vp9" && !x.key).length,
    ).toBeGreaterThanOrEqual(5);
    const current = (await (await page.request.get("/api/student/exam")).json())
      .attempt;
    expect(current).toMatchObject({
      id: original.id,
      state: "ACTIVE",
      deadline: original.deadline,
      generation: original.generation,
    });
    await expect(page.locator(".lock-overlay")).toHaveCount(0);
    const input = page.locator(".xterm-helper-textarea").last();
    await expect(input).toBeEnabled();
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.type("slow-link-input-");
    await expect(page.locator(".xterm-rows")).toContainText(
      "slow-link-input-",
      { timeout: 10000 },
    );
  } finally {
    await testInfo.attach("real throttled upload receipt", {
      body: JSON.stringify({
        upload_bytes_per_second: 16384,
        latency_ms: 50,
        accepted,
        sent,
        synthetic_media: true,
        native_kernel: false,
      }),
      contentType: "application/json",
    });
    await cdp.detach();
  }
});
