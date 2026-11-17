import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../playwright.config.js";

if (!process.env.EXAM_STRESS_RUN || !process.env.EXAM_STRESS_OUTPUT)
  throw Error("Use the explicitly invoked manual stress runner");
if (process.env.EXAM_BROWSER_NATIVE_STUDENTS !== "70")
  throw Error("The manual fleet requires70 synthetic students");
if (!base.webServer || Array.isArray(base.webServer))
  throw Error("Expected the single existing isolated browser fixture");

export default defineConfig({
  ...base,
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
