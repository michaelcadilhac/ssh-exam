// Manual stress baseline: actual HTTP middleware, no authentication or native
// calls. Preserve any refusals as failures; never reset budgets to get a pass.
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";

const output = process.env.EXAM_STRESS_BASELINE_OUTPUT;
if (!output) throw Error("Use the explicit manual stress runner");
if (!existsSync("dist/web/index.html"))
  throw Error(
    "Build the candidate first: npm run test:stress -- --phase build --native-bundle PATH",
  );
const data = mkdtempSync(tmpdir() + "/exam-anonymous-burst-");
const { app, store } = await createApp({
  mode: "development",
  origin: "http://localhost:3000",
  data,
  port: 3000,
  jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
  class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
  agent: { id: "class", signingKey: "/missing", callbackPublicKey: "/missing" },
  maintenance: false,
});
const requests: {
  student: number;
  url: string;
  status: number;
  expected: number;
  retryAfter: unknown;
}[] = [];
try {
  for (let student = 1; student <= 70; student++) {
    // A lower bound: omit assets, favicon, SSH and all retries. Every fresh
    // welcome page still needs its HTML, session lookup and public settings.
    for (const [url, expected] of [
      ["/", 200],
      ["/api/session", 401],
      ["/api/login-test", 200],
    ] as const) {
      const reply = await app.inject({ url, remoteAddress: "198.51.100.70" });
      requests.push({
        student,
        url,
        status: reply.statusCode,
        expected,
        retryAfter: reply.headers["retry-after"] ?? null,
      });
    }
  }
  const failures = requests.filter((row) => row.status !== row.expected);
  const counts = Object.fromEntries(
    ["attempts", "sessions", "outbox"].map((table) => [
      table,
      (
        store.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {
          n: number;
        }
      ).n,
    ]),
  );
  assert.deepEqual(counts, { attempts: 0, sessions: 0, outbox: 0 });
  const summary = {
    students: 70,
    shared_ips: 1,
    requests: requests.length,
    failures: failures.length,
    first_failure: failures[0] ?? null,
    durable_rows: counts,
    institutional_mfa: false,
    native_connections: false,
    external_mail: false,
  };
  writeFileSync(output, JSON.stringify({ summary, requests }, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify(summary));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await app.close();
  rmSync(data, { recursive: true, force: true });
}
