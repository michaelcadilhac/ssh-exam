import { test } from "node:test";
import assert from "node:assert/strict";
import { installSplitSSH } from "./browser-adapter.js";

test("private acceptance adapter scopes a single clone and preserves answers", () => {
  const messages = [];
  globalThis.location = { origin: "https://acceptance.invalid" };
  globalThis.Worker = class {
    postMessage(value) { messages.push(structuredClone(value)); }
  };
  const host = { host: "pinned.invalid", port: 22, pins: ["1".repeat(64)] };
  const settings = {
    origin: location.origin, expires: Date.now() + 60000,
    username: "acceptanceq", jumpUsername: "instructor",
    relay: "wss://relay.invalid", jump: host, class: host,
    privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-test-only",
  };
  installSplitSSH(settings);
  assert.equal(settings.privateKey, undefined);
  const worker = new Worker();
  const connect = { id: "connect-id", op: "connect", args: {
    username: "acceptanceq", url: settings.relay,
    jump: host, class: host, controlToken: "unchanged-token",
  } };
  for (const wrong of [
    { ...connect.args, username: "instructor" },
    { ...connect.args, url: "wss://wrong.invalid" },
    { ...connect.args, class: { ...host, pins: ["2".repeat(64)] } },
    { ...connect.args, jump: { ...host, acceptance_username: "other" } },
  ]) assert.throws(() => worker.postMessage({ ...connect, args: wrong }), /refused/);
  assert.equal(messages.length, 0);
  worker.postMessage(connect);
  assert.equal(messages[0].args.username, "acceptanceq");
  assert.equal(messages[0].args.jump.acceptance_username, "instructor");
  assert.match(messages[0].args.class.acceptance_private_key, /synthetic-test-only/);
  assert.equal(messages[0].args.controlToken, "unchanged-token");
  assert.equal(connect.args.class.acceptance_private_key, undefined);
  assert.throws(() => worker.postMessage(connect), /refused/);
  const answers = { op: "answers", args: { round: "human", answers: ["never-inspected"] } };
  worker.postMessage(answers);
  assert.deepEqual(messages[1], answers);
  settings.expires = Date.now() - 1;
  assert.throws(() => worker.postMessage(connect), /refused/);
});

test("acceptance setup refuses wrong origin and expired setup", () => {
  for (const settings of [
    { origin: "https://wrong.invalid", expires: Date.now() + 60000 },
    { origin: location.origin, expires: Date.now() - 1 },
  ]) assert.throws(() => installSplitSSH(settings), /Invalid or expired/);
});
