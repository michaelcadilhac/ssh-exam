// Actual gateway/browser against the guarded csc-sys native guest. Test-only.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import argon2 from "argon2";
import { WebSocketServer } from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { managementOperations } from "../../packages/protocol/management.js";
import { hosts } from "./hosts.js";
import { nativeGuest } from "./native-guest.js";
import { browserGatewayProcess } from "./browser-gateway-process.js";

const origin = "https://127.0.0.1:9444";
const data = mkdtempSync(tmpdir() + "/ssh-exam-browser-native-");
const students = Number(process.env.EXAM_BROWSER_NATIVE_STUDENTS || "1");
const large = process.env.EXAM_BROWSER_NATIVE_LARGE === "1";
const guest = await nativeGuest(
  process.env.EXAM_BROWSER_NATIVE_BUNDLE || "",
  data,
  students,
  large,
);
let cleanup = async () => {
  await guest.close();
};
let terminating = false;
const terminate = (code: number, error?: unknown) => {
  if (terminating) return;
  terminating = true;
  if (error) console.error(error);
  void cleanup().then(
    () => process.exit(code),
    (failure) => {
      console.error(failure);
      process.exit(1);
    },
  );
};
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => terminate(0));
process.once("uncaughtException", (error) => terminate(1, error));
process.once("unhandledRejection", (error) => terminate(1, error));
const h = await hosts({ forwardClass: guest.target, mfaDelayMs: 10 });
cleanup = async () => {
  await guest.close();
  await h.close();
};
const publicKey = createPublicKey(readFileSync(h.agentConfig.signingKey))
  .export({ type: "spki", format: "pem" })
  .toString();
const metadata = await guest.start(publicKey);
writeFileSync(h.agentConfig.callbackPublicKey, metadata.callbackPublicKey, {
  mode: 0o600,
});
// Independent local TLS identity: only its PUBLIC origin matches the guest's
// pinned TLS fixture. Neither private key crosses the SSH test boundary.
execFileSync(
  "python3",
  [
    "-c",
    `
import datetime,ipaddress,os,sys
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
p=Path(sys.argv[1]);key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Private local native browser test')]);now=datetime.datetime.now(datetime.timezone.utc)
cert=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(key.public_key()).serial_number(x509.random_serial_number())
.not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1))
.add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).sign(key,hashes.SHA256()))
(p/'tls.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));os.chmod(p/'tls.key',0o600)
(p/'tls.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
`,
    data,
  ],
  { timeout: 10000 },
);
const tls = {
  key: readFileSync(data + "/tls.key"),
  cert: readFileSync(data + "/tls.crt"),
};
const gatewayConfig: Parameters<typeof createApp>[0] = {
  mode: "development",
  origin,
  port: 3100,
  data,
  maintenance: false,
  jump: h.jump,
  class: h.class,
  agent: {
    ...h.agentConfig,
    id: metadata.agent,
    managementOperations: [...managementOperations],
  },
  browserSSH: {
    relay: "wss://127.0.0.1:9445",
    audience: "native-browser-relay",
  },
};
const gateway =
  process.env.EXAM_BROWSER_NATIVE_GATEWAY_PROCESS === "1"
    ? browserGatewayProcess(
        gatewayConfig,
        new URL("../../apps/server/src/connection-worker.ts", import.meta.url),
        { detached: true },
      )
    : undefined;
if (gateway) {
  const previousCleanup = cleanup;
  cleanup = async () => {
    try {
      await previousCleanup();
    } finally {
      try {
        await gateway.app.close();
      } finally {
        rmSync(data + "/tls.key", { force: true });
      }
    }
  };
  await gateway.initialized;
}
const { app, store } = gateway ?? (await createApp(gatewayConfig));
store.db
  .prepare("INSERT INTO admins VALUES(?,?,?)")
  .run("fixture", "instructor", await argon2.hash("fixture-password"));
