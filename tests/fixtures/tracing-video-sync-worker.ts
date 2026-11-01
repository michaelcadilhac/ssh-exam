// Test-only observation of the real barrier's actual fsync calls and PID.
import fs from "node:fs";
import { dirname, basename, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const actual = fs.fsyncSync;
const events: { file: string; pid: number }[] = [];
fs.fsyncSync = (fd: number) => {
  const path = fs.readlinkSync("/proc/self/fd/" + fd);
  actual(fd);
  const file = basename(path),
    root = fs.fstatSync(fd).isDirectory() ? path : dirname(path);
  events.push({ file, pid: process.pid });
  fs.writeFileSync(join(root, "sync-trace.json"), JSON.stringify(events), {
    mode: 0o600,
  });
  if (
    file === "metadata.sqlite-wal" &&
    fs.existsSync(join(root, "replace-db-after-sync"))
  ) {
    fs.renameSync(
      join(root, "metadata.sqlite"),
      join(root, "metadata-before-replacement"),
    );
    fs.writeFileSync(
      join(root, "metadata.sqlite"),
      "synthetic replacement database",
      { mode: 0o644 },
    );
  }
};
syncBuiltinESMExports();
await import("../../apps/server/src/monitoring-video-worker.js");
