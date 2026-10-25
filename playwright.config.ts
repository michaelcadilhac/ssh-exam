import { defineConfig } from "@playwright/test";
// Keep test-worker skip guards and the private server on the same mode.
process.env.EXAM_BROWSER_SSH ??= "1";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npx tsx tests/browser/server.ts",
    // Protocol scenarios require real WASM/SSH by default. Node-fallback
    // qualification must deliberately select EXAM_BROWSER_SSH=0.
    env: { EXAM_BROWSER_SSH: process.env.EXAM_BROWSER_SSH ?? "1" },
    url: "http://localhost:3100/health/live",
    reuseExistingServer: false,
  },
  reporter: "list",
});
