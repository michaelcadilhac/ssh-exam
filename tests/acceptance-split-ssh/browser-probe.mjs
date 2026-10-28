// Real Chromium/WASM/two-hop SSH qualification; synthetic local identities only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import ssh2 from "ssh2";
import { WebSocketServer } from "ws";
import { chromium } from "@playwright/test";
import { installSplitSSH } from "./browser-adapter.js";

const assets = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const keys = mkdtempSync(tmpdir() + "/ssh-exam-split-probe-");
const sockets = new Set();
let browser, http, relay, jump, target;
const counts = { jump: 0, class: 0, classPasswords: 0, commands: 0 };
const pin = (key) => createHash("sha256").update(ssh2.utils.parseKey(key).getPublicSSH()).digest("hex");
const hostKey = () => generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "pkcs1" } }).privateKey;
const listen = (server) => new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const close = (server) => server ? new Promise((ok) => server.close(ok)) : undefined;
try {
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keys + "/bootstrap"], { timeout: 10000 });
  const privateKey = readFileSync(keys + "/bootstrap", "utf8");
  const expected = ssh2.utils.parseKey(privateKey);
  const classKey = hostKey(), jumpKey = hostKey();
  target = new ssh2.Server({ hostKeys: [classKey] }, (client) => {
    sockets.add(client); client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.method === "password") counts.classPasswords++;
      if (ctx.username !== "acceptanceq" || ctx.method !== "publickey" || !ctx.key.data.equals(expected.getPublicSSH()) || (ctx.signature && !expected.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) return ctx.reject(["publickey"]);
      ctx.accept();
    });
    client.on("ready", () => { counts.class++; client.on("session", (accept) => {
      const session = accept();
      session.on("exec", (accept, reject, info) => {
        if (info.command !== "exam-control") return reject();
        const stream = accept(); let buffered = "";
        stream.on("data", (chunk) => {
          buffered += chunk.toString();
          if (!buffered.includes("\n")) return;
          counts.commands++;
          stream.end(JSON.stringify({ username: "acceptanceq", synthetic: true }) + "\n");
        });
      });
    }); });
  });
  await listen(target);
  jump = new ssh2.Server({ hostKeys: [jumpKey] }, (client) => {
    sockets.add(client); client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.username !== "instructor" || ctx.method !== "keyboard-interactive") return ctx.reject(["keyboard-interactive"]);
      ctx.prompt([{ prompt: "Password:", echo: false }], (answers) => {
        if (answers[0] !== "synthetic-jump-password") return ctx.reject();
        ctx.prompt([], "Phone MFA", "Approve synthetic phone challenge", (answers) => { if (answers.length) return ctx.reject(); counts.jump++; ctx.accept(); });
      });
    });
    client.on("ready", () => client.on("tcpip", (accept, reject, info) => {
      if (info.destIP !== "127.0.0.1" || info.destPort !== target.address().port) return reject();
      const socket = net.connect(target.address().port, "127.0.0.1"); sockets.add(socket);
      socket.once("connect", () => { const channel = accept(); channel.pipe(socket).pipe(channel); });
      socket.on("error", () => reject());
    }));
  });
  await listen(jump);
  const files = {
    "/worker.js": ["text/javascript", readFileSync("dist/web/assets/ssh-worker-FM5arK7Q.js")],
    "/ssh/client.wasm": ["application/wasm", readFileSync(assets + "/client.wasm")],
    "/ssh/wasm_exec.js": ["text/javascript", readFileSync(assets + "/wasm_exec.js")],
  };
  http = createServer((request, response) => {
    const [type, body] = files[request.url] || ["text/html", "<!doctype html><title>Private split SSH probe</title>"];
    response.writeHead(200, { "Content-Type": type }); response.end(body);
  });
  relay = new WebSocketServer({ server: http });
  relay.on("connection", (ws) => {
    ws.once("message", () => {
      const socket = net.connect(jump.address().port, "127.0.0.1"); sockets.add(socket);
      socket.on("error", () => ws.close());
      socket.once("connect", () => {
        ws.send('{"ready":true}');
        ws.on("message", (data, binary) => { if (!binary) return ws.close(); socket.write(data); });
        socket.on("data", (data) => { if (ws.readyState === 1) ws.send(data, { binary: true }); });
      });
      ws.once("close", () => socket.destroy());
      socket.once("close", () => ws.close());
    });
  });
  await listen(http);
  const origin = "http://127.0.0.1:" + http.address().port;
  const settings = { origin, expires: Date.now() + 60000, username: "acceptanceq", jumpUsername: "instructor", privateKey, relay: origin.replace("http", "ws"), jump: { host: "127.0.0.1", port: jump.address().port, pins: [pin(jumpKey)] }, class: { host: "127.0.0.1", port: target.address().port, pins: [pin(classKey)] } };
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, timeout: 15000 });
  const page = await browser.newPage();
  await page.addInitScript(installSplitSSH, settings);
  await page.goto(origin, { timeout: 10000 });
  const result = await page.evaluate(async ({ settings }) => {
    const worker = new Worker("/worker.js", { type: "module" });
    let asks = 0, notices = 0, sequence = 0;
    const pending = new Map();
    const rpc = (op, args) => new Promise((resolve, reject) => {
      const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(Error("Bounded RPC timeout: " + op)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, op, args }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
    let ready;
    const readiness = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("Worker readiness timeout")), 10000); ready = () => { clearTimeout(timer); resolve(); }; });
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") ready();
      if (data.type === "notice" && data.instruction?.includes("Phone MFA")) notices++;
      if (data.type === "challenge") { asks++; worker.postMessage({ id: "answer", op: "answers", args: { round: data.round, answers: ["synthetic-jump-password"] } }); }
      if (data.type === "rpc-result" && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(Error(data.error)) : p.resolve(data.result); }
    };
    try {
      await readiness;
      const connected = await rpc("connect", { username: settings.username, url: settings.relay, jump: settings.jump, class: settings.class, ticket: {} });
      const commands = [];
      for (let i = 0; i < 4; i++) commands.push(await rpc("command", {}));
      await rpc("close", {});
      return { connected, commands, asks, notices };
    } finally { worker.terminate(); }
  }, { settings: { ...settings, privateKey: undefined } });
  assert.equal(result.connected.connected, true);
  assert.equal(result.asks, 1); assert.equal(result.notices, 1);
  assert.equal(counts.jump, 1); assert.equal(counts.class, 1); assert.equal(counts.classPasswords, 0); assert.equal(counts.commands, 4);
  assert(result.commands.every((r) => r.username === "acceptanceq" && r.synthetic));
  const receipt = { at: new Date().toISOString(), test_only: true, actual_chromium_wasm_two_hop_ssh: "PASS", split_identity: true, jump_password_and_mfa_once: true, institutional_password_offered_to_class: false, retained_control_channels: 4, production_connections_or_writes: false };
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  for (const ws of relay?.clients || []) ws.terminate();
  for (const socket of sockets) socket.destroy?.() || socket.end?.();
  await close(relay); await close(http); await close(jump); await close(target);
  rmSync(keys, { recursive: true });
}
