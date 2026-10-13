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
  store.db.exec("INSERT INTO exams VALUES('e','{}')");
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,work_path,access_state) VALUES('a','e','alice',1001,'ACTIVE','{}',?,?,'/exam','HELD')",
    )
    .run(deadline - 5400000, deadline);
  const archive = Buffer.from("protected saved-file archive");
  const remote: any = {
    id: "a",
    exam: "e",
    username: "alice",
    uid: 1001,
    start: deadline - 5400000,
    deadline,
    state: "ACTIVE",
    work_path: "/exam",
    access_state: "HELD",
  };
  let calls = 0,
    block: Promise<void> | undefined,
    fail = false,
    connected = true;
  let frozenManifest: any;
  const manifest = () =>
    (frozenManifest ||= {
      attempt: { ...remote },
      files: [{ path: "answer.txt", size: 5, sha256: hash("saved") }],
      omissions: [],
      collected: remote.collected_at,
      secured: remote.secured_at,
      checksum: remote.checksum,
    });
  const collect = () =>
    Object.assign(remote, {
      state: "COMPLETED",
      protected: true,
      checksum: hash(archive),
      reason: Date.now() >= deadline ? "expiration" : "student finish",
      ended: Date.now() >= deadline ? deadline : Date.now(),
      completed_at: Date.now(),
      collected_at: Date.now(),
      secured_at: Date.now(),
    });
  const agent = {
    connected: () => connected,
    call: async (op: string) => {
      if (op === "finalize-attempt") {
        calls++;
        if (block) await block;
        if (fail) throw Error("Lost response");
        collect();
        return { ...remote };
      }
      if (op === "submission-manifest") return manifest();
      if (op === "inspect-attempt") return { ...remote };
      throw Error("Unexpected command");
    },
  };
  let life = new Lifecycle(store, agent as any, new Monitoring(store));
  return {
    dir,
    archive,
    remote,
    manifest,
    collect,
    life: () => life,
    store: () => store,
    calls: () => calls,
    disconnect: () => (connected = false),
    block: (p: Promise<void>) => (block = p),
    fail: () => (fail = true),
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
it("deadline UI waits for local collection callbacks without issuing disconnected commands", async () => {
  const t = setup(Date.now() - 1000);
  try {
    t.disconnect();
    await t.life().tick();
    expect(t.calls()).toBe(0);
    expect(t.store().attempt("a")).toMatchObject({
      state: "FINALIZING",
      protected: 0,
      access_state: "HELD",
    });
    t.collect();
    t.life().acceptRemote(t.remote, t.manifest());
    t.life().receiveArchive("a", t.remote.checksum, t.archive);
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      reason: "expiration",
      export_status: "ready",
      access_state: "HELD",
    });
  } finally {
    t.close();
  }
});
it("early finish blocks input immediately and preserves the original deadline and hold", async () => {
  const t = setup();
  let release!: () => void;
  t.block(new Promise<void>((r) => (release = r)));
  const stages: string[] = [];
  t.life().onEnd = () => stages.push("input blocked");
  t.life().onSecured = () => {
    expect(t.store().attempt("a").protected).toBe(1);
    stages.push("SSH closed");
  };
  try {
    const deadline = t.remote.deadline;
    const finishing = t.life().finish("a", "student finish");
    expect(t.store().attempt("a").state).toBe("FINALIZING");
    release();
    await finishing;
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      deadline,
      protected: 1,
      access_state: "HELD",
      export_status: "pending",
    });
    expect(stages.slice(0, 2)).toEqual(["input blocked", "SSH closed"]);
  } finally {
    t.close();
  }
});
it("concurrent finish and deadline display events issue only one connected finalization", async () => {
  const t = setup(Date.now() - 1000);
  let release!: () => void;
  t.block(new Promise<void>((r) => (release = r)));
  try {
    const p = t.life().finish("a", "student finish");
    await t.life().tick();
    release();
    await p;
    expect(t.calls()).toBe(1);
    expect(t.remote.reason).toBe("expiration");
  } finally {
    t.close();
  }
});
it("failed transfers retry by callbacks after restart without recollection", async () => {
  const t = setup();
  try {
    await t.life().finish("a", "student finish");
    expect(() =>
      t.life().receiveArchive("a", t.remote.checksum, Buffer.from("bad")),
    ).toThrow("verification");
    expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
    t.restart();
    await t.life().tick();
    expect(t.calls()).toBe(1);
    t.life().receiveArchive("a", t.remote.checksum, t.archive);
    expect(readFileSync(t.dir + "/submissions/a.tar.gz")).toEqual(t.archive);
  } finally {
    t.close();
  }
});
it("lost SSH acknowledgment stays pending; an authenticated failure alerts and later recovery secures it", async () => {
  const t = setup();
  try {
    t.fail();
    await t.life().finish("a", "student finish");
    expect(t.store().attempt("a").state).toBe("FINALIZING");
    t.remote.state = "COLLECTION_FAILED";
    t.remote.errors = ["writer freeze failed"];
    t.life().acceptRemote(t.remote);
    expect(t.store().attempt("a").state).toBe("COLLECTION_FAILED");
    expect(
      t
        .store()
        .db.prepare(
          "SELECT 1 FROM outbox WHERE subject='Collection requires recovery'",
        )
        .get(),
    ).toBeTruthy();
    t.restart();
    t.collect();
    t.life().acceptRemote(t.remote, t.manifest());
    expect(t.store().attempt("a").protected).toBe(1);
  } finally {
    t.close();
  }
});
it("rejects mismatched identities, intervals and conflicting secured artifacts", async () => {
  const t = setup();
  try {
    t.collect();
    expect(() =>
      t.life().acceptRemote(t.remote, {
        ...t.manifest(),
        attempt: { ...t.remote, username: "other" },
      }),
    ).toThrow("manifest");
    expect(() =>
      t
        .life()
        .acceptRemote(
          { ...t.remote, deadline: t.remote.deadline + 1 },
          t.manifest(),
        ),
    ).toThrow("interval");
    t.life().acceptRemote(t.remote, t.manifest());
    writeFileSync(t.dir + "/submissions/a.tar.gz", "existing");
    expect(() =>
      t.life().receiveArchive("a", t.remote.checksum, t.archive),
    ).toThrow();
    expect(readFileSync(t.dir + "/submissions/a.tar.gz", "utf8")).toBe(
      "existing",
    );
  } finally {
    t.close();
  }
});
it("duplicate receipts never replace a submission and monitoring cleanup leaves archives", async () => {
  const t = setup();
  try {
    t.collect();
    t.life().acceptRemote(t.remote, t.manifest());
    t.life().receiveArchive("a", t.remote.checksum, t.archive);
    t.life().acceptRemote(t.remote, t.manifest());
    t.life().receiveArchive("a", t.remote.checksum, t.archive);
    t.store()
      .db.prepare("UPDATE attempts SET ended=? WHERE id='a'")
      .run(Date.now() - 61 * 86400000);
    new Monitoring(t.store()).cleanup();
    expect(readFileSync(t.dir + "/submissions/a.tar.gz")).toEqual(t.archive);
  } finally {
    t.close();
  }
});
it("finished and disconnected attempts cannot finish or reopen; release is only learned from the agent", async () => {
  const t = setup();
  try {
    t.disconnect();
    await expect(t.life().finish("a", "student finish")).rejects.toThrow(
      "active SSH",
    );
    t.collect();
    t.life().acceptRemote(t.remote, t.manifest());
    t.restart();
    await t.life().tick();
    expect(t.store().attempt("a").access_state).toBe("HELD");
    await expect(
      t.life().finish("a", "student finish"),
    ).resolves.toBeUndefined();
    t.remote.access_state = "RELEASED";
    t.remote.access_released_at = Date.now();
    t.life().acceptRemote(t.remote, t.manifest());
    expect(t.store().attempt("a").access_state).toBe("RELEASED");
  } finally {
    t.close();
  }
});
