import { defineConfig } from "@playwright/test";
// Keep test-worker skip guards and the private server on the same mode.
process.env.EXAM_BROWSER_SSH ??= "1";
const native = !!process.env.EXAM_BROWSER_NATIVE_BUNDLE;
const remoteBrowser = process.env.EXAM_STRESS_BROWSER_WS;
if (
  remoteBrowser &&
  (!native || !/^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(remoteBrowser))
)
  throw Error(
    "Remote stress browsers require the private native fixture and loopback tunnel",
  );
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: native ? "https://127.0.0.1:9444" : "http://localhost:3100",
    ignoreHTTPSErrors: native,
    headless: true,
    ...(remoteBrowser
      ? { connectOptions: { wsEndpoint: remoteBrowser, timeout: 15000 } }
      : {}),
    launchOptions: {
      executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: native
      ? "exec node --import tsx tests/fixtures/native-browser-server.ts"
      : "npx tsx tests/browser/server.ts",
    // Protocol scenarios require real WASM/SSH by default. Node-fallback
    // qualification must deliberately select EXAM_BROWSER_SSH=0.
    env: { EXAM_BROWSER_SSH: process.env.EXAM_BROWSER_SSH ?? "1" },
    url: native
      ? "https://127.0.0.1:9444/api/fixture/native-ready"
      : "http://localhost:3100/health/live",
    ignoreHTTPSErrors: native,
    timeout: native ? 180000 : 60000,
    gracefulShutdown: native
      ? { signal: "SIGTERM", timeout: 30000 }
      : undefined,
    reuseExistingServer: false,
  },
  reporter: "list",
});
