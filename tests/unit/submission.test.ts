import { expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { Store, hash } from "../../apps/server/src/db.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
function setup(deadline = Date.now() + 5400000) {
  const dir = mkdtempSync(tmpdir() + "/submission-");
  let store = new Store(dir);
  store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
  const start = deadline - 5400000;
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,work_path) VALUES('a','e','alice',1001,'ACTIVE','{}',?,?,'/exam')",
    )
    .run(start, deadline);
  const archive = Buffer.from("protected saved-file archive");
  let finalizations = 0,
    transfers = 0,
    failTransfer = 0,
    failCollection = false,
    badManifest = false;
  const remote: any = {
    id: "a",
    exam: "e",
    username: "alice",
    uid: 1001,
    start,
    deadline,
    state: "ACTIVE",
    work_path: "/exam",
  };
  let manifest: any;
  let blocker: Promise<void> | undefined;
  const agent = {
    call: async (op: string, body: any) => {
      if (op === "finalize-attempt") {
        finalizations++;
        if (blocker) await blocker;
        if (failCollection) {
          remote.state = "COLLECTION_FAILED";
          throw Error("writer freeze failed");
        }
        if (!remote.protected) {
          remote.state = "COMPLETED";
          remote.reason = Date.now() >= deadline ? "expiration" : body.reason;
          remote.ended = remote.reason === "expiration" ? deadline : Date.now();
          remote.completed_at = Date.now();
          remote.collected_at = Date.now();
          remote.secured_at = Date.now();
          remote.protected = true;
          remote.checksum = hash(archive);
          manifest = {
            attempt: { ...remote },
            files: [{ path: "answer.txt", size: 5, sha256: hash("saved") }],
            omissions: [],
            collected: remote.collected_at,
            secured: remote.secured_at,
            checksum: remote.checksum,
          };
        }
        return { ...remote };
      }
      if (op === "submission-manifest")
        return badManifest
          ? { ...manifest, attempt: { ...remote, username: "other" } }
          : manifest;
      if (op === "submission-status" || op === "inspect-attempt")
        return { ...remote };
      throw Error("Unexpected operation: " + op);
    },
    archive: async () => {
      transfers++;
      if (failTransfer-- > 0) return Buffer.from("corrupt transfer");
      return archive;
    },
  };
  let life = new Lifecycle(store, agent as any, new Monitoring(store));
  return {
    dir,
    archive,
    remote,
    agent,
    store: () => store,
    life: () => life,
    counts: () => ({ finalizations, transfers }),
    transferFailure: () => (failTransfer = 1),
    collectionFailure: (value: boolean) => (failCollection = value),
    invalidManifest: () => (badManifest = true),
    block: (promise: Promise<void>) => (blocker = promise),
    restart: () => {
      store.close();
      store = new Store(dir);
      life = new Lifecycle(store, agent as any, new Monitoring(store));
    },
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("automatically collects an expired attempt with no browser contact and records the authoritative receipt", async () => {
  const t = setup(Date.now() - 1000);
  try {
    await t.life().tick();
    const a = t.store().attempt("a");
    expect(a).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      reason: "expiration",
      ended: a.deadline,
      export_status: "ready",
      checksum: hash(t.archive),
    });
    expect(a.completed_at!).toBeGreaterThan(a.deadline!);
    expect(a.collected_at).toBeTruthy();
    expect(a.secured_at).toBeTruthy();
    expect(
      JSON.parse(readFileSync(`${t.dir}/submissions/a.manifest.json`, "utf8"))
        .files,
    ).toHaveLength(1);
  } finally {
    t.close();
  }
});
it("early finish revokes terminal access before waiting for collection and preserves the original deadline", async () => {
  const t = setup();
  let release!: () => void;
  t.block(new Promise<void>((resolve) => (release = resolve)));
  let ended = false;
  t.life().onEnd = () => (ended = true);
  try {
    const deadline = t.store().attempt("a").deadline;
    const finish = t.life().finish("a", "student finish");
    expect(ended).toBe(true);
    expect(t.store().attempt("a").state).toBe("FINALIZING");
    release();
    await finish;
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      reason: "student finish",
      deadline,
      protected: 1,
    });
  } finally {
    t.close();
  }
});
it("concurrent finish and deadline triggers share one finalization", async () => {
  const t = setup(Date.now() - 1000);
  let release!: () => void;
  t.block(new Promise<void>((resolve) => (release = resolve)));
  try {
    const finish = t.life().finish("a", "student finish");
    const expiration = t.life().tick();
    release();
    await Promise.all([finish, expiration]);
    expect(t.counts()).toEqual({ finalizations: 1, transfers: 1 });
    expect(t.store().attempt("a").reason).toBe("expiration");
  } finally {
    t.close();
  }
});
it("failed verified transfer retries from the protected copy after gateway restart without recollection", async () => {
  const t = setup();
  t.transferFailure();
  try {
    await t.life().finish("a", "student finish");
    const receipt = t.store().attempt("a");
    expect(receipt).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      export_status: "pending",
    });
    expect(existsSync(`${t.dir}/submissions/a.tar.gz`)).toBe(false);
    expect(
      t
        .store()
        .db.prepare(
          "SELECT * FROM outbox WHERE subject='Submission export pending'",
        )
        .get(),
    ).toBeTruthy();
    t.restart();
    await t.life().tick();
    expect(t.counts()).toEqual({ finalizations: 1, transfers: 2 });
    expect(readFileSync(`${t.dir}/submissions/a.tar.gz`)).toEqual(t.archive);
    expect(t.store().attempt("a").reason).toBe("student finish");
  } finally {
    t.close();
  }
});
it("collection failure alerts the instructor and remains recoverable after restart", async () => {
  const t = setup();
  t.collectionFailure(true);
  try {
    await t.life().finish("a", "student finish");
    expect(t.store().attempt("a")).toMatchObject({
      state: "COLLECTION_FAILED",
      protected: 0,
    });
    expect(
      t
        .store()
        .db.prepare(
          "SELECT * FROM outbox WHERE subject='Collection requires recovery'",
        )
        .get(),
    ).toBeTruthy();
    t.collectionFailure(false);
    t.restart();
    await t.life().tick();
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      export_status: "ready",
    });
  } finally {
    t.close();
  }
});
it("refuses a protected manifest with mismatched student identity", async () => {
  const t = setup();
  t.invalidManifest();
  try {
    await t.life().finish("a", "student finish");
    expect(t.store().attempt("a")).toMatchObject({
      state: "COLLECTION_FAILED",
      protected: 0,
    });
    expect(t.counts().transfers).toBe(0);
  } finally {
    t.close();
  }
});
it("a finalized local artifact is never replaced and monitoring expiry does not delete it", async () => {
  const t = setup();
  try {
    await t.life().finish("a", "student finish");
    const file = `${t.dir}/submissions/a.tar.gz`;
    await t.life().finish("a", "expiration");
    expect(t.counts()).toEqual({ finalizations: 1, transfers: 1 });
    t.store()
      .db.prepare("UPDATE attempts SET ended=? WHERE id='a'")
      .run(Date.now() - 61 * 86400000);
    new Monitoring(t.store()).cleanup();
    expect(readFileSync(file)).toEqual(t.archive);
  } finally {
    t.close();
  }
});
it("does not overwrite a conflicting artifact left by an interrupted transfer", async () => {
  const t = setup();
  try {
    writeFileSync(`${t.dir}/submissions/a.tar.gz`, "existing artifact", {
      mode: 0o600,
    });
    await t.life().finish("a", "student finish");
    expect(t.store().attempt("a").export_status).toBe("pending");
    expect(readFileSync(`${t.dir}/submissions/a.tar.gz`, "utf8")).toBe(
      "existing artifact",
    );
  } finally {
    t.close();
  }
});
it("delays SSH teardown until the protected manifest is verified, preventing pre-collection hangup saves", async () => {
  const t = setup();
  const stages: string[] = [];
  t.life().onEnd = () => stages.push("input revoked");
  t.life().onSecured = () => {
    expect(t.store().attempt("a").protected).toBe(1);
    stages.push("SSH closed after protection");
  };
  try {
    await t.life().finish("a", "student finish");
    expect(stages).toEqual(["input revoked", "SSH closed after protection"]);
  } finally {
    t.close();
  }
});
it("migrates existing metadata without resetting authoritative deadlines", () => {
  const t = setup();
  try {
    const original = t.store().attempt("a").deadline;
    // Model a version-1 backup so Store must apply the new migration on restart.
    t.store().db.exec(
      "ALTER TABLE attempts DROP COLUMN protected; ALTER TABLE attempts DROP COLUMN completed_at; ALTER TABLE attempts DROP COLUMN collected_at; ALTER TABLE attempts DROP COLUMN secured_at; DELETE FROM schema_version WHERE version=2;",
    );
    t.restart();
    expect(t.store().attempt("a")).toMatchObject({
      deadline: original,
      protected: 0,
      completed_at: null,
      collected_at: null,
      secured_at: null,
    });
    t.restart();
    expect(t.store().attempt("a").deadline).toBe(original);
  } finally {
    t.close();
  }
});

