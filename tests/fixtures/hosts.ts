import ssh2 from "ssh2";
const { Server, utils } = ssh2;
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import net from "node:net";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hash, secret } from "../../apps/server/src/db.js";
export async function hosts(
  options: {
    classCertificates?: boolean;
    password?: string;
    rejectJump?: boolean;
    repeatJumpPassword?: boolean;
    rejectClass?: boolean;
    mfaDelayMs?: number;
    classKeyboard?: boolean;
    jumpPasswordPrompt?: string;
  } = {},
) {
  const password = options.password ?? "shared-password";
  const signing = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const callback = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const dir = mkdtempSync(tmpdir() + "/exam-ssh-keys-");
  writeFileSync(dir + "/gateway.key", signing.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/agent.pub", callback.publicKey);
  const agentConfig = {
    id: "class",
    signingKey: dir + "/gateway.key",
    callbackPublicKey: dir + "/agent.pub",
  };
  const control = {
    command: undefined as undefined | ((op: string, body: any) => Promise<any>),
  };
  const key = () =>
    generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "pkcs1" },
    }).privateKey;
  const jumpKey = key(),
    classKey = key();
  const pin = (k: string) => hash((utils.parseKey(k) as any).getPublicSSH());
  const authCalls = { jump: 0, class: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const counts = { jump: 0, class: 0, panes: 0 };
  const activePanes = new Map<string, { attempt: string; pane: string }>();
  const caps = new Map<string, any>();
  const clients: any[] = [];
  let classPort = 0;
  let proxy: ChildProcess | undefined;
  let handoffCA = "";
  const issueHandoff = (publicKey: string) => {
    if (!handoffCA) throw Error("Certificate fixture is disabled");
    const id = randomUUID();
    const publicPath = dir + "/handoff-" + id + ".pub";
    writeFileSync(publicPath, publicKey);
    execFileSync("ssh-keygen", [
      "-q",
      "-s",
      handoffCA,
      "-I",
      id,
      "-n",
      "exam:fixture",
      "-V",
      "-5s:+60s",
      "-O",
      "clear",
      "-O",
      "force-command=exam-dispatch",
      "-O",
      "permit-pty",
      publicPath,
    ]);
    const certificate = readFileSync(
      publicPath.replace(/\.pub$/, "-cert.pub"),
      "utf8",
    ).trim();
    return { id, certificate, expires: Date.now() + 60000 };
  };
  let attempts = new Map<string, any>();
  const classServer = new Server({ hostKeys: [classKey] }, (client) => {
    const transportID = randomUUID();
    let authenticatedUsername = "";
    const receipt = (kind: string, nonce: string, result: any) => {
      const payload = Buffer.from(
        JSON.stringify({
          agent: "class",
          type: kind,
          nonce,
          username: authenticatedUsername,
          transport: transportID,
          expires: Date.now() + 120000,
          result,
          error: "",
        }),
      );
      return {
        payload: payload.toString("base64"),
        signature: sign(null, payload, callback.privateKey).toString("base64"),
      };
    };
    clients.push(client);
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.method === "none") {
        ctx.reject([
          options.classKeyboard ? "keyboard-interactive" : "password",
        ]);
        return;
      }
      if (ctx.method === "keyboard-interactive" && options.classKeyboard) {
        ctx.prompt(
          [
            { prompt: "Password:", echo: false },
            { prompt: "Verification code", echo: false },
          ],
          (answers) => {
            authCalls.class++;
            if (
              answers[0] === password &&
              answers[1] === "123456" &&
              !options.rejectClass
            ) {
              counts.class++;
              authenticatedUsername = ctx.username;
              ctx.accept();
            } else ctx.reject(["keyboard-interactive", "password"]);
          },
        );
        return;
      }
      if (ctx.method === "password") authCalls.class++;
      if (
        ctx.method === "password" &&
        ctx.password === password &&
        !options.rejectClass
      ) {
        counts.class++;
        authenticatedUsername = ctx.username;
        ctx.accept();
      } else ctx.reject(["keyboard-interactive", "password"]);
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (accept) => accept?.());
        session.on("window-change", (accept) => accept?.());
        session.on("exec", (accept, reject, info) => {
          if (info.command === "exam-control") {
            const stream = accept();
            if (!stream) return;
            let input = "";
            stream.on("data", (chunk: Buffer) => {
              input += chunk.toString();
              if (input.length > 65536) {
                stream.end();
                return;
              }
              if (!input.includes("\n")) return;
              const frame = JSON.parse(input.trim());
              input = "";
              const payload = Buffer.from(frame.payload, "base64");
              const cmd = JSON.parse(payload.toString());
              void (async () => {
                if (
                  !verify(
                    null,
                    payload,
                    signing.publicKey,
                    Buffer.from(frame.signature, "base64"),
                  ) ||
                  cmd.audience !== "class" ||
                  cmd.expires <= Date.now()
                )
                  throw Error("Invalid signed fixture command");
                if (cmd.op !== "register" && cmd.transport !== transportID)
                  throw Error("Transport mismatch");
                const result =
                  cmd.op === "register"
                    ? {
                        transport: transportID,
                        uid: 10001,
                        ...(control.command
                          ? await control.command("register", {
                              ...cmd.body,
                              transport: transportID,
                            })
                          : {}),
                      }
                    : await (control.command || agent.call)(cmd.op, cmd.body);
                stream.end(
                  JSON.stringify({
                    result,
                    proof: receipt("ssh-command-receipt", cmd.nonce, result),
                  }) + "\n",
                );
              })().catch((error) =>
                stream.end(
                  JSON.stringify({
                    error: error.message,
                    result: error.attemptState,
                  }) + "\n",
                ),
              );
            });
            return;
          }
          if (info.command !== "exam-gateway") {
            reject?.();
            return;
          }
          const stream = accept();
          if (!stream) return;
          stream.write("EXAM-GATE/1\r\n");
          let buffer = "";
          let admitted = false;
          let registration = false;
          let attemptId = "";
          let previousCR = false;
          const prompt = () => stream.write("/work $ ");
          const command = (line: string) => {
            const a = attempts.get(attemptId);
            if (line === "exit") {
              stream.exit(0);
              stream.end();
              return;
            }
            if (line.startsWith("save ")) {
              if (a) a.saved = line.slice(5);
              stream.write("Saved fixture text\r\n");
            } else if (line) {
              stream.write(
                (line === "pwd"
                  ? "/work"
                  : line === "help"
                    ? "Fixture commands: pwd, save TEXT, cat, exit. Real editors require the native class-server installation."
                    : line === "cat"
                      ? a?.saved || "No saved work"
                      : `Echo: ${line}`) + "\r\n",
              );
            }
            prompt();
          };
          stream.on("data", (d: Buffer) => {
            for (const ch of d.toString()) {
              if (!admitted) {
                if (ch !== "\n") {
                  buffer += ch;
                  continue;
                }
                const token = JSON.parse(buffer.trim()).token;
                buffer = "";
                const cap = caps.get(token);
                caps.delete(token);
                if (!cap) {
                  stream.end("EXAM-ERROR invalid token\n");
                  return;
                }
                admitted = true;
                attemptId = cap.id;
                registration = cap.purpose === "register";
                if (registration)
                  stream.write(
                    "EXAM-READY " +
                      JSON.stringify({ transport: transportID }) +
                      "\r\n",
                  );
                else {
                  counts.panes++;
                  const key = transportID + ":" + cap.pane;
                  activePanes.set(key, { attempt: cap.id, pane: cap.pane });
                  stream.once("close", () => activePanes.delete(key));
                  const result = {
                    attempt: cap.id,
                    pane: cap.pane,
                    transport: transportID,
                  };
                  stream.write(
                    "EXAM-READY " +
                      JSON.stringify({
                        ...result,
                        proof: receipt(
                          "ssh-pane-receipt",
                          hash(Buffer.from(token)),
                          result,
                        ),
                      }) +
                      "\r\n",
                  );
                  stream.write(
                    "\r\nDISPOSABLE DEVELOPMENT FIXTURE — simulated shell, not server containment\r\n",
                  );
                  prompt();
                }
                continue;
              }
              if (registration) continue;
              if (ch === "\n" && previousCR) {
                previousCR = false;
                continue;
              }
              previousCR = ch === "\r";
              if (ch === "\r" || ch === "\n") {
                stream.write("\r\n");
                const line = buffer.trim();
                buffer = "";
                command(line);
              } else if (ch === "\u007f" || ch === "\b") {
                if (buffer.length) {
                  buffer = buffer.slice(0, -1);
                  stream.write("\b \b");
                }
              } else if (ch === "\u0003") {
                buffer = "";
                stream.write("^C\r\n");
                prompt();
              } else if (ch === "\u0004" && !buffer.length) {
                stream.exit(0);
                stream.end();
                return;
              } else if (ch >= " ") {
                buffer += ch;
                stream.write(ch);
              }
            }
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve) =>
    classServer.listen(0, "127.0.0.1", resolve),
  );
  classPort = (classServer.address() as net.AddressInfo).port;
  if (options.classCertificates) {
    handoffCA = dir + "/handoff-ca";
    execFileSync("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      handoffCA,
    ]);
    const proxyConfig = dir + "/proxy.json";
    writeFileSync(
      proxyConfig,
      JSON.stringify({
        HostKey: classKey,
        CA: readFileSync(handoffCA + ".pub", "utf8"),
        Password: password,
        Backend: "127.0.0.1:" + classPort,
      }),
      { mode: 0o600 },
    );
    const binary = dir + "/certificate-proxy";
    execFileSync(
      process.env.EXAM_GO || "go",
      ["build", "-o", binary, "./cmd/fixture-proxy"],
      { cwd: "browser-ssh" },
    );
    proxy = spawn(binary, [proxyConfig], { stdio: ["ignore", "pipe", "pipe"] });
    const lines = createInterface({ input: proxy.stdout! });
    classPort = await new Promise<number>((resolve, reject) => {
      lines.once("line", (line) => {
        resolve(JSON.parse(line).port);
        lines.close();
      });
      proxy!.once("error", reject);
      proxy!.once("exit", () => reject(Error("Certificate fixture ended")));
    });
  }
  const jumpServer = new Server({ hostKeys: [jumpKey] }, (client) => {
    clients.push(client);
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.method === "none") {
        ctx.reject(["keyboard-interactive"]);
        return;
      }
      if (ctx.method === "keyboard-interactive") {
        ctx.prompt(
          [
            {
              prompt: options.jumpPasswordPrompt ?? "Jump password",
              echo: false,
            },
          ],
          (answers) => {
            authCalls.jump++;
            if (answers[0] !== password || options.rejectJump) {
              ctx.reject(["keyboard-interactive", "password"]);
              return;
            }
            if (options.repeatJumpPassword) {
              ctx.prompt([{ prompt: "Password:", echo: false }], () => {
                authCalls.jump++;
                ctx.reject(["keyboard-interactive", "password"]);
              });
              return;
            }
            ctx.prompt(
              [],
              "Number matching",
              "Enter number 42 in your authentication app. <script>plain text only</script>",
              () => {
                // Some MFA hosts follow their number message with an empty round.
                ctx.prompt([], "", "", () => {
                  const timer = setTimeout(() => {
                    timers.delete(timer);
                    counts.jump++;
                    ctx.accept();
                  }, options.mfaDelayMs ?? 700);
                  timers.add(timer);
                });
              },
            );
          },
        );
      } else ctx.reject(["keyboard-interactive"]);
    });
    client.on("ready", () =>
      client.on("tcpip", (accept, reject, info) => {
        if (info.destIP !== "127.0.0.1" || info.destPort !== classPort) {
          reject();
          return;
        }
        const stream = accept();
        const sock = net.connect(classPort, "127.0.0.1");
        sock.on("error", () => stream.destroy());
        sock.pipe(stream).pipe(sock);
      }),
    );
  });
  await new Promise<void>((resolve) =>
    jumpServer.listen(0, "127.0.0.1", resolve),
  );
  const agent = {
    sign: (op: string, username: string, transport: string, body: any) => {
      const payload = Buffer.from(
        JSON.stringify({
          audience: "class",
          nonce: randomUUID(),
          expires: Date.now() + 30000,
          op,
          username,
          transport,
          body,
        }),
      );
      return {
        payload: payload.toString("base64"),
        signature: sign(null, payload, signing.privateKey).toString("base64"),
      };
    },
    call: async (op: string, r: any = {}) => {
      const purpose =
        op === "issue-registration" ? "register" : r.purpose || "exam";
      if (op.startsWith("issue-")) {
        const token = secret();
        caps.set(token, { ...r, purpose });
        return { token };
      }
      throw Error("Fixture agent operation unavailable");
    },
  };
  return {
    jump: {
      host: "127.0.0.1",
      port: (jumpServer.address() as net.AddressInfo).port,
      pins: [pin(jumpKey)],
    },
    class: { host: "127.0.0.1", port: classPort, pins: [pin(classKey)] },
    counts,
    activePanes,
    issueHandoff,
    authCalls,
    agent,
    agentConfig,
    control,
    callbackKey: callback.privateKey,
    caps,
    attempts,
    close: async () => {
      proxy?.kill();
      rmSync(dir, { recursive: true, force: true });
      for (const timer of timers) clearTimeout(timer);
      for (const c of clients) c.end();
      await Promise.all([
        new Promise<void>((r) => jumpServer.close(() => r())),
        new Promise<void>((r) => classServer.close(() => r())),
      ]);
    },
  };
}
