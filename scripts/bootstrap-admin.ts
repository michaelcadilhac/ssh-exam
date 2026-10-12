import { Store } from "../apps/server/src/db.js";
import { loadConfig } from "../packages/config/index.js";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import readline from "node:readline/promises";
if (!process.stdin.isTTY)
  throw Error(
    "Administrator bootstrap requires an interactive TTY; no command-line passwords",
  );
const data = process.env.EXAM_DATA || loadConfig().data;
const r = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const username = await r.question("Administrator username: ");
r.close();
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(username)) throw Error("Invalid username");
async function hidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const listener = (b: Buffer) => {
      for (const ch of b.toString()) {
        if (ch === "\u0003") {
          cleanup();
          reject(Error("Cancelled"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      process.stdin.off("data", listener);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("data", listener);
  });
}
let password = await hidden("Password (12+ characters): ");
let confirm = await hidden("Confirm password: ");
if (password.length < 12 || password !== confirm)
  throw Error("Passwords must match and contain at least 12 characters");
const digest = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});
password = confirm = "";
const s = new Store(data);
s.db
  .prepare("INSERT INTO admins VALUES(?,?,?)")
  .run(randomUUID(), username, digest);
s.audit(username, "bootstrap", "administrator");
s.close();
console.log("Administrator created.");
