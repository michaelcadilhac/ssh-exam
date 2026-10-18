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
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      reason: "expiration",
      export_status: "server-only",
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
      export_status: "server-only",
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
it("archive reception is disabled; receipts recover after restart without recollection", async () => {
  const t = setup();
  try {
    await t.life().finish("a", "student finish");
    expect(() =>
      t.life().receiveArchive("a", t.remote.checksum, t.archive),
    ).toThrow("transfers are disabled");
    expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
    t.restart();
    await t.life().reconcile("a");
    await t.life().tick();
    expect(t.calls()).toBe(1);
    expect(t.store().attempt("a").export_status).toBe("server-only");
    expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
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
    t.life().acceptRemote(t.remote, t.manifest());
    t.store()
      .db.prepare("UPDATE attempts SET ended=? WHERE id='a'")
      .run(Date.now() - 61 * 86400000);
    new Monitoring(t.store()).cleanup();
    expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
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
it.each(["SSH", "callback"])(
  "reconciles %s legacy manifests after restart without replacing saved artifacts",
  async (format) => {
    const t = setup();
    try {
      t.collect();
      const raw = {
        ...t.manifest(),
        attempt: {
          ...t.manifest().attempt,
          transport: "original-transport",
          resume_transport: "resume-transport",
          lease: 99,
          authorization: 88,
          units: ["exam-workload.service"],
        },
      };
      const callback = {
        ...raw,
        attempt: {
          ...raw.attempt,
          transport: "",
          resume_transport: "",
          lease: 0,
          authorization: 0,
          units: null,
        },
      };
      const file = t.dir + "/submissions/a.manifest.json";
      const legacy = format === "SSH" ? raw : callback;
      // Existing deployments have both formats, with varying JSON key order/spacing.
      writeFileSync(
        file,
        JSON.stringify(Object.fromEntries(Object.entries(legacy).reverse())),
      );
      const before = readFileSync(file);
      t.life().acceptRemote(t.remote, format === "SSH" ? callback : raw);
      Object.assign(t.manifest().attempt, raw.attempt);
      t.restart();
      await expect(t.life().reconcile("a")).resolves.toMatchObject({
        state: "COMPLETED",
      });
      expect(readFileSync(file)).toEqual(before);
      expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
      expect(() =>
        t.life().acceptRemote(t.remote, {
          ...callback,
          files: [{ path: "changed.txt", size: 5, sha256: hash("other") }],
        }),
      ).toThrow("cannot be replaced");
      expect(() =>
        t.life().acceptRemote(t.remote, {
          ...callback,
          collected: callback.collected + 1,
        }),
      ).toThrow("cannot be replaced");
      expect(readFileSync(file)).toEqual(before);
    } finally {
      t.close();
    }
  },
);

it.each([
  { name: "no omissions", omissions: [], alert: false },
  {
    name: "Emacs lock for saved file",
    omissions: [".#answer.txt: symlink omitted (never dereferenced)"],
    alert: false,
  },
  {
    name: "nested Emacs lock",
    omissions: ["src/.#answer.txt: symlink omitted (never dereferenced)"],
    file: "src/answer.txt",
    alert: false,
  },
  {
    name: "ordinary symlink",
    omissions: ["answer-link: symlink omitted (never dereferenced)"],
    alert: true,
  },
  {
    name: "lock-looking special file",
    omissions: [".#answer.txt: special file omitted"],
    alert: true,
  },
  {
    name: "lock without saved counterpart",
    omissions: [".#missing.txt: symlink omitted (never dereferenced)"],
    alert: true,
  },
  {
    name: "counterpart in different directory",
    omissions: ["src/.#answer.txt: symlink omitted (never dereferenced)"],
    alert: true,
  },
  {
    name: "unknown omission reason",
    omissions: [".#answer.txt: unreadable file omitted"],
    alert: true,
  },
  {
    name: "mixed lock and socket",
    omissions: [
      ".#answer.txt: symlink omitted (never dereferenced)",
      "editor.sock: special file omitted",
    ],
    alert: true,
  },
])("omission email policy: $name", ({ omissions, alert, file }) => {
  const t = setup();
  try {
    t.collect();
    const manifest = t.manifest();
    if (file) manifest.files[0].path = file;
    manifest.omissions = [...omissions];
    const original = JSON.stringify(manifest);
    t.life().acceptRemote(t.remote, manifest);
    const notifications = t
      .store()
      .db.prepare("SELECT subject FROM outbox")
      .all() as any[];
    expect(notifications.map((n) => n.subject)).toEqual(
      alert ? ["Submission entries omitted"] : [],
    );
    expect(t.store().attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
    });
    expect(JSON.stringify(manifest)).toBe(original);
    const receipt = readFileSync(t.dir + "/receipts/a.manifest.json", "utf8");
    expect(JSON.parse(receipt).omissions).toEqual(omissions);
    t.restart();
    t.life().acceptRemote(t.remote, manifest);
    expect(readFileSync(t.dir + "/receipts/a.manifest.json", "utf8")).toBe(
      receipt,
    );
    expect(
      t.store().db.prepare("SELECT count(*) AS count FROM outbox").get(),
    ).toEqual({ count: alert ? 1 : 0 });
  } finally {
    t.close();
  }
});

it("editor lock omissions do not suppress collection failure alerts", () => {
  const t = setup();
  try {
    t.collect();
    t.remote.state = "COLLECTION_FAILED";
    t.remote.errors = ["workload cleanup failed"];
    const manifest = t.manifest();
    manifest.omissions = [".#answer.txt: symlink omitted (never dereferenced)"];
    t.life().acceptRemote(t.remote, manifest);
    expect(t.store().attempt("a")).toMatchObject({
      state: "COLLECTION_FAILED",
      protected: 1,
      access_state: "HELD",
    });
    expect(t.store().db.prepare("SELECT subject FROM outbox").all()).toEqual([
      { subject: "Collection requires recovery" },
    ]);
    expect(
      JSON.parse(readFileSync(t.dir + "/receipts/a.manifest.json", "utf8"))
        .omissions,
    ).toEqual(manifest.omissions);
  } finally {
    t.close();
  }
});