let ready = false;
app.get("/api/fixture/native-ready", async (_req, reply) => {
  if (!ready) reply.code(503);
  return {
    ready,
    privateGuest: true,
    uid: metadata.uid,
    students: metadata.students,
    large,
    gatewayProcess: !!gateway,
    log: data + "/native-root.log",
  };
});
app.get("/api/fixture/native-state", async (req) =>
  guest.inspect(String((req.query as any).attempt)),
);
app.post("/api/fixture/native-finish", async (req) => {
  const value = await guest.inspect(String((req.body as any).attempt), true);
  await guest.finished();
  return { ...value, preservation: "FULL" };
});
app.post("/api/fixture/native-fleet", async (req) => {
  const body = req.body as any;
  const value = await guest.inspectMany(body.attempts, body.finish === true);
  if (body.finish === true) {
    await guest.finished();
    return { ...value, preservation: "FULL" };
  }
  return value;
});
app.post("/api/fixture/native-collection", async (req) => {
  const body = req.body as any;
  return guest.collection(body.attempts, body.action);
});
if (gateway) {
  let restarting = false;
  app.get("/api/fixture/native-gateway-runtime", async () => {
    const pid = gateway.pid;
    if (!pid) throw Error("Owned fixture gateway PID unavailable");
    // Signal0 observes the exact owned child's dedicated process group. The
    // runner may terminate the parent group; child shutdown stays parent-owned.
    process.kill(-pid, 0);
    return { pid, fixturePID: process.pid, ownGroup: true };
  });
  app.post("/api/fixture/native-gateway-restart", async (req) => {
    const mode = (req.body as any)?.mode;
    if (restarting || !["kill", "graceful"].includes(mode))
      throw Error("Explicit owned gateway restart mode required");
    restarting = true;
    const previous = gateway.pid;
    setTimeout(() => {
      void gateway
        .restart(mode)
        .catch((error) => terminate(1, error))
        .finally(() => {
          restarting = false;
        });
    }, 50);
    return { previous };
  });
}
await app.listen({ host: "127.0.0.1", port: 3100 });
// The optional child owns the real application/IPC; parent TLS, relay and SSH
// stay alive across its replacement. Original HTTP/WS headers/bytes are kept.
const web = https.createServer(tls, (req, res) => {
  if (!gateway) {
    app.server.emit("request", req, res);
    return;
  }
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: 3100,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(503);
    res.end("Private fixture gateway unavailable");
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
});
web.on("upgrade", (req, socket, head) => {
  if (!gateway) {
    app.server.emit("upgrade", req, socket, head);
    return;
  }
  const upstream = net.connect(3100, "127.0.0.1", () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    upstream.write("\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.on("close", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
});
const listenWeb = () =>
  new Promise<void>((resolve, reject) => {
    web.once("error", reject);
    web.listen(9444, "127.0.0.1", resolve);
  });
// Parent-owned fixture routes have no Fastify reply object. Keep the TLS ready
// URL unavailable until setup is complete in child mode; callbacks use3100.
if (!gateway) await listenWeb();
const relayServer = https.createServer(tls),
  relay = new WebSocketServer({ server: relayServer });
relay.on("connection", (ws, req) => {
  if (req.headers.origin !== origin) {
    ws.close(1008);
    return;
  }
  ws.once("message", (raw) => {
    try {
      const frame = JSON.parse(String(raw)),
        bytes = Buffer.from(frame.payload, "base64"),
        ticket = JSON.parse(String(bytes));
      if (
        ticket.op !== "relay-connect" ||
        ticket.origin !== origin ||
        ticket.audience !== "native-browser-relay" ||
        ticket.expires <= Date.now() ||
        !verify(
          null,
          bytes,
          readFileSync(h.agentConfig.signingKey),
          Buffer.from(frame.signature, "base64"),
        )
      )
        throw Error("Invalid private relay ticket");
      const upstream = net.connect(h.jump.port, h.jump.host, () =>
        ws.send('{"ready":true}'),
      );
      ws.on("message", (bytes, binary) => {
        if (!binary) ws.close(1008);
        else upstream.write(bytes as Buffer);
      });
      upstream.on("data", (bytes) => ws.send(bytes, { binary: true }));
      upstream.on("error", () => ws.close());
      upstream.on("close", () => ws.close());
      ws.on("close", () => upstream.destroy());
    } catch {
      ws.close(1008);
    }
  });
});
await new Promise<void>((resolve, reject) => {
  relayServer.once("error", reject);
  relayServer.listen(9445, "127.0.0.1", resolve);
});
guest.startGateway();
const deadline = performance.now() + 60000;
while (true) {
  try {
    new TemplateCatalog(store, metadata.agent).show({
      name: "native-browser",
      hash: metadata.template,
    });
    break;
  } catch {
    if (performance.now() > deadline)
      throw Error(
        "Actual signed native source registration not received; inspect " +
          data,
      );
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const login = await app.inject({
  method: "POST",
  url: "/api/admin/login",
  headers: { origin },
  payload: { username: "instructor", password: "fixture-password" },
});
if (login.statusCode !== 200) throw Error("Private instructor setup failed");
const cookieHeader = login.headers["set-cookie"];
const cookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader])
  .filter((value) => typeof value === "string")
  .map((value) => String(value).split(";")[0])
  .join("; ");
if (!cookie) throw Error("Private instructor cookie unavailable");
const headers = { origin, cookie, "x-csrf-token": login.json().csrf };
for (const [url, payload] of [
  [
    "/api/admin/exams/versioned",
    {
      id: "native-browser",
      name: "Private native browser qualification",
      earliest: Date.now() - 1000,
      latest: Date.now() + 600000,
      duration: 5400,
      webcam: false,
      terminals: 4,
      template: "native-browser",
      template_version: metadata.template,
    },
  ],
  ...metadata.students.map(
    (student: { username: string }) =>
      [
        "/api/admin/exams/native-browser/roster/add",
        { username: student.username },
      ] as const,
  ),
] as const) {
  const result = await app.inject({ method: "POST", url, headers, payload });
  if (result.statusCode !== 200)
    throw Error(
      "Private public-interface setup refused: " + url + " " + result.body,
    );
}
ready = true;
if (gateway) await listenWeb();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  // Abort/drain the guarded guest BEFORE waiting on HTTP/socket shutdown. The
  // latter can wait on commands whose peer lives in that guest.
  try {
    await guest.close();
    for (const socket of relay.clients) socket.terminate();
    relay.close();
    await new Promise<void>((resolve) => relayServer.close(() => resolve()));
    await Promise.all([
      new Promise<void>((resolve) => web.close(() => resolve())),
      app.close(),
    ]);
  } finally {
    try {
      await h.close();
    } finally {
      rmSync(data + "/tls.key", { force: true });
    }
  }
}
cleanup = close;
console.log("Actual native/browser fixture ready; private evidence: " + data);
