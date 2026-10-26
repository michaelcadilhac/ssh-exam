// Test-only controller for the guarded disposable csc-sys guest. No runtime caller.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

type NativeBridgeRequest = {
  path: string;
  headers: Record<string, string>;
  body: string;
};
// Runtime caller below reuses a private SSH link, with one request/reply in flight.
// Pipe chunks are NOT JSON frames. Default one-shot mode retains its strict oracle.
export function readNativeBridgeRequest(
  stream: Readable,
  request: (value: NativeBridgeRequest) => void | Promise<void>,
  refused: () => void,
  persistent = false,
) {
  const decoder = new StringDecoder("utf8");
  let raw = "",
    seen = false,
    pending = false,
    stopped = false;
  const fail = () => {
    if (!stopped) {
      stopped = true;
      refused();
    }
  };
  stream.on("data", (data: Buffer) => {
    if (stopped) return;
    raw += decoder.write(data);
    if (Buffer.byteLength(raw) > 1024 * 1024) {
      fail();
      return;
    }
    let end: number;
    while (!stopped && (end = raw.indexOf("\n")) >= 0) {
      const record = raw.slice(0, end);
      raw = raw.slice(end + 1);
      let value: any;
      try {
        value = JSON.parse(record);
      } catch {
        fail();
        return;
      }
      if (value?.bridge_error || (seen && !persistent) || pending) {
        fail();
        return;
      }
      seen = true;
      if (value?.idle === true) continue;
      if (
        !value ||
        !/^\/api\/agent\/[a-z-]+$/.test(value.path) ||
        typeof value.body !== "string" ||
        !value.headers ||
        typeof value.headers !== "object" ||
        Object.values(value.headers).some(
          (header) => typeof header !== "string",
        )
      ) {
        fail();
        return;
      }
      pending = persistent;
      try {
        Promise.resolve(request(value)).then(() => {
          pending = false;
        }, fail);
      } catch {
        fail();
      }
    }
  });
  stream.once("end", () => {
    raw += decoder.end();
    if (!seen || raw.length) fail();
  });
  stream.once("error", fail);
}

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const remote = (args: string[], detached = false) =>
  spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "csc-sys",
      args.map(quote).join(" "),
    ],
    { stdio: ["pipe", "pipe", "pipe"], detached },
  );

