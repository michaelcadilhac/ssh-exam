import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../playwright.config.js";

if (!process.env.EXAM_STRESS_RUN || !process.env.EXAM_STRESS_OUTPUT)
  throw Error("Use the explicitly invoked manual stress runner");
if (!["35", "70"].includes(process.env.EXAM_BROWSER_NATIVE_STUDENTS || ""))
  throw Error("The manual fleet requires an explicit 35- or 70-student cohort");
if (!process.env.EXAM_STRESS_LOCAL_SCRATCH || process.env.TMPDIR !== process.env.EXAM_STRESS_LOCAL_SCRATCH)
  throw Error("Use the manual runner's private workspace scratch for the selected recording load");
if (!base.webServer || Array.isArray(base.webServer))
  throw Error("Expected the single existing isolated browser fixture");

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    ...(process.env.EXAM_STRESS_BROWSER_WS
      ? { connectOptions: { wsEndpoint: process.env.EXAM_STRESS_BROWSER_WS, timeout: 15000 } }
      : {}),
  },
  webServer: {
    ...base.webServer,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  },
  testDir: "./browser",
  testMatch: "retained-capacity.spec.ts",
  outputDir: process.env.EXAM_STRESS_OUTPUT,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: process.env.EXAM_STRESS_OUTPUT + "/playwright.json" },
    ],
  ],
});
