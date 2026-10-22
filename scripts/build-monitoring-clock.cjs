// Linux server build only. No package download, clock adjustment or fallback.
const { execFileSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  copyFileSync,
  rmSync,
} = require("node:fs");
const path = require("node:path");
if (process.platform !== "linux") {
  throw new Error(
    "Build the monitoring clock in the Linux server/container; no approximate fallback is supported",
  );
}
const root = path.resolve(__dirname, "..");
const source = path.join(root, "apps/server/native");
const includes = [
  path.resolve(path.dirname(process.execPath), "../include/node"),
  "/usr/include/node",
  "/usr/local/include/node",
];
const include = includes.find((p) => existsSync(path.join(p, "node_api.h")));
if (!include) {
  throw new Error(
    "Node-API headers are missing: install the development headers for the Linux Node toolchain, then rerun npm run build:clock",
  );
}
const temporary = mkdtempSync(path.join(source, ".clock-build-"));
try {
  const built = path.join(temporary, "monitoring_clock.node");
  execFileSync(
    process.env.EXAM_CLOCK_CC || "gcc",
    [
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fPIC",
      "-shared",
      "-fvisibility=hidden",
      "-DNAPI_VERSION=8",
      "-Wl,-z,relro",
      "-Wl,-z,now",
      "-I" + include,
      path.join(source, "monitoring_clock.c"),
      "-o",
      built,
    ],
    { stdio: "inherit" },
  );
  const target = path.join(source, "monitoring_clock.node");
  // Never truncate an addon inode which another local test process has mapped.
  if (!existsSync(target) || !readFileSync(target).equals(readFileSync(built)))
    renameSync(built, target);
  const distribution = path.join(root, "dist/apps/server/native");
  mkdirSync(distribution, { recursive: true });
  const staging = path.join(distribution, ".monitoring_clock." + process.pid);
  copyFileSync(target, staging);
  renameSync(staging, path.join(distribution, "monitoring_clock.node"));
} finally {
  // Only this script's freshly-created, constant-parent build directory.
  rmSync(temporary, { recursive: true, force: true });
}