export async function nativeGuest(
  bundle: string,
  local: string,
  students = 1,
  large = false,
) {
  if (![1, 16].includes(students))
    throw Error("Private native capacity must be1or16");
  if (large && students !== 16)
    throw Error("Large private workload requires16students");
  if (
    !/^\/var\/tmp\/ssh-exam-browser-native-upload\.[A-Za-z0-9_]+$/.test(bundle)
  )
    throw Error("An exact private native-browser test bundle is required");
  let stage = "",
    stopping = false,
    hostTunnelExits = 0,
    gatewayFailures = 0,
    monitoringRefusals = 0,
    runner: ChildProcess | undefined;
  const processes = new Set<ChildProcess>();
  const logfile = local + "/native-root.log";
  writeFileSync(logfile, "", { mode: 0o600 });
  const track = (child: ChildProcess) => {
    child.stdin?.on("error", () => {});
    processes.add(child);
    child.once("exit", () => processes.delete(child));
    return child;
  };
  const collect = (child: ChildProcess, input?: string, timeout = 10000) =>
    new Promise<string>((resolve, reject) => {
      let output = "",
        errors = "",
        settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        settle(Error("Private guest operation timed out"));
      }, timeout);
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output);
      };
      child.on("error", (error: any) =>
        settle(
          Error(
            error.code === "ENOENT"
              ? "COMMAND_NOT_FOUND: ssh"
              : "Private SSH process failed",
          ),
        ),
      );
      child.stdout!.on("data", (data) => {
        output += String(data);
        if (Buffer.byteLength(output) > 1024 * 1024) {
          child.kill("SIGTERM");
          settle(Error("Private guest reply exceeds bound"));
        }
      });
      child.stderr!.on("data", (data) => {
        errors = (errors + String(data)).slice(-4096);
      });
      child.once("close", (code) =>
        settle(
          code === 0
            ? undefined
            : Error(`Private guest operation refused (${code}): ${errors}`),
        ),
      );
      if (input !== undefined) child.stdin!.write(input);
      // Keep stdin open until the peer replies; EOF is not a reply receipt.
    });
  const bridge = (mode: string) => {
    if (!stage) throw Error("Private guest has not started");
    return track(
      remote([
        "sudo",
        "-n",
        "python3",
        bundle + "/browser_bridge.py",
        "--host",
        stage,
        mode,
      ]),
    );
  };
  const proxy = net.createServer((socket) => {
    if (!stage || stopping) {
      socket.destroy();
      return;
    }
    const child = bridge("ssh");
    let errors = "",
      socketClosed = false;
    socket.pipe(child.stdin!);
    child.stdout!.pipe(socket);
    child.stderr!.on("data", (data) => {
      errors = (errors + String(data)).slice(-2048);
    });
    child.on("error", () => socket.destroy());
    child.once("close", (code, signal) => {
      if (!stopping && !socketClosed && hostTunnelExits++ < 32)
        appendFileSync(
          local + "/host-ssh-bridge-failures.jsonl",
          JSON.stringify({ stage: "host-tunnel-exit", code, signal, errors }) +
            "\n",
          { mode: 0o600 },
        );
      socket.destroy();
    });
    socket.once("close", () => {
      socketClosed = true;
      child.kill("SIGTERM");
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const target = {
    host: "127.0.0.1" as const,
    port: (proxy.address() as net.AddressInfo).port,
    pins: [] as string[],
  };
  let completion: Promise<number | null> | undefined;
  return {
    target,
    async start(publicKey: string) {
      const digest = createHash("sha256").update(publicKey).digest("hex");
      const keyfile = bundle + "/browser-gateway-" + digest + ".pub";
      const upload = track(
        remote([
          "python3",
          "-c",
          "import os,sys; p=sys.argv[1]; d=sys.stdin.buffer.read(257); assert 0<len(d)<=256 and b'PRIVATE' not in d; f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); os.write(f,d); os.close(f)",
          keyfile,
        ]),
      );
      const uploaded = collect(upload);
      upload.stdin!.end(publicKey);
      await uploaded;
      runner = track(
        remote(
          [
            "sudo",
            "-n",
            "python3",
            bundle + "/overlay_qualification.py",
            "--guest",
            "/opt/ssh-exam-qualification/guest",
            "--bundle",
            bundle,
            "--profile",
            "retained-policy",
            "--browser-gateway-public-key",
            keyfile,
            "--browser-students",
            String(students),
            ...(large ? ["--browser-large"] : []),
            ...(process.env.EXAM_BROWSER_NATIVE_RELEASE === "1"
              ? ["--release-native"]
              : []),
          ],
          true,
        ),
      );
      completion = new Promise((resolve, reject) => {
        runner!.once("error", reject);
        runner!.once("close", resolve);
      });
      let output = "";
      for (const stream of [runner.stdout!, runner.stderr!])
        stream.on("data", (data) => {
          const value = String(data);
          appendFileSync(logfile, value);
          output = (output + value).slice(-65536);
          const found = output.match(
            /^Private test evidence: (\/var\/tmp\/ssh-exam-overlay-[a-z0-9_]+)$/m,
          );
          if (found) stage = found[1];
        });
      const until = performance.now() + 75000;
      let last = "";
      while (performance.now() < until) {
        if (runner.exitCode !== null || runner.signalCode !== null)
          throw Error(
            "Private guest ended before readiness: " + output.slice(-4096),
          );
        if (stage) {
          try {
            const metadata = JSON.parse(await collect(bridge("metadata")));
            if (
              process.env.EXAM_BROWSER_NATIVE_RELEASE === "1" &&
              metadata.releaseNative !== true
            )
              throw Error(
                "Private guest did not verify actual public release roles",
              );
            if (
              metadata.username !== "examq" ||
              !Number.isInteger(metadata.uid) ||
              !Array.isArray(metadata.classPins)
            )
              throw Error("Private guest metadata mismatch");
            target.pins = metadata.classPins;
            return metadata;
          } catch (error) {
            last = String(error);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw Error("Private native guest not ready: " + last);
    },
    startGateway() {
      const worker = async () => {
        while (!stopping) {
          const child = bridge("gateway");
          const controller = new AbortController();
          child.once("close", () => controller.abort());
          let errors = "";
          child.stderr!.on("data", (data) => {
            errors = (errors + String(data)).slice(-2048);
          });
          child.once("close", (code, signal) => {
            if (!stopping && code !== 0 && gatewayFailures++ < 32)
              appendFileSync(
                local + "/gateway-bridge-failures.jsonl",
                JSON.stringify({
                  stage: "gateway-host-tunnel-exit",
                  code,
                  signal,
                  errors,
                }) + "\n",
                { mode: 0o600 },
              );
          });
          readNativeBridgeRequest(
            child.stdout!,
            async (request) => {
              try {
                if (!/^\/api\/agent\/[a-z-]+$/.test(request.path))
                  throw Error("Invalid private callback path");
                const headers = new Headers(request.headers);
                headers.delete("connection");
                headers.delete("host");
                headers.delete("content-length");
                const response = await fetch(
                  "http://127.0.0.1:3100" + request.path,
                  {
                    method: "POST",
                    headers,
                    body: Buffer.from(request.body, "base64"),
                    signal: AbortSignal.any([
                      controller.signal,
                      AbortSignal.timeout(2500),
                    ]),
                  },
                );
                const body = Buffer.from(await response.arrayBuffer());
                if (body.length > 524288)
                  throw Error("Private callback reply exceeds bound");
                if (
                  request.path === "/api/agent/monitoring-continue" &&
                  response.status !== 200 &&
                  monitoringRefusals++ < 64
                ) {
                  // Fixed error taxonomy only: no signed request, nonce,
                  // credentials, capture or arbitrary response text is logged.
                  let reason = "other";
                  try {
                    reason =
                      String(JSON.parse(body.toString()).error).match(
                        /^Monitoring evidence (ownership|capacity|challenge|technical-gap|policy-blocked|conflict|sequence|clock);/,
                      )?.[1] || "other";
                  } catch {
                    /* Malformed reply remains an unclassified refusal. */
                  }
                  appendFileSync(
                    local + "/monitoring-refusals.jsonl",
                    JSON.stringify({
                      route: request.path,
                      status: response.status,
                      reason,
                      replyHash: createHash("sha256")
                        .update(body)
                        .digest("hex"),
                    }) + "\n",
                    { mode: 0o600 },
                  );
                }
                if (!controller.signal.aborted)
                  child.stdin!.write(
                    JSON.stringify({
                      status: response.status,
                      body: body.toString("base64"),
                    }) + "\n",
                  );
              } catch {
                if (!controller.signal.aborted)
                  child.stdin!.write(
                    JSON.stringify({
                      status: 503,
                      body: Buffer.from(
                        '{"error":"Private gateway unavailable"}',
                      ).toString("base64"),
                    }) + "\n",
                  );
              }
            },
            () => {
              controller.abort();
              child.kill("SIGTERM");
            },
            true,
          );
          await new Promise((resolve) => {
            child.once("error", resolve);
            child.once("close", resolve);
          });
          if (!stopping)
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      // Keep host SSH process churn bounded. The guest queue accommodates both
      // proof bursts; adding per-request SSH workers is not proof of throughput.
      for (let i = 0; i < 4; i++) void worker();
    },
    async inspect(attempt: string, finish = false) {
      const value = JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({ attempt, finish }) + "\n",
        ),
      );
      if (value.bridge_error)
        throw Error(
          `Private attempt observation refused at ${value.stage}: ${value.bridge_error}; inspect the owned guest's inspect-refusal.json`,
        );
      return value;
    },
    async sshRecovery(
      attempt: string,
      action: "stop" | "verify" | "source-sync" | "release" | "finish",
      grant?: string,
    ) {
      if (students !== 1 || large)
        throw Error("Private SSH recovery requires one synthetic student");
      const value = JSON.parse(
        await collect(
          bridge("operator"),
          JSON.stringify({ attempt, ssh_recovery: action, grant }) + "\n",
          130000,
        ),
      );
      if (value.bridge_error)
        throw Error("Private SSH recovery refused: " + value.bridge_error);
      return value;
    },
    async inspectMany(
      attempts: string[],
      finish = false,
      recovery?: "start" | "status" | "restore",
    ) {
      if (
        students !== 16 ||
        attempts.length !== 16 ||
        new Set(attempts).size !== 16
      )
        throw Error("Exact private16-attempt fleet required");
      const value = JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({ attempts, finish, recovery }) + "\n",
        ),
      );
      if (value.bridge_error)
        throw Error(
          `Private fleet observation refused at ${value.stage}: ${value.bridge_error}; inspect the owned guest's inspect-refusal.json`,
        );
      return value;
    },
    async coordinator(
      attempt: string,
      action: "start" | "status" | "restore",
      allProofPaths = false,
      transportOnly = false,
    ) {
      if (students !== 1)
        throw Error("Private coordinator fault requires one synthetic attempt");
      const value = JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({
            attempt,
            coordinator: action,
            all_proof_paths: allProofPaths,
            transport_only: transportOnly,
          }) + "\n",
        ),
      );
      if (value.bridge_error)
        throw Error(
          "Private coordinator observation refused: " + value.bridge_error,
        );
      return value;
    },
    async transition(attempt: string, action: "start" | "status") {
      if (students !== 1)
        throw Error("Private transition fault requires one synthetic attempt");
      const value = JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({ attempt, transition: action }) + "\n",
        ),
      );
      if (value.bridge_error)
        throw Error(
          "Private transition observation refused: " + value.bridge_error,
        );
      return value;
    },
    async gate(
      attempt: string,
      action: "start" | "status" | "restore",
      technicalRecovery = false,
    ) {
      if (students !== 1)
        throw Error("Private gate fault requires one synthetic attempt");
      const value = JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({
            attempt,
            gate: action,
            technical_recovery: technicalRecovery,
          }) + "\n",
        ),
      );
      if (value.bridge_error)
        throw Error("Private gate observation refused: " + value.bridge_error);
      return value;
    },
    async collection(
      attempts: string[],
      action: "observe" | "kill" | "retry-verify",
    ) {
      if (!large || attempts.length !== 2 || new Set(attempts).size !== 2)
        throw Error("Exact private large pair required");
      return JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({ collection: { attempts, action } }) + "\n",
        ),
      );
    },
    async close() {
      if (stopping) return;
      if (stage && runner?.exitCode === null) {
        await collect(bridge("inspect"), '{"abort":true}\n').catch(() => {});
      }
      stopping = true;
      for (const child of processes)
        if (child !== runner) child.kill("SIGTERM");
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      if (completion) {
        await Promise.race([
          completion,
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Error(
                    "Owned private runner did not finish; inspect " + logfile,
                  ),
                ),
              20000,
            ),
          ),
        ]);
      }
    },
    async finished() {
      if (!completion) throw Error("Private runner missing");
      const code = await Promise.race([
        completion,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("Private qualification completion timed out")),
            20000,
          ),
        ),
      ]);
      if (code !== 0)
        throw Error("Private native qualification failed; inspect " + logfile);
      return { preserved: true };
    },
  };
}
