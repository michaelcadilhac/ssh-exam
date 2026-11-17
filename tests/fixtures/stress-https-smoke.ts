// Manual generator preflight only. No application/native account, MFA or email.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  prepareStressPages,
  watchStressNavigation,
} from "./stress-navigation.js";

process.umask(0o077);
const origin = "https://127.0.0.1:9444";
assert.match(
  process.env.EXAM_STRESS_BROWSER_WS || "",
  /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/,
);
const directory = mkdtempSync(join(tmpdir(), "stress-https-"));
const contexts: BrowserContext[] = [];
const failures: { username: string; error?: string }[] = [];
const lateNavigations: { username: string; path: string }[] = [];
let browser: Browser | undefined;
let server: https.Server | undefined;
let observing = false;
const lateNavigationControl =
  process.env.EXAM_STRESS_HTTPS_LATE_NAVIGATION_CONTROL === "1";
const timer = setTimeout(() => {
  console.error("Private HTTPS preflight exceeded60s");
  process.exit(124);
}, 60000);
try {
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(directory, "tls.key"),
      "-out",
      join(directory, "tls.crt"),
    ],
    { stdio: "ignore", timeout: 10000 },
  );
  server = https.createServer(
    {
      key: readFileSync(join(directory, "tls.key")),
      cert: readFileSync(join(directory, "tls.crt")),
    },
    (request, response) => {
      response.setHeader("cache-control", "no-store");
      const probe = request.url?.startsWith("/probe");
      response.setHeader("content-type", probe ? "text/plain" : "text/html");
      const send = () =>
        response.end(
          probe
            ? "synthetic-ok"
            : "<title>Private HTTPS fixture</title><label>Username<input></label>",
        );
      if (probe) setTimeout(send, 500);
      else send();
    },
  );
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(9444, "127.0.0.1", resolve);
  });
  browser = await chromium.connect(process.env.EXAM_STRESS_BROWSER_WS!, {
    timeout: 10000,
  });
  const prepared = await prepareStressPages({
    browser,
    origin,
    contexts,
    students: Array.from({ length: 13 }, (_, i) => `synthetic${i}`),
    spacingMs: 0,
    note: console.log,
    initialize: async (page, username) => {
      watchStressNavigation(
        page,
        () => observing,
        (path) => lateNavigations.push({ username, path }),
      );
      page.on("requestfailed", (request) => {
        if (observing && new URL(request.url()).pathname === "/probe")
          failures.push({ username, error: request.failure()?.errorText });
      });
    },
  });
  assert.equal(prepared.length, 13);
  observing = true;
  await prepared[0].page.evaluate(() => {
    const stats = ((window as any).__httpsStress = { ok: 0, failed: 0 });
    setInterval(() => {
      void fetch("/probe", { cache: "no-store" }).then(
        (response) => {
          if (response.ok) stats.ok++;
          else stats.failed++;
        },
        () => stats.failed++,
      );
    }, 100);
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const entry of prepared.slice(1)) {
    // Explicit mutation control, never enabled by the ordinary manual runner.
    if (lateNavigationControl)
      await entry.page.goto(origin, { timeout: 10000 });
    else {
      await entry.page
        .getByLabel("Username", { exact: true })
        .fill("synthetic-ready");
      await entry.page.evaluate(async () => {
        const response = await fetch("/probe");
        if (!response.ok) throw Error("Private HTTPS probe refused");
      });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const stats = await prepared[0].page.evaluate(
    () => (window as any).__httpsStress,
  );
  assert.deepEqual(
    lateNavigations,
    [],
    "Document navigation after warmup invalidates the shared-browser cohort: " +
      JSON.stringify(lateNavigations),
  );
  assert.deepEqual(failures, [], JSON.stringify(failures));
  assert.equal(stats.failed, 0);
  assert(
    stats.ok >= 20,
    "The HTTPS observer must actually exchange overlapping requests",
  );
  console.log(
    JSON.stringify({
      remoteHTTPS: true,
      preloadedContexts: prepared.length,
      successfulRequests: stats.ok,
      requestFailures: stats.failed,
      lateNavigationControl,
      institutionalMFA: false,
    }),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  observing = false;
  for (const result of await Promise.allSettled(
    contexts.map((context) => context.close()),
  )) {
    if (result.status === "rejected") {
      console.error(result.reason);
      process.exitCode = 1;
    }
  }
  if (browser) await browser.close();
  if (server?.listening)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
  clearTimeout(timer);
}
