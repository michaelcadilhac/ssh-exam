import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { fixture } from "./transition-fixture.js";

test("student sharing encodes smaller independent JPEGs from actual screen and camera frames", async ({
  page,
}, testInfo) => {
  const runtimeReply = await page.request.get("/api/login-test");
  expect(runtimeReply.ok()).toBe(true);
  const runtime = await runtimeReply.json();
  expect(runtime.browserSSH).toBe(true);
  await testInfo.attach("actual fixture mode", {
    body: JSON.stringify(runtime),
    contentType: "application/json",
  });
  // Only media acquisition and server policy are synthetic. This exercises the
  // built student sharing controls, real MediaStream/video/canvas and JPEG codec.
  const f = await fixture(page);
  const settings = f.reservation().settings;
  settings.webcam = true;
  f.model.attempt.settings = JSON.stringify(settings);
  await page.addInitScript(() => {
    const stream = (source: "screen" | "webcam") => {
      const canvas = document.createElement("canvas"),
        screen = source === "screen";
      canvas.width = screen ? 2560 : 640;
      canvas.height = screen ? 1440 : 480;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        ctx.fillStyle = "#10141b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (screen) {
          for (let pane = 0; pane < 4; pane++) {
            const x = (pane % 2) * 1280,
              y = Math.floor(pane / 2) * 720;
            ctx.fillStyle = "#25374d";
            ctx.fillRect(x + 8, y + 8, 1264, 34);
            ctx.fillStyle = "#f2f5f8";
            ctx.font = "20px monospace";
            ctx.fillText(`Terminal ${pane + 1}`, x + 24, y + 32);
            for (let row = 0; row < 25; row++) {
              ctx.fillStyle = row % 3 === 0 ? "#8ee7b1" : "#e0e4ea";
              ctx.fillText(
                row % 3 === 0
                  ? "$ gcc -std=c11 -Wall -Wextra -Werror answer.c -o answer"
                  : `  if (items[${row}] != NULL && count <= 65535) { value += 17; }`,
                x + 24,
                y + 70 + row * 25,
              );
            }
          }
        } else {
          ctx.fillStyle = "#b48f73";
          ctx.beginPath();
          ctx.ellipse(320, 220, 100, 140, 0, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = "#d5e4f3";
          ctx.fillRect(180, 360, 280, 120);
        }
      };
      paint();
      setInterval(paint, 100);
      const media = canvas.captureStream(10),
        track = media.getVideoTracks()[0],
        getSettings = track.getSettings.bind(track);
      track.getSettings = () => ({
        ...getSettings(),
        ...(screen ? { displaySurface: "monitor" } : {}),
      });
      return media;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getDisplayMedia: async () => stream("screen"),
        getUserMedia: async () => stream("webcam"),
      },
    });
  });
  const frames: {
    source: string;
    captured: number;
    monotonic: number;
    data: string;
  }[] = [];
  await page.route(
    "**/api/student/attempts/*/frames/challenged",
    async (route) => {
      frames.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    },
  );
  f.model.bind.release();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click({ timeout: 10000 });
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await page
    .getByRole("button", { name: "1. Share entire screen", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("button", { name: "2. Enable webcam", exact: true })
    .click({ timeout: 10000 });
  await expect
    .poll(() => frames.some((frame) => frame.source === "screen"))
    .toBe(true);
  await expect
    .poll(() => frames.some((frame) => frame.source === "webcam"))
    .toBe(true);
  for (const [source, width, height] of [
    ["screen", 1280, 720],
    ["webcam", 320, 240],
  ] as const) {
    const frame = frames.find((value) => value.source === source)!;
    expect(frame.captured).toBeGreaterThan(0);
    expect(frame.monotonic).toBeGreaterThan(0);
    const bytes = Buffer.from(frame.data, "base64"),
      metadata = await sharp(bytes).metadata(),
      path = testInfo.outputPath(`${source}-capture.jpg`);
    expect(metadata).toMatchObject({ format: "jpeg", width, height });
    await writeFile(path, bytes);
    await testInfo.attach(`${source} encoded frame`, {
      path,
      contentType: "image/jpeg",
    });
  }
});
