import { expect, it, vi } from "vitest";
import https from "node:https";
import http from "node:http";
import { Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  appendFileSync,
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
  monitoringExportPurpose,
} from "../../packages/protocol/monitoring-export.js";
import { monitoringFrameProvenance } from "../../packages/protocol/monitoring-video.js";

it.skipIf(process.env.EXAM_MANAGEMENT_USERNS !== "1")(
  "runs legacy and optimized private export through the actual root-mapped CLI and streaming TLS, refusing bad signed packets/truncation/publication races",
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
      const invoke = (target: string, request = randomUUID(), id = "a") =>
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
            id,
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

      // A fresh, aged synthetic attempt exercises the public success path with
      // real codecs and CLI publication. The legacy fixture above is untouched.
      const videoId = "video-" + randomUUID(),
        ended = Date.now() - 60000,
        videoPane = randomUUID(),
        protectedPath = f.dir + "/submissions/protected-video-work";
      f.store.db
        .prepare(
          `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,access_held_at)
           VALUES(?,'e','synthetic-video',1002,'COMPLETED','{"webcam":true}',?,?,?,?,1,?,'HELD',?)`,
        )
        .run(
          videoId,
          ended - 60000,
          ended,
          ended,
          Date.now(),
          "a".repeat(64),
          ended,
        );
      writeFileSync(protectedPath, "PROTECTED-SYNTHETIC-SUBMISSION", {
        mode: 0o600,
      });
      const captures: any[] = [];
      for (let seq = 1; seq <= 3; seq++)
        for (const source of ["screen", "webcam"] as const) {
          const data = await sharp({
            create: {
              width: source === "screen" ? 1280 : 320,
              height: source === "screen" ? 720 : 240,
              channels: 3,
              background: source === "screen" ? "#17283d" : "#7b6c58",
            },
          })
            .jpeg({ quality: 50 })
            .toBuffer();
          captures.push(
            await f.monitoring.frame(
              f.store.attempt(videoId),
              {
                source,
                seq,
                captured: ended - (4 - seq) * 5000,
                monotonic: seq * 5000,
                data: data.toString("base64"),
              },
              "synthetic-video-page",
            ),
          );
        }
      f.monitoring.record(videoId, videoPane, {
        event: "output",
        data: "EXACT-SYNTHETIC-TERMINAL-日本語",
      });
      const videoTranscript = `${f.dir}/monitoring/${videoId}/${videoPane}.ndjson`;
      appendFileSync(videoTranscript, Buffer.from([123, 255, 0]));
      // Finish authoring archival history before taking immutable baselines;
      // ingestion above uses the ordinary final-capture window.
      f.store.db
        .prepare("UPDATE attempts SET ended=? WHERE id=?")
        .run(ended, videoId);
      const exactTranscript = readFileSync(videoTranscript),
        beforeVideo = f.store.attempt(videoId),
        beforeCaptures = f.store.db
          .prepare("SELECT * FROM frames WHERE attempt=? ORDER BY id")
          .all(videoId) as any[],
        admin = f.store.session("admin", "video-teacher", null),
        adminHeaders = {
          cookie: `session=${admin.token}`,
          origin: f.origin,
          "x-csrf-token": admin.csrf,
        },
        recordings = () =>
          f.app.inject({
            url: `/api/admin/attempts/${videoId}/recordings`,
            headers: adminHeaders,
          });
      const optimize = {
        action: "request",
        requestID: randomUUID(),
      };
      for (let n = 0; n < 2; n++) {
        const accepted = await f.app.inject({
          method: "POST",
          url: `/api/admin/attempts/${videoId}/monitoring/optimization`,
          headers: adminHeaders,
          payload: optimize,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          id: videoId,
          action: "request",
          accepted: true,
        });
      }
      await vi.waitFor(
        async () => {
          const response = await recordings();
          expect(response.statusCode).toBe(200);
          expect(response.json().optimization).toMatchObject({
            status: "complete",
            frames: 6,
            converted_frames: 6,
            remaining_frames: 0,
            segments: 2,
            error: null,
          });
        },
        { timeout: 15000, interval: 100 },
      );
      const review = (await recordings()).json();
      expect(review.frames).toEqual(expect.arrayContaining(beforeCaptures));
      expect(f.store.attempt(videoId)).toEqual(beforeVideo);
      const manage = (verb: string, intent?: string) =>
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
            verb,
            videoId,
            "--request",
            randomUUID(),
            ...(intent ? ["--intent", intent] : []),
          ],
          { timeout: 30000 },
        );
      f.agentConfig.managementOperations = [
        "monitoring.export",
        "monitoring.show",
      ];
      const deniedIntent = randomUUID();
      await expect(
        manage("optimize-cancel", deniedIntent),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("not authorized"),
      });
      expect(
        f.store.db
          .prepare("SELECT 1 FROM monitoring_video_requests WHERE id=?")
          .get(deniedIntent),
      ).toBeUndefined();
      expect((await recordings()).json().optimization.status).toBe("complete");
      f.agentConfig.managementOperations.push("monitoring.optimize");
      const segments = f.store.db
        .prepare(
          "SELECT id,sha256 FROM monitoring_video_segments WHERE attempt=? ORDER BY id",
        )
        .all(videoId) as { id: string; sha256: string }[];
      for (const [verb, action] of [
        ["optimize", "request"],
        ["optimize-cancel", "cancel"],
      ]) {
        const intent = randomUUID(),
          reply = JSON.parse((await manage(verb, intent)).stdout);
        expect(reply).toMatchObject({
          confirmed: true,
          operation: "monitoring.optimize",
          result: { id: videoId, action, accepted: true },
        });
        expect(
          f.store.db
            .prepare(
              "SELECT actor,action FROM monitoring_video_requests WHERE id=?",
            )
            .get(intent),
        ).toEqual({ actor: "agent:class:root", action });
      }
      const paused = JSON.parse((await manage("show")).stdout);
      expect(paused).toMatchObject({
        confirmed: true,
        operation: "monitoring.show",
        result: {
          id: videoId,
          capabilities: ["monitoring-optimization-v1"],
          optimization: { status: "paused", converted_frames: 6, segments: 2 },
        },
      });
      expect(
        f.store.db
          .prepare(
            "SELECT id,sha256 FROM monitoring_video_segments WHERE attempt=? ORDER BY id",
          )
          .all(videoId),
      ).toEqual(segments);
      for (const segment of segments)
        expect(
          hash(
            readFileSync(`${f.dir}/monitoring/${videoId}/${segment.id}.webm`),
          ),
        ).toBe(segment.sha256);
      const retryIntent = randomUUID(),
        retried = JSON.parse(
          (await manage("optimize-retry", retryIntent)).stdout,
        );
      expect(retried).toMatchObject({
        confirmed: true,
        operation: "monitoring.optimize",
        result: { id: videoId, action: "retry", accepted: true },
      });
      await vi.waitFor(
        async () => {
          expect((await recordings()).json().optimization.status).toBe(
            "complete",
          );
        },
        { timeout: 10000, interval: 100 },
      );
      expect(JSON.parse((await manage("show")).stdout)).toMatchObject({
        confirmed: true,
        operation: "monitoring.show",
        result: {
          id: videoId,
          optimization: {
            status: "complete",
            converted_frames: 6,
            segments: 2,
          },
        },
      });
      expect(f.store.attempt(videoId)).toEqual(beforeVideo);
      expect(
        f.store.db
          .prepare("SELECT * FROM frames WHERE attempt=? ORDER BY id")
          .all(videoId),
      ).toEqual(beforeCaptures);
      const images = new Map<string, Buffer>();
      for (const capture of beforeCaptures) {
        const full = await f.app.inject({
          url: `/api/admin/media/${capture.id}`,
          headers: adminHeaders,
        });
        expect(full.statusCode).toBe(200);
        expect(full.headers["content-type"]).toContain("image/jpeg");
        expect(full.headers["cache-control"]).toContain("no-store");
        expect(await sharp(full.rawPayload).metadata()).toMatchObject({
          width: capture.width,
          height: capture.height,
          format: "jpeg",
        });
        images.set(capture.id, full.rawPayload);
        const thumb = await f.app.inject({
          url: `/api/admin/media/${capture.id}?thumbnail=1`,
          headers: adminHeaders,
        });
        expect(thumb.statusCode).toBe(200);
        expect((await sharp(thumb.rawPayload).metadata()).format).toBe("jpeg");
        expect(
          existsSync(`${f.dir}/monitoring/${videoId}/${capture.id}.jpg`),
        ).toBe(false);
        expect(
          existsSync(`${f.dir}/monitoring/${videoId}/${capture.id}.thumb.jpg`),
        ).toBe(false);
      }
      const videoRequest = f.request(randomUUID(), { id: videoId }),
        videoResponse = await f.post(videoRequest),
        packets = videoResponse.body.trim().split("\n").map(f.unpack);
      expect(videoResponse.headers["content-type"]).toContain(
        monitoringExportContentType,
      );
      for (const [index, packet] of packets.entries())
        expect(packet).toMatchObject({
          purpose: monitoringExportPurpose,
          audience: "class",
          id: videoId,
          request: videoRequest.request,
          nonce: videoRequest.nonce,
          sequence: index + 1,
        });
      expect(packets.at(-1).event).toMatchObject({ kind: "end", files: 13 });
      const derivedEntries = packets
        .filter(
          (packet) =>
            packet.event.kind === "metadata" &&
            packet.event.section === "frames",
        )
        .map((packet) => packet.event.entry);
      expect(derivedEntries).toHaveLength(6);
      for (const entry of derivedEntries) {
        const capture = beforeCaptures.find((frame) => frame.id === entry.id)!;
        expect(entry).toMatchObject({
          id: capture.id,
          attempt: videoId,
          source: capture.source,
          seq: capture.seq,
          captured: capture.captured,
          received: capture.received,
          monotonic: capture.monotonic,
          width: capture.width,
          height: capture.height,
          cursor: expect.any(Number),
          hash: hash(images.get(entry.id)!),
          provenance: expect.objectContaining({
            capture_sha256: capture.hash,
            capture_width: capture.width,
            capture_height: capture.height,
          }),
        });
        expect(
          monitoringFrameProvenance.safeParse(entry.provenance).success,
        ).toBe(true);
        expect(entry).not.toHaveProperty("page_hash");
      }
      const videoTarget = tlsDir + "/optimized-copy",
        videoReceipt = JSON.parse(
          (await invoke(videoTarget, randomUUID(), videoId)).stdout,
        );
      expect(videoReceipt).toMatchObject({
        confirmed: true,
        id: videoId,
        files: 13,
      });
      expect(statSync(videoTarget).mode & 0o777).toBe(0o700);
      expect(existsSync(videoTarget + "/INCOMPLETE")).toBe(false);
      const exportedEntries = readFileSync(
        videoTarget + "/frames.ndjson",
        "utf8",
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(exportedEntries).toEqual(derivedEntries);
      for (const capture of beforeCaptures)
        expect(readFileSync(`${videoTarget}/frames/${capture.id}.jpg`)).toEqual(
          images.get(capture.id),
        );
      expect(
        readFileSync(`${videoTarget}/terminals/${videoPane}.ndjson`),
      ).toEqual(exactTranscript);
      expect(f.store.attempt(videoId)).toEqual(beforeVideo);
      const deletion = await f.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${videoId}/delete-monitoring`,
        headers: adminHeaders,
        payload: {
          confirm: "synthetic-video",
          revision: review.deletionReview.revision,
          requestID: randomUUID(),
          reason: "Delete attempt recordings",
        },
      });
      expect(deletion.statusCode).toBe(200);
      await vi.waitFor(
        async () => {
          const deleted = (await recordings()).json();
          expect(deleted).toMatchObject({
            monitoringDeleted: true,
            physicalPurge: { status: "verified-absent" },
            optimization: { status: "deleted" },
            frames: [],
            terminals: [],
          });
        },
        { timeout: 10000, interval: 100 },
      );
      expect(
        (
          await f.app.inject({
            url: `/api/admin/media/${captures[0].id}`,
            headers: adminHeaders,
          })
        ).statusCode,
      ).toBe(404);
      const unavailableTarget = tlsDir + "/deleted-video-copy";
      await expect(
        invoke(unavailableTarget, randomUUID(), videoId),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
      });
      expect(existsSync(unavailableTarget)).toBe(false);
      expect(f.store.attempt(videoId)).toEqual(beforeVideo);
      expect(readFileSync(protectedPath, "utf8")).toBe(
        "PROTECTED-SYNTHETIC-SUBMISSION",
      );
      expect(
        readFileSync(`${videoTarget}/terminals/${videoPane}.ndjson`),
      ).toEqual(exactTranscript);
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
