// Isolated codec executable: private monitoring inputs only, no SQL/network/keys.
// Originals are never deleted. The coordinator publishes verified results and
// commits mappings before deciding whether an original may be removed.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  writeFileSync,
  readdirSync,
  fsyncSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  videoWorkerRequest,
  videoResult,
  type VideoResult,
} from "./monitoring-video-schema.js";

sharp.concurrency(1);
sharp.cache(false);
process.umask(0o077);
try {
  writeFileSync("/proc/self/oom_score_adj", "500");
} catch {
  /* no hard RSS-isolation claim */
}
const children = new Set<ChildProcessWithoutNullStreams>();
function abort(): never {
  for (const child of children) child.kill("SIGKILL");
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {}
  return process.exit(1);
}
const timer = setTimeout(abort, 55000);
process.stdin.on("end", abort);
process.stdin.on("error", abort);
let bytes = Buffer.alloc(0),
  started = false;
process.stdin.on("data", (chunk: Buffer) => {
  if (started || bytes.length + chunk.length > 16384) return abort();
  bytes = Buffer.concat([bytes, chunk]);
  const newline = bytes.indexOf(10);
  if (newline < 0) return;
  if (newline !== bytes.length - 1) return abort();
  started = true;
  const parsed = videoWorkerRequest.safeParse(
    (() => {
      try {
        return JSON.parse(bytes.toString("utf8"));
      } catch {
        return null;
      }
    })(),
  );
  bytes = Buffer.alloc(0);
  if (!parsed.success) return abort();
  const request = parsed.data;
  void work(request).then(
    (result) => reply(request.nonce, { status: "complete", result }),
    (error) => {
      const allowed = new Set([
        "unsafe-root",
        "unsafe-target",
        "source-digest",
        "source-changed",
        "sync-changed",
        "dimensions",
        "codec",
        "validation",
        "digest",
        "protocol",
      ]);
      reply(request.nonce, {
        status: "refused",
        code: allowed.has(error?.message) ? error.message : "storage",
      });
    },
  );
});
function reply(nonce: string, result: object) {
  clearTimeout(timer);
  const output = JSON.stringify({ version: 1, nonce, ...result }) + "\n";
  process.stdout.write(
    Buffer.byteLength(output) <= 16 * 1024 * 1024
      ? output
      : JSON.stringify({
          version: 1,
          nonce,
          status: "refused",
          code: "validation",
        }) + "\n",
    () => process.exit(0),
  );
}
function refuse(code: string): never {
  throw Error(code);
}
const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
function privateDirectory(path: string) {
  const fd = openSync(path, flags | constants.O_DIRECTORY),
    info = fstatSync(fd);
  if (
    !info.isDirectory() ||
    info.uid !== process.geteuid?.() ||
    (info.mode & 0o077) !== 0
  ) {
    closeSync(fd);
    refuse("unsafe-target");
  }
  return fd;
}
function privateFile(path: string, limit: number) {
  const fd = openSync(path, flags),
    info = fstatSync(fd);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.geteuid?.() ||
    (info.mode & 0o077) !== 0 ||
    info.size < 1 ||
    info.size > limit
  ) {
    closeSync(fd);
    refuse("unsafe-target");
  }
  return fd;
}
function hashFile(fd: number, limit: number) {
  const before = fstatSync(fd);
  if (before.size > limit) refuse("validation");
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(128 * 1024);
  let count = 0;
  while (true) {
    const n = readSync(fd, buffer, 0, buffer.length, count);
    if (!n) break;
    count += n;
    if (count > limit) refuse("validation");
    hash.update(buffer.subarray(0, n));
  }
  const after = fstatSync(fd);
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    after.nlink !== 1
  )
    refuse("source-changed");
  return { sha256: hash.digest("hex"), bytes: count };
}
async function tool(
  executable: "ffmpeg" | "ffprobe",
  args: string[],
  fd: number,
  limit: number,
  onData?: (chunk: Buffer) => void,
): Promise<Buffer> {
  const child = spawn(
    "/usr/bin/prlimit",
    [
      "--as=1073741824",
      "--cpu=25",
      "--fsize=33554432",
      "--nofile=64",
      "--",
      "/usr/bin/" + executable,
      ...args,
    ],
    {
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
      },
      // Descriptor4 retains the coordinator's flock through actual codec exit.
      stdio: ["pipe", "pipe", "pipe", fd, 3],
    },
  ) as ChildProcessWithoutNullStreams;
  children.add(child);
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.stdin.end();
  return await new Promise<Buffer>((resolveResult, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      failed = false;
    const failure = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(failure, 25000);
    child.once("error", failure);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return failure();
      try {
        if (onData) onData(chunk);
        else chunks.push(chunk);
      } catch {
        failure();
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      children.delete(child);
      if (failed || code !== 0 || signal) return reject(Error("codec"));
      resolveResult(Buffer.concat(chunks));
    });
  });
}
const ffmpeg = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-nostdin",
  "-threads",
  "1",
  "-filter_threads",
  "1",
  "-max_alloc",
  "134217728",
  "-protocol_whitelist",
  "file,pipe",
];
async function probe(
  fd: number,
  width: number,
  height: number,
  count?: number,
) {
  let value: any;
  try {
    value = JSON.parse(
      (
        await tool(
          "ffprobe",
          [
            "-v",
            "error",
            "-threads",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-count_frames",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,nb_read_frames:format=duration",
            "-of",
            "json",
            "/proc/self/fd/3",
          ],
          fd,
          32768,
        )
      ).toString("utf8"),
    );
  } catch {
    refuse("validation");
  }
  if (!Array.isArray(value.streams) || value.streams.length !== 1)
    refuse("validation");
  const stream = value.streams[0],
    actualCount = Number(stream.nb_read_frames),
    duration = Number(value.format?.duration) * 1000;
  if (
    stream.codec_type !== "video" ||
    stream.codec_name !== "vp9" ||
    stream.width !== width ||
    stream.height !== height ||
    !Number.isInteger(actualCount) ||
    actualCount < 1 ||
    actualCount > 12 ||
    (count !== undefined && actualCount !== count) ||
    !Number.isFinite(duration) ||
    Math.abs(duration - actualCount * 5000) > 1
  )
    refuse("validation");
  return actualCount;
}
async function decodedHashes(
  fd: number,
  width: number,
  height: number,
  count: number,
) {
  const perFrame = width * height * 3,
    hashes: string[] = [];
  let position = 0,
    hash = createHash("sha256");
  await tool(
    "ffmpeg",
    [
      ...ffmpeg,
      "-i",
      "/proc/self/fd/3",
      "-an",
      "-sn",
      "-dn",
      "-fps_mode",
      "passthrough",
      "-threads",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    fd,
    perFrame * count,
    (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        const n = Math.min(chunk.length - offset, perFrame - position);
        hash.update(chunk.subarray(offset, offset + n));
        offset += n;
        position += n;
        if (position === perFrame) {
          hashes.push(hash.digest("hex"));
          position = 0;
          hash = createHash("sha256");
        }
      }
    },
  );
  if (position !== 0 || hashes.length !== count) refuse("validation");
  return hashes;
}
// Only this child PID opens/closes these SQLite files. The main connection keeps
// its NORMAL WAL policy and POSIX locks. No SQL or database contents are read.
function syncDatabase(root: string) {
  const dataPath = dirname(root),
    handles: number[] = [];
  const current = (fd: number, path: string, directory: boolean) => {
    try {
      const pinned = fstatSync(fd),
        named = lstatSync(path);
      if (
        (directory
          ? !pinned.isDirectory() ||
            !named.isDirectory() ||
            (pinned.mode & 0o077) !== 0 ||
            (named.mode & 0o077) !== 0
          : !pinned.isFile() ||
            !named.isFile() ||
            pinned.nlink !== 1 ||
            named.nlink !== 1) ||
        pinned.uid !== process.geteuid?.() ||
        named.uid !== pinned.uid ||
        named.dev !== pinned.dev ||
        named.ino !== pinned.ino
      )
        refuse("sync-changed");
    } catch {
      refuse("sync-changed");
    }
  };
  const regular = (path: string) => {
    const fd = openSync(path, flags);
    handles.push(fd);
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.geteuid?.())
      refuse("unsafe-target");
    return fd;
  };
  try {
    const data = privateDirectory(dataPath);
    handles.push(data);
    const monitoring = privateDirectory(
      "/proc/self/fd/" + data + "/monitoring",
    );
    handles.push(monitoring);
    const wal = regular("/proc/self/fd/" + data + "/metadata.sqlite-wal"),
      database = regular("/proc/self/fd/" + data + "/metadata.sqlite");
    const verify = () => {
      current(data, dataPath, true);
      current(monitoring, root, true);
      current(wal, "/proc/self/fd/" + data + "/metadata.sqlite-wal", false);
      current(wal, join(dataPath, "metadata.sqlite-wal"), false);
      current(database, "/proc/self/fd/" + data + "/metadata.sqlite", false);
      current(database, join(dataPath, "metadata.sqlite"), false);
    };
    verify();
    fsyncSync(wal);
    fsyncSync(database);
    fsyncSync(data);
    verify();
    return { synced: true };
  } finally {
    for (const fd of handles.reverse()) closeSync(fd);
  }
}
async function work(request: ReturnType<typeof videoWorkerRequest.parse>) {
  if (
    process.platform !== "linux" ||
    !isAbsolute(request.root) ||
    resolve(request.root) !== request.root ||
    basename(request.root) !== "monitoring"
  )
    refuse("unsafe-root");
  if (request.operation === "sync") return syncDatabase(request.root);
  const handles: number[] = [];
  try {
    const root = privateDirectory(request.root);
    handles.push(root);
    const directory = privateDirectory(
      "/proc/self/fd/" + root + "/" + request.input.attempt,
    );
    handles.push(directory);
    if (request.operation === "encode") {
      const input = request.input;
      if (
        input.work !==
        join(request.root, input.attempt, ".video-work-" + input.segment)
      )
        refuse("unsafe-target");
      const stage = privateDirectory(
        "/proc/self/fd/" + directory + "/.video-work-" + input.segment,
      );
      handles.push(stage);
      if (readdirSync("/proc/self/fd/" + stage).length) refuse("unsafe-target");
      for (let i = 0; i < input.frames.length; i++) {
        const frame = input.frames[i],
          fd = privateFile(
            "/proc/self/fd/" + directory + "/" + frame.id + ".jpg",
            1500000,
          );
        handles.push(fd);
        const info = fstatSync(fd),
          data = Buffer.alloc(info.size + 1);
        let count = 0;
        while (count < data.length) {
          const n = readSync(fd, data, count, data.length - count, count);
          if (!n) break;
          count += n;
        }
        const after = fstatSync(fd);
        if (
          count !== info.size ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          after.ctimeMs !== info.ctimeMs ||
          after.nlink !== 1
        )
          refuse("source-changed");
        const original = data.subarray(0, count);
        if (createHash("sha256").update(original).digest("hex") !== frame.hash)
          refuse("source-digest");
        const meta = await sharp(original, {
          limitInputPixels: 12000000,
        }).metadata();
        if (
          meta.format !== "jpeg" ||
          meta.width !== frame.width ||
          meta.height !== frame.height
        )
          refuse("dimensions");
        writeFileSync(
          "/proc/self/fd/" + stage + "/" + String(i).padStart(3, "0") + ".jpg",
          original,
          { mode: 0o600, flag: "wx" },
        );
        handles.pop();
        closeSync(fd);
      }
      const first = input.frames[0],
        edge = input.source === "screen" ? 1280 : 320,
        scale = Math.min(1, edge / Math.max(first.width, first.height));
      const scaledWidth = Math.max(1, Math.round(first.width * scale)),
        scaledHeight = Math.max(1, Math.round(first.height * scale)),
        width = scaledWidth + (scaledWidth % 2),
        height = scaledHeight + (scaledHeight % 2),
        file = input.segment + ".webm";
      await tool(
        "ffmpeg",
        [
          ...ffmpeg,
          "-n",
          "-framerate",
          "1/5",
          "-i",
          "/proc/self/fd/3/%03d.jpg",
          "-frames:v",
          String(input.frames.length),
          "-vf",
          "scale=" +
            scaledWidth +
            ":" +
            scaledHeight +
            ",pad=" +
            width +
            ":" +
            height +
            ":0:0:color=black",
          "-an",
          "-c:v",
          "libvpx-vp9",
          "-deadline",
          "good",
          "-cpu-used",
          "6",
          "-crf",
          "35",
          "-b:v",
          "0",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "12",
          "-threads",
          "1",
          "-f",
          "webm",
          "/proc/self/fd/3/" + file,
        ],
        stage,
        4096,
      );
      const video = privateFile(
        "/proc/self/fd/" + stage + "/" + file,
        32 * 1024 * 1024,
      );
      handles.push(video);
      const identity = hashFile(video, 32 * 1024 * 1024);
      await probe(video, width, height, input.frames.length);
      const hashes = await decodedHashes(
        video,
        width,
        height,
        input.frames.length,
      );
      if (hashFile(video, 32 * 1024 * 1024).sha256 !== identity.sha256)
        refuse("digest");
      const result: VideoResult = videoResult.parse({
        version: 1,
        attempt: input.attempt,
        segment: input.segment,
        source: input.source,
        file,
        ...identity,
        width,
        height,
        duration_ms: input.frames.length * 5000,
        frames: input.frames.map((frame, index) => ({
          id: frame.id,
          original_hash: frame.hash,
          captured: frame.captured,
          index,
          presentation_ms: index * 5000,
          decoded_sha256: hashes[index],
        })),
      });
      fsyncSync(video);
      writeFileSync(
        "/proc/self/fd/" + stage + "/manifest.json",
        JSON.stringify(result) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      const manifest = openSync(
        "/proc/self/fd/" + stage + "/manifest.json",
        flags,
      );
      try {
        fsyncSync(manifest);
      } finally {
        closeSync(manifest);
      }
      fsyncSync(stage);
      return result;
    }
    const input = request.input,
      file = privateFile(
        "/proc/self/fd/" + directory + "/" + input.segment + ".webm",
        32 * 1024 * 1024,
      );
    handles.push(file);
    if (hashFile(file, 32 * 1024 * 1024).sha256 !== input.sha256)
      refuse("digest");
    const count = await probe(file, input.width, input.height),
      perFrame = input.width * input.height * 3;
    if (input.frames.some((frame) => frame.index >= count))
      refuse("validation");
    const raw = await tool(
      "ffmpeg",
      [
        ...ffmpeg,
        "-i",
        "/proc/self/fd/3",
        "-an",
        "-sn",
        "-dn",
        "-fps_mode",
        "passthrough",
        "-threads",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      file,
      perFrame * count,
    );
    if (raw.length !== perFrame * count) refuse("validation");
    const frames = [];
    for (const frame of input.frames) {
      const pixels = raw.subarray(
        frame.index * perFrame,
        (frame.index + 1) * perFrame,
      );
      if (
        createHash("sha256").update(pixels).digest("hex") !==
        frame.decoded_sha256
      )
        refuse("digest");
      const image = sharp(pixels, {
        raw: { width: input.width, height: input.height, channels: 3 },
        limitInputPixels: 1280 * 1280,
      });
      const original = await image.clone().jpeg({ quality: 50 }).toBuffer(),
        thumbnail = await image
          .resize({
            width: 256,
            height: 256,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 55 })
          .toBuffer();
      if (original.length > 1500000 || thumbnail.length > 1500000)
        refuse("validation");
      frames.push({
        index: frame.index,
        original: original.toString("base64"),
        thumbnail: thumbnail.toString("base64"),
      });
    }
    if (hashFile(file, 32 * 1024 * 1024).sha256 !== input.sha256)
      refuse("digest");
    return { frames };
  } finally {
    for (const fd of handles.reverse()) closeSync(fd);
  }
}
