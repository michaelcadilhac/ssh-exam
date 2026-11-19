// Manual qualification only. Fixed metadata; never headers, pixels, SSH bodies,
// passwords, tokens or exception text. A failed/full sink cannot change work.
import {
  constants,
  openSync,
  readSync,
  fstatSync,
  lstatSync,
  writeSync,
  closeSync,
} from "node:fs";
import type { FastifyInstance } from "fastify";
import { CaptureVideoUnavailable } from "../../apps/server/src/capture-video-ingress.js";
import { MonitoringChallengeError } from "../../apps/server/src/monitoring-readiness.js";
import { nativeSetupTimings } from "./native-setup-timing.js";

export function gatewayProfile(data: string) {
  const path = data + "/qualification-profile.jsonl";
  const stageSupport =
    new CaptureVideoUnavailable(undefined, "prediction-chain").stage ===
    "prediction-chain";
  let fd: number | undefined,
    records = 0,
    bytes = 0,
    failed = false,
    truncated = false,
    closed = false;
  try {
    const dir = lstatSync(data);
    if (
      !dir.isDirectory() ||
      dir.uid !== process.getuid!() ||
      (dir.mode & 0o777) !== 0o700
    )
      throw Error("Private profile directory required");
    fd = openSync(
      path,
      constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    const file = fstatSync(fd);
    if (
      !file.isFile() ||
      file.nlink !== 1 ||
      file.uid !== process.getuid!() ||
      (file.mode & 0o777) !== 0o600
    )
      throw Error("Private profile file required");
    bytes = file.size;
    if (bytes) {
      const last = Buffer.alloc(1);
      if (readSync(fd, last, 0, 1, bytes - 1) !== 1 || last[0] !== 10)
        throw Error("Incomplete prior profile record");
    }
    truncated = bytes >= 8 * 1024 * 1024;
  } catch {
    failed = true;
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
    fd = undefined;
  }
  const record = (row: object) => {
    if (closed || failed || truncated || fd === undefined) return;
    try {
      const line = Buffer.from(
        JSON.stringify({ pid: process.pid, ...row }) + "\n",
      );
      if (records >= 65_536 || bytes + line.length > 8 * 1024 * 1024) {
        truncated = true;
        return;
      }
      let offset = 0;
      while (offset < line.length) {
        const n = writeSync(fd, line, offset, line.length - offset);
        if (n <= 0) throw Error("Profile short write");
        offset += n;
      }
      records++;
      bytes += line.length;
    } catch {
      failed = true;
    }
  };
  const onConnection = nativeSetupTimings((row) =>
    record({ type: "setup", ...row }),
  );
  return {
    onConnection,
    snapshot: () => ({
      version: 1,
      stageSupport,
      path,
      records,
      bytes,
      failed,
      truncated,
      closed,
    }),
    attach(app: FastifyInstance) {
      const refusals = new WeakMap<object, string>();
      const route =
        /^\/api\/student\/attempts\/([0-9a-f-]{36})\/frames\/binary(?:\?|$)/;
      app.addHook("onError", (req, _reply, error, done) => {
        if (route.test(req.url))
          refusals.set(
            req,
            error instanceof CaptureVideoUnavailable
              ? error.stage
              : error instanceof MonitoringChallengeError
                ? "challenge"
                : error.message ===
                    "Image worker capacity exceeded; retry within bounded grace"
                  ? "image-capacity"
                  : "other",
          );
        done();
      });
      app.addHook("onResponse", (req, reply, done) => {
        const match = route.exec(req.url);
        if (match)
          record({
            type: "capture",
            at: Date.now(),
            attempt: match[1],
            status: reply.statusCode,
            stage:
              refusals.get(req) ??
              (reply.statusCode < 400 ? "accepted" : "other"),
            elapsed_ms: Math.round(reply.elapsedTime),
          });
        done();
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          failed = true;
        }
      }
    },
  };
}
