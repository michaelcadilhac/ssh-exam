// Credential-free deployment check. A short-lived signed ticket is supplied
// through a private file, never a URL or command-line credential argument.
import { readFileSync, unlinkSync } from "node:fs";
import { Duplex } from "node:stream";
import WebSocket from "ws";
import ssh2 from "ssh2";

const file = process.argv[2];
const pins = process.argv.slice(3);
if (!file || !pins.length || pins.some((pin) => !/^[a-f0-9]{64}$/.test(pin)))
  throw Error("Usage: probe.mjs PRIVATE_TICKET_FILE SHA256_HEX_PIN ...");
const ticket = readFileSync(file);
unlinkSync(file);
const url = "wss://csc-sys.cdm.depaul.edu/ssh-exam/relay";
const origin = "https://ssh-exam.cadilhac.name";

await new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { origin });
  const timer = setTimeout(() => {
    ws.terminate();
    reject(Error("Relay probe timed out"));
  }, 15000);
  let stream, client, verified = false;
  const finish = (error) => {
    clearTimeout(timer);
    ticket.fill(0);
    client?.destroy();
    stream?.destroy();
    ws.terminate();
    error ? reject(error) : resolve();
  };
  ws.on("error", () => finish(Error("Relay WebSocket failed")));
  ws.on("open", () => {
    ws.send(ticket.toString("utf8"));
    ticket.fill(0);
  });
  ws.on("message", (data, binary) => {
    if (!stream) {
      if (binary || JSON.parse(data.toString()).ready !== true) {
        finish(Error("Invalid relay acknowledgment"));
        return;
      }
      stream = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          ws.send(chunk, { binary: true }, callback);
        },
        destroy(error, callback) {
          ws.terminate();
          callback(error);
        },
      });
      client = new ssh2.Client();
      client.on("error", (error) => {
        if (verified && error.level === "client-authentication") finish();
        else finish(Error("SSH host verification or handshake failed"));
      });
      client.on("ready", () => finish(Error("Probe unexpectedly authenticated")));
      client.connect({
        sock: stream,
        host: "sshjump.depaul.edu",
        port: 22,
        username: "mcadilha",
        hostHash: "sha256",
        hostVerifier: (key) => (verified = pins.includes(String(key))),
        // Only the no-credential query is permitted. No password, keyboard
        // challenge, public key, SSH agent, or user session is used.
        authHandler: (methods, _partial, next) =>
          next(methods === null ? "none" : false),
        readyTimeout: 12000,
      });
    } else if (binary) {
      stream.push(data);
    } else finish(Error("Unexpected relay text frame"));
  });
  ws.on("close", () => {
    if (stream) stream.push(null);
    if (!verified) finish(Error("Relay closed before host verification"));
  });
});
console.log("Public HTTPS relay and pinned jump-host SSH handshake verified; no credentials supplied.");

for (const check of ["origin", "ticket"]) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      origin: check === "origin" ? "https://invalid.example" : origin,
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(Error("Relay rejection check timed out"));
    }, 6000);
    ws.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      ws.terminate();
      if (check === "origin" && response.statusCode === 403) resolve();
      else reject(Error("Unexpected relay HTTP response"));
    });
    ws.on("error", () => {
      clearTimeout(timer);
      if (check !== "origin") reject(Error("Relay rejection check failed"));
    });
    ws.on("open", () => ws.send('{"payload":"invalid","signature":"invalid"}'));
    ws.on("close", (code) => {
      clearTimeout(timer);
      if (check === "ticket" && code === 1008) resolve();
      else if (check !== "origin") reject(Error("Invalid ticket was not rejected"));
    });
  });
}
console.log("Wrong-origin and invalid-ticket connections rejected.");
