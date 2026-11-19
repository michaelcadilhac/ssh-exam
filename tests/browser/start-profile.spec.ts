import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("separate application profiles one explicit Start through real WASM SSH", async ({
  page,
}, info) => {
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1" ||
      process.env.EXAM_BROWSER_PROFILE_COMPILED !== "1" ||
      process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Manual separate-application profiling mode required",
  );
  test.setTimeout(45000);
  page.setDefaultTimeout(10000);
  await simulatedMedia(page);
  let starts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/begin")
    )
      starts++;
  });
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
  await page.getByLabel("Username", { exact: true }).fill("setupbusy03");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const preparation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/student/preflight",
  );
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click();
  const preparedResponse = await preparation;
  expect(preparedResponse.ok(), await preparedResponse.text()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const prepared = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(prepared).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
  });
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".terminal[aria-busy]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active.id).toBe(prepared.id);
  expect(active.state).toBe("ACTIVE");
  expect(active.deadline - active.start).toBe(300000);
  expect(starts).toBe(1);
  const runtime = await (await page.request.get("/api/fixture/runtime")).json();
  expect(runtime.profile).toMatchObject({
    version: 1,
    stageSupport: true,
    failed: false,
    truncated: false,
  });
  const text = await readFile(runtime.profile.path, "utf8");
  const rows = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const activation = rows.filter(
    (row) =>
      row.type === "setup" &&
      row.username === "setupbusy03" &&
      row.operation.startsWith("command:activate-"),
  );
  expect(activation.map((row) => row.event)).toEqual(["started", "completed"]);
  expect(activation[1].elapsed_ms).toBeGreaterThanOrEqual(0);
  expect(text).not.toMatch(/shared-password|csrf|answers|nonce|private_reply/);
  const path = info.outputPath("start-profile.jsonl");
  await writeFile(path, text, { mode: 0o600 });
  await info.attach("start-profile.jsonl", {
    path,
    contentType: "application/x-ndjson",
  });
});
