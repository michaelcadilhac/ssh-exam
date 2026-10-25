// Test-only controller for the guarded disposable csc-sys guest. No runtime caller.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";

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

export async function nativeGuest(bundle: string, local: string) {
  if (
    !/^\/var\/tmp\/ssh-exam-browser-native-upload\.[A-Za-z0-9_]+$/.test(bundle)
  )
    throw Error("An exact private native-browser test bundle is required");
  let stage = "",
    stopping = false,
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
    socket.pipe(child.stdin!);
    child.stdout!.pipe(socket);
    child.stderr!.on("data", () => {});
    child.on("error", () => socket.destroy());
    child.once("close", () => socket.destroy());
    socket.once("close", () => child.kill("SIGTERM"));
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
          let raw = "";
          child.stderr!.on("data", () => {});
          child.stdout!.on("data", async (data) => {
            raw += String(data);
            if (Buffer.byteLength(raw) > 1024 * 1024) {
              child.kill("SIGTERM");
              return;
            }
            if (!raw.endsWith("\n")) return;
            const request = JSON.parse(raw);
            raw = "";
            if (request.idle) return;
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
                  signal: AbortSignal.timeout(2500),
                },
              );
              const body = Buffer.from(await response.arrayBuffer());
              if (body.length > 524288)
                throw Error("Private callback reply exceeds bound");
              child.stdin!.write(
                JSON.stringify({
                  status: response.status,
                  body: body.toString("base64"),
                }) + "\n",
              );
            } catch {
              child.stdin!.write(
                JSON.stringify({
                  status: 503,
                  body: Buffer.from(
                    '{"error":"Private gateway unavailable"}',
                  ).toString("base64"),
                }) + "\n",
              );
            }
          });
          await new Promise((resolve) => {
            child.once("error", resolve);
            child.once("close", resolve);
          });
          if (!stopping)
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      for (let i = 0; i < 4; i++) void worker();
    },
    async inspect(attempt: string, finish = false) {
      return JSON.parse(
        await collect(
          bridge("inspect"),
          JSON.stringify({ attempt, finish }) + "\n",
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
