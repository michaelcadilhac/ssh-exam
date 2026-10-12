// Explicit development executable. This simulation is never selected by production code.
import { hosts } from "./hosts.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import https from "node:https";
import path from "node:path";
import { Store, hash, now, secret } from "../../apps/server/src/db.js";
const dir = path.resolve("var/demo");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const run = (args: string[]) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
if (!existsSync(`${dir}/ca.crt`)) {
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "30",
    "-subj",
    "/CN=Disposable fixture CA",
  ]);
  for (const name of ["agent", "gateway"]) {
    run([
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
      "-subj",
      `/CN=${name}`,
    ]);
    writeFileSync(
      `${dir}/${name}.ext`,
      name === "agent"
        ? "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n"
        : "extendedKeyUsage=clientAuth\n",
    );
    run([
      "x509",
      "-req",
      "-in",
      `${name}.csr`,
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      `${name}.crt`,
      "-days",
      "30",
      "-extfile",
      `${name}.ext`,
    ]);
  }
}
const h = await hosts();
const dbDir = path.resolve("var/app");
const store = new Store(dbDir);
const exam = {
  id: "sample",
  name: "Development programming exam",
  earliest: now() - 60000,
  latest: now() + 86400000,
  duration: 5400,
  webcam: false,
  terminals: 4,
  template: "sample-exam",
};
store.db
  .prepare("INSERT OR IGNORE INTO exams VALUES(?,?)")
  .run(exam.id, JSON.stringify(exam));
store.db
  .prepare("INSERT OR IGNORE INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("sample", "student01", null, null, "Disposable student", 10001);
store.close();
const statePath = `${dir}/agent-state.json`;
const attempts = new Map<string, any>(
  existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : [],
);
const save = () =>
  writeFileSync(statePath, JSON.stringify([...attempts]), { mode: 0o600 });
const server = https.createServer(
  {
    key: readFileSync(`${dir}/agent.key`),
    cert: readFileSync(`${dir}/agent.crt`),
    ca: readFileSync(`${dir}/ca.crt`),
    requestCert: true,
    rejectUnauthorized: true,
  },
  async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      if (req.method === "GET" && req.url?.startsWith("/v1/export/")) {
        const id = req.url.split("/").at(-1)!;
        const a = attempts.get(id);
        if (a?.state !== "COMPLETED") throw Error("Unavailable");
        res.setHeader("Content-Type", "application/gzip");
        res.end(readFileSync(`${dir}/${id}.tar.gz`));
        return;
      }
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 4 * 1024 * 1024) throw Error("Too large");
      }
      const b = JSON.parse(text),
        op = req.url!.slice(4);
      let result: any;
      const a = attempts.get(b.id);
      if (op === "health")
        result = {
          ready: true,
          fixture: true,
          warning:
            "Simulated fixture; no native account, namespace or process enforcement",
        };
      else if (op === "resolve-course-accounts") {
        result = {};
        for (const u of b.usernames) {
          const uid = { student01: 10001, student02: 10002, student03: 10003 }[
            u as "student01" | "student02" | "student03"
          ];
          if (!uid)
            throw Error(
              "Demo course accounts: student01, student02, student03",
            );
          result[u] = uid;
        }
      } else if (op.startsWith("issue-")) result = await h.agent.call(op, b);
      else if (op === "prepare-attempt") {
        if (!attempts.has(b.id)) {
          attempts.set(b.id, { ...b, state: "PREPARING", generation: 0 });
          save();
        }
        result = attempts.get(b.id);
      } else if (!a) throw Error("Unknown attempt");
      else {
        switch (op) {
          case "activate-attempt":
            if (!a.start) {
              a.start = now();
              a.deadline = a.start + a.settings.duration * 1000;
              a.work_path = "/work";
              a.state = "ACTIVE";
              h.attempts.set(a.id, a);
            }
            break;
          case "lock-attempt":
            if (a.state === "ACTIVE") {
              a.state = "LOCKED";
              a.generation++;
            }
            break;
          case "authorize-continuation":
            a.authorization = b.expires;
            break;
          case "consume-continuation":
            if (a.authorization < now() || a.state !== "LOCKED")
              throw Error("Not authorized");
            a.authorization = 0;
            a.state = "ACTIVE";
            break;
          case "submission-status":
            break;
          case "submission-manifest":
            if (!a.protected) throw Error("Unavailable");
            res.end(
              JSON.stringify({
                attempt: a,
                files: [
                  {
                    path: "answer.txt",
                    size: Buffer.byteLength(a.saved || "No saved fixture work"),
                    sha256: hash(a.saved || "No saved fixture work"),
                  },
                ],
                omissions: [],
                collected: a.collected_at,
                secured: a.secured_at,
                checksum: a.checksum,
              }),
            );
            return;
          case "finalize-attempt":
            if (a.state !== "COMPLETED") {
              a.state = "COMPLETED";
              a.ended = now();
              a.reason = b.reason;
              a.completed_at = a.ended;
              a.collected_at = now();
              a.secured_at = a.collected_at;
              a.protected = true;
              const work = `${dir}/saved-${a.id}`;
              mkdirSync(work, { mode: 0o700, recursive: true });
              writeFileSync(
                `${work}/answer.txt`,
                a.saved || "No saved fixture work",
              );
              writeFileSync(
                `${work}/MANIFEST.json`,
                JSON.stringify({ fixture: true, ...a }),
              );
              execFileSync("/usr/bin/tar", [
                "-czf",
                `${dir}/${a.id}.tar.gz`,
                "-C",
                work,
                "answer.txt",
                "MANIFEST.json",
              ]);
              a.checksum = hash(readFileSync(`${dir}/${a.id}.tar.gz`));
            }
            break;
          case "cancel-attempt":
            a.state = "CANCELLED_BEFORE_START";
            break;
          case "inspect-attempt":
          case "renew-execution-lease":
          case "attach-transport":
            break;
          default:
            throw Error("Unsupported fixture operation");
        }
        save();
        result = a;
      }
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  },
);
await new Promise<void>((r) => server.listen(9443, "127.0.0.1", r));
const config = {
  mode: "development",
  origin: "http://localhost:3000",
  data: dbDir,
  port: 3000,
  jump: h.jump,
  class: h.class,
  agent: {
    url: "https://127.0.0.1:9443",
    ca: `${dir}/ca.crt`,
    cert: `${dir}/gateway.crt`,
    key: `${dir}/gateway.key`,
  },
};
writeFileSync(`${dir}/config.json`, JSON.stringify(config, null, 2), {
  mode: 0o600,
});
console.log(
  "Disposable SSH + mTLS fixtures listening. Configuration: var/demo/config.json. This is a simulation, not a secured class server.",
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.once(sig, () => {
    server.close();
    void h.close().then(() => process.exit());
  });
