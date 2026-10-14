const { execFileSync } = require("node:child_process");
const { mkdirSync, copyFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const preferred = "/tmp/ssh-exam-go-current/go/bin/go";
const go = process.env.EXAM_GO || (existsSync(preferred) ? preferred : "go");
const out = path.resolve("apps/web/public/ssh");
mkdirSync(out, { recursive: true });
const env = { ...process.env, GOOS: "js", GOARCH: "wasm" };
execFileSync(
  go,
  ["build", "-trimpath", "-o", path.join(out, "client.wasm"), "."],
  { cwd: "browser-ssh", env, stdio: "inherit" },
);
const root = execFileSync(go, ["env", "GOROOT"], { encoding: "utf8" }).trim();
copyFileSync(
  path.join(root, "lib/wasm/wasm_exec.js"),
  path.join(out, "wasm_exec.js"),
);