it("successful early collection keeps account access held through gateway restart", async () => {
  const t = setup();
  try {
    t.remote.access_state = "HELD";
    t.remote.access_held_at = t.remote.start;
    const deadline = t.remote.deadline;
    await t.life().finish("a", "student finish");
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      access_state: "HELD",
      deadline,
    });
    t.restart();
    await t.life().tick();
    expect(t.store().attempt("a")).toMatchObject({
      access_state: "HELD",
      deadline,
    });
    expect(t.counts()).toEqual({ finalizations: 1, transfers: 1 });
  } finally {
    t.close();
  }
});
it("gateway never infers ordinary access release from deadline or secured collection", async () => {
  const t = setup(Date.now() - 1000);
  try {
    t.remote.access_state = "HELD";
    await t.life().tick();
    expect(t.store().attempt("a").access_state).toBe("HELD");
    t.remote.access_state = "RELEASED";
    t.remote.access_released_at = Date.now();
    t.restart();
    await t.life().tick();
    expect(t.store().attempt("a").access_state).toBe("RELEASED");
    expect(t.counts().finalizations).toBe(1);
  } finally {
    t.close();
  }
});
it("access-release verification failures are surfaced without repeated alerts", async () => {
  const t = setup(Date.now() - 1000);
  try {
    t.remote.access_state = "HELD";
    await t.life().finish("a", "student finish");
    t.remote.access_error = "protected archive checksum mismatch";
    await t.life().reconcile("a");
    await t.life().reconcile("a");
    expect(t.store().attempt("a")).toMatchObject({
      access_state: "HELD",
      access_error: t.remote.access_error,
    });
    expect(
      (
        t
          .store()
          .db.prepare(
            "SELECT count(*) AS n FROM outbox WHERE subject='Account access release requires recovery'",
          )
          .get() as any
      ).n,
    ).toBe(1);
  } finally {
    t.close();
  }
});
