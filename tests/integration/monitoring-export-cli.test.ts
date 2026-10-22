import { expect, it, vi } from "vitest";
import https from "node:https";
import http from "node:http";
import { Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { exportFixture } from "../fixtures/monitoring-export.js";
import { hash } from "../../apps/server/src/db.js";
import {
  monitoringExportChunk,
  monitoringExportContentType,
} from "../../packages/protocol/monitoring-export.js";

it.skipIf(process.env.EXAM_MANAGEMENT_USERNS !== "1")(
  "runs complete private export through the actual root-mapped CLI and streaming TLS, refusing bad signed packets/truncation/publication races",
  async () => {
    const tlsDir = mkdtempSync(tmpdir() + "/export-tls-"),
      run = promisify(execFile);
    let fixture: Awaited<ReturnType<typeof exportFixture>> | undefined;
    let server: https.Server | undefined,
      port = 0,
      mode: string | null = null,
      raceTarget = "";
    try {
      const key = tlsDir + "/tls.key",
        cert = tlsDir + "/tls.crt";
      await run("/usr/bin/openssl", [
        "req",
        "-x509",
        "-newkey",
        "ed25519",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-days",
        "1",
      ]);
      server = https.createServer(
        { key: readFileSync(key), cert: readFileSync(cert) },
        (req, res) => {
          const upstream = http.request(
            {
              host: "127.0.0.1",
              port,
              path: req.url,
              method: req.method,
              headers: req.headers,
            },
            (incoming) => {
              const headers = { ...incoming.headers };
              delete headers["content-length"];
              res.writeHead(incoming.statusCode!, headers);
              if (
                !incoming.headers["content-type"]?.includes(
                  monitoringExportContentType,
                ) ||
                !mode
              ) {
                incoming.pipe(res);
                return;
              }
              const selected = mode;
              let pending = Buffer.alloc(0),
                changed = false;
              const filter = new Transform({
                transform(chunk: Buffer, _encoding, done) {
                  pending = Buffer.concat([pending, chunk]);
                  if (pending.length > 8 * 1024 * 1024) {
                    done(Error("bounded fixture protocol"));
                    return;
                  }
                  for (;;) {
                    const newline = pending.indexOf(10);
                    if (newline < 0) break;
                    let line = pending.subarray(0, newline + 1);
                    pending = pending.subarray(newline + 1);
                    const envelope = JSON.parse(line.toString()),
                      packet = JSON.parse(
                        Buffer.from(envelope.payload, "base64").toString(),
                      );
                    const event = packet.event;
                    if (
                      !changed &&
                      selected === "publication-race" &&
                      event.kind === "end"
                    ) {
                      // This fixture owns the target; simulate an independent creator.
                      requireFixtureDirectory(raceTarget);
                      changed = true;
                    } else if (
                      !changed &&
                      selected === "wrong-file" &&
                      event.kind === "file-begin"
                    ) {
                      event.file = randomUUID();
                      changed = true;
                    } else if (
                      !changed &&
                      selected === "wrong-digest" &&
                      event.kind === "file-end"
                    ) {
                      event.sha256 = "a".repeat(64);
                      changed = true;
                    } else if (
                      !changed &&
                      selected === "wrong-scope" &&
                      event.kind === "file-data"
                    ) {
                      packet.id = "other";
                      changed = true;
                    } else if (
                      !changed &&
                      selected === "truncate" &&
                      event.kind === "file-data"
                    ) {
                      changed = true;
                      res.destroy();
                      upstream.destroy();
                      done();
                      return;
                    }
                    if (
                      changed &&
                      ["wrong-file", "wrong-digest", "wrong-scope"].includes(
                        selected,
                      )
                    ) {
                      const bytes = Buffer.from(JSON.stringify(packet));
                      line = Buffer.from(
                        JSON.stringify({
                          payload: bytes.toString("base64"),
                          signature: sign(
                            null,
                            bytes,
                            fixture!.gateway.privateKey,
                          ).toString("base64"),
                        }) + "\n",
                      );
                    }
                    this.push(line);
                    if (selected === "trailing" && event.kind === "end")
                      this.push(Buffer.from("\n"));
                  }
                  done();
                },
                flush(done) {
                  if (pending.length) this.push(pending);
                  done();
                },
              });
              filter.on("error", () => {
                res.destroy();
                upstream.destroy();
              });
              incoming.pipe(filter).pipe(res);
            },
          );
          upstream.on("error", () => res.destroy());
          req.on("aborted", () => upstream.destroy());
          res.on("close", () => {
            if (!res.writableEnded) upstream.destroy();
          });
          req.pipe(upstream);
        },
      );
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", resolve),
      );
      const origin =
        "https://127.0.0.1:" + (server.address() as AddressInfo).port;
      fixture = await exportFixture({
        origin,
        transcriptBytes: 2 * monitoringExportChunk + 31,
      });
      const f = fixture;
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      port = (f.app.server.address() as AddressInfo).port;
      const binary = tlsDir + "/examctl",
        config = tlsDir + "/agent.json";
      await run("go", ["build", "-o", binary, "./cmd/examctl"], {
        cwd: "ssh-server",
        timeout: 30000,
      });
      writeFileSync(tlsDir + "/agent.key", f.agent.privateKey, { mode: 0o600 });
      writeFileSync(tlsDir + "/gateway.pub", f.gateway.publicKey, {
        mode: 0o600,
      });
      writeFileSync(
        config,
        JSON.stringify({
          state: tlsDir + "/unused-state",
          work: tlsDir + "/unused-work",
          rootfs: tlsDir,
          accounts: {
            synthetic: {
              uid: 29999,
              gid: 29999,
              home: tlsDir,
              shell: "/bin/bash",
            },
          },
          agent_id: "class",
          gateway_public_key: tlsDir + "/gateway.pub",
          callback_key: tlsDir + "/agent.key",
          callback_url: origin,
          callback_ca: cert,
        }),
        { mode: 0o600 },
      );
      const invoke = (target: string, request = randomUUID()) =>
        run(
          "/usr/bin/unshare",
          [
            "--user",
            "--map-root-user",
            binary,
            "--config",
            config,
            "web",
            "monitoring",
            "export",
            "a",
            "--output",
            target,
            "--request",
            request,
          ],
          { timeout: 30000 },
        );
      const request = randomUUID(),
        target = tlsDir + "/complete-copy";
      const successful = await invoke(target, request),
        receipt = JSON.parse(successful.stdout);
      expect(receipt).toMatchObject({
        confirmed: true,
        operation: "monitoring.export",
        request,
        id: "a",
        directory: target,
        files: 3,
      });
      expect(successful.stdout).not.toContain("PRIVATE");
      expect(readFileSync(target + "/terminals/" + f.pane + ".ndjson")).toEqual(
        f.prefix,
      );
      expect(readFileSync(target + "/frames/" + f.frame.id + ".jpg")).toEqual(
        f.data,
      );
      expect(hash(readFileSync(target + "/manifest.json"))).toBe(
        receipt.manifestSha256,
      );
      expect(statSync(target).mode & 0o777).toBe(0o700);
      expect(existsSync(target + "/INCOMPLETE")).toBe(false);
      await expect(invoke(target)).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("never overwrite"),
      });
      expect(
        JSON.parse(
          (await invoke(tlsDir + "/same-request-fresh-copy", request)).stdout,
        ).confirmed,
      ).toBe(true);
      for (const fault of [
        "wrong-file",
        "wrong-digest",
        "wrong-scope",
        "truncate",
        "trailing",
        "publication-race",
      ]) {
        mode = fault;
        raceTarget = tlsDir + "/rejected-" + fault;
        const before = new Set(readdirSync(tlsDir));
        await expect(invoke(raceTarget)).rejects.toMatchObject({
          code: 1,
          stdout: "",
          stderr: expect.stringContaining("not completed"),
        });
        mode = null;
        if (fault === "publication-race")
          expect(readFileSync(raceTarget + "/kept", "utf8")).toBe("preserved");
        else expect(existsSync(raceTarget)).toBe(false);
        const partial = readdirSync(tlsDir).filter(
          (name) => !before.has(name) && name.endsWith(".incomplete"),
        );
        expect(partial).toHaveLength(1);
        expect(existsSync(tlsDir + "/" + partial[0] + "/INCOMPLETE")).toBe(
          true,
        );
        // Exercise the real endpoint again: one failed copy cannot poison a
        // healthy export or change the synthetic student's immutable authority.
        await vi.waitFor(
          async () => {
            const next = f.request(),
              response = await f.post(next);
            expect(response.headers["content-type"]).toContain(
              monitoringExportContentType,
            );
            expect(f.packets(response, next).at(-1).event.kind).toBe("end");
          },
          { timeout: 5000 },
        );
        expect(f.store.attempt("a")).toEqual(f.before);
      }
      f.agentConfig.managementOperations = [];
      const denied = tlsDir + "/denied";
      await expect(invoke(denied)).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("authorization"),
      });
      expect(existsSync(denied)).toBe(false);
      expect(existsSync(tlsDir + "/unused-state")).toBe(false);
    } finally {
      mode = null;
      server?.closeAllConnections();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (fixture) await fixture.close();
      rmSync(tlsDir, { recursive: true, force: true });
    }
  },
  60000,
);

import { mkdirSync } from "node:fs";
function requireFixtureDirectory(path: string) {
  mkdirSync(path, { mode: 0o700 });
  writeFileSync(path + "/kept", "preserved", { mode: 0o600 });
}
