// Internal worker executable. No SQL, agent keys, network or protected archives.
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { opendir, unlink, rmdir } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

try {
  writeFileSync("/proc/self/oom_score_adj", "500");
} catch {
  /* Platform hardening best effort, never an RSS isolation claim. */
}
const stop = (code = 1): never => process.exit(code);
const timer = setTimeout(() => stop(), 9000);
process.stdin.on("end", () => stop());
process.stdin.on("error", () => stop());
let input = Buffer.alloc(0),
  started = false;
process.stdin.on("data", (chunk: Buffer) => {
  if (started || input.length + chunk.length > 4096) return stop();
  input = Buffer.concat([input, chunk]);
  const newline = input.indexOf(10);
  if (newline === -1) return;
  if (newline !== input.length - 1) return stop();
  started = true;
  let request: any;
  try {
    request = JSON.parse(input.toString("utf8"));
    if (
      request.version !== 1 ||
      typeof request.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id) ||
      typeof request.nonce !== "string" ||
      !/^[a-f0-9]{64}$/.test(request.nonce) ||
      typeof request.root !== "string" ||
      !isAbsolute(request.root) ||
      basename(request.root) !== "monitoring" ||
      Object.keys(request).sort().join(",") !== "id,nonce,root,version"
    )
      return stop();
  } catch {
    return stop();
  }
  input = Buffer.alloc(0);
  void purge(request.root, request.id).then(
    (removed) => reply(request, { status: "removed", removed }),
    (error) => {
      const known = ["unsafe-root", "unsafe-target", "unexpected-directory"];
      const code = known.includes(error?.message)
        ? error.message
        : ["EACCES", "EPERM"].includes(error?.code)
          ? "permission"
          : "storage";
      reply(request, { status: "refused", code });
    },
  );
});
function reply(request: any, result: object) {
  clearTimeout(timer);
  process.stdout.write(
    JSON.stringify({
      version: 1,
      id: request.id,
      nonce: request.nonce,
      ...result,
    }) + "\n",
    () => stop(0),
  );
}
function privateDirectory(fd: number) {
  const info = fstatSync(fd);
  return (
    info.isDirectory() &&
    info.uid === process.geteuid?.() &&
    (info.mode & 0o077) === 0
  );
}
async function purge(root: string, id: string) {
  if (process.platform !== "linux") throw Error("unsafe-root");
  const flags =
    constants.O_RDONLY |
    constants.O_DIRECTORY |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK;
  let parent = -1,
    target = -1;
  try {
    try {
      parent = openSync(root, flags);
    } catch {
      throw Error("unsafe-root");
    }
    if (!privateDirectory(parent)) throw Error("unsafe-root");
    const path = `/proc/self/fd/${parent}/${id}`;
    try {
      target = openSync(path, flags);
    } catch (error) {
      if ((error as any).code === "ENOENT") return 0;
      throw Error("unsafe-target");
    }
    if (!privateDirectory(target)) throw Error("unsafe-target");
    const identity = fstatSync(target),
      pinned = `/proc/self/fd/${target}`;
    // Pin actual directory descriptors. The only permitted nested directory is
    // one generated video work area; arbitrary recursion remains forbidden.
    const dir = await opendir(pinned, { bufferSize: 32 });
    let removed = 0;
    for await (const entry of dir) {
      if (entry.isDirectory()) {
        if (!/^\.video-work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.name))
          throw Error("unexpected-directory");
        removed += await purgeVideoWork(target,entry.name);
        continue;
      }
      await unlink(`${pinned}/${entry.name}`); // Unlink symlinks/FIFOs; never open/follow them.
      removed++;
    }
    const current = lstatSync(path);
    if (
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      throw Error("unsafe-target");
    await rmdir(path);
    return removed;
  } finally {
    if (target !== -1) closeSync(target);
    if (parent !== -1) closeSync(parent);
  }
}

async function purgeVideoWork(parent: number, name: string) {
  const path = `/proc/self/fd/${parent}/${name}`;
  let fd = -1;
  try {
    try { fd = openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK); }
    catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT")return 0;throw Error("unsafe-target"); }
    if (!privateDirectory(fd)) throw Error("unsafe-target");
    const identity=fstatSync(fd),pinned=`/proc/self/fd/${fd}`;
    let removed=0;
    for await(const entry of await opendir(pinned,{bufferSize:16})) {
      if(entry.isDirectory())throw Error("unexpected-directory");
      try {await unlink(`${pinned}/${entry.name}`);removed++;}
      catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    let current;
    try {current=lstatSync(path);}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return removed;throw error;}
    if(!current.isDirectory()||current.dev!==identity.dev||current.ino!==identity.ino)throw Error("unsafe-target");
    try {await rmdir(path);} catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    return removed;
  } finally {if(fd!==-1)closeSync(fd);}
}
