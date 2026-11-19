import { test, expect } from "@playwright/test";
import { readFile, stat, writeFile } from "node:fs/promises";

for (const mode of ["busy", "different"] as const)
  test(`setup health ${mode} preserves sign-in and consumes no exam time or permission`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.EXAM_BROWSER_SSH !== "1",
      "Requires real packaged WASM/SSH",
    );
    const username = mode === "busy" ? "setupbusy01" : "setupbusy02";
    await page.setViewportSize({
      width: mode === "busy" ? 430 : 1280,
      height: 900,
    });
    let signIns = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/start") signIns++;
    });
    await page.goto("/");
    expect(
      (await (await page.request.get("/api/login-test")).json()).browserSSH,
    ).toBe(true);
    await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("shared-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const setup = page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    });
    await expect(setup).toBeVisible();
    const before = await (await page.request.get("/api/student/exam")).json();
    expect(before.attempt).toBeNull();
    const session = await (await page.request.get("/api/session")).json();
    const armed = await page.request.post("/api/fixture/setup-health", {
      headers: {
        origin: "http://localhost:3100",
        "x-csrf-token": session.csrf,
      },
      data: { username, mode },
    });
    expect(armed.ok(), await armed.text()).toBe(true);
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/student/preflight" &&
        r.request().method() === "POST",
    );
    await setup.click();
    const refused = await response,
      body = await refused.json();
    if (mode === "busy") {
      expect(refused.status()).toBe(409);
      expect(body).toEqual({
        code: "EXAM_SETUP_BUSY",
        error:
          "The server is checking exam setup. Wait a moment, then try again.",
      });
      await expect(page.getByRole("alert")).toContainText(body.error);
      await expect(page.getByRole("alert")).not.toContainText(
        /examctl|native readiness|operator/i,
      );
    } else {
      expect(refused.status()).toBe(400);
      expect(body.code).toBeUndefined();
      expect(body.error).toBe(
        "Synthetic different fault: native readiness verification already in progress;",
      );
    }
    await expect(setup).toBeEnabled();
    const current = await (await page.request.get("/api/student/exam")).json();
    expect(current.attempt).toBeNull();
    expect(current.grants).toEqual(before.grants);
    expect(await (await page.request.get("/api/session")).json()).toMatchObject(
      { role: "student", username },
    );
    const snapshot = await (
      await page.request.get(`/api/fixture/setup-health?username=${username}`)
    ).json();
    expect(snapshot.attempts).toEqual([]);
    expect(snapshot.grants).toEqual([]);
    if (mode === "busy") {
      expect(snapshot.audits).toHaveLength(1);
      expect(snapshot.audits[0].detail).toContain(
        "inspect examctl agent status",
      );
    } else expect(snapshot.audits).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`setup-health-${mode}.png`),
    });
    const retry = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/student/preflight" &&
        r.request().method() === "POST",
    );
    await setup.click();
    const prepared = await retry;
    expect(prepared.ok(), await prepared.text()).toBe(true);
    const after = (await (await page.request.get("/api/student/exam")).json())
      .attempt;
    expect(after).toMatchObject({
      state: "PREPARING",
      start: null,
      deadline: null,
    });
    const final = await (
      await page.request.get(`/api/fixture/setup-health?username=${username}`)
    ).json();
    expect(final.grants).toEqual([{ status: "AVAILABLE" }]);
    expect(signIns).toBe(1);
    if (
      process.env.EXAM_BROWSER_PROFILE_COMPILED === "1" &&
      process.env.EXAM_BROWSER_GATEWAY_PROCESS === "1"
    ) {
      const runtime = await (
        await page.request.get("/api/fixture/runtime")
      ).json();
      expect(runtime.profile).toMatchObject({
        version: 1,
        stageSupport: true,
        failed: false,
        truncated: false,
        closed: false,
      });
      const file = await stat(runtime.profile.path);
      expect(file.mode & 0o777).toBe(0o600);
      expect(file.nlink).toBe(1);
      const text = await readFile(runtime.profile.path, "utf8");
      const rows = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const health = rows.filter(
        (row) =>
          row.type === "setup" &&
          row.username === username &&
          row.operation === "command:health",
      );
      expect(health.some((row) => row.event === "failed")).toBe(true);
      expect(health.some((row) => row.event === "completed")).toBe(true);
      expect(health.filter((row) => row.event === "started")).toHaveLength(2);
      expect(text).not.toMatch(
        /shared-password|csrf|answers|nonce|private_reply/,
      );
      const saved = info.outputPath("setup-profile.jsonl");
      await writeFile(saved, text, { mode: 0o600 });
      await info.attach("setup-profile.jsonl", {
        path: saved,
        contentType: "application/x-ndjson",
      });
    }
  });
