import { expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringManagement } from "../../apps/server/src/monitoring-management.js";
const pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fixture() {
  const store = new Store(mkdtempSync(tmpdir() + "/monitoring-management-"));
  const monitoring = new Monitoring(store);
  const management = new MonitoringManagement(store, monitoring);
  store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash,access_state,protected,checksum) VALUES('a','e','alice',1001,'LOCKED','{}',100,200,300,'PRIVATE-PAGE','HELD',1,'immutable-checksum')",
  );
  writeFileSync(`${store.dir}/receipts/a.manifest.json`, "immutable receipt");
  const authority = store.attempt("a");
  const read = (operation: string, body: object, receipt?: any) =>
    management.read(
      operation,
      body,
      receipt ?? management.receipt(operation, body),
      "teacher",
    );
  return {
    store,
    monitoring,
    management,
    read,
    close() {
      expect(store.attempt("a")).toEqual(authority);
      expect(
        readFileSync(`${store.dir}/receipts/a.manifest.json`, "utf8"),
      ).toBe("immutable receipt");
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it("pages append-only metadata at the original watermark without secrets or payloads", () => {
  const f = fixture();
  try {
    for (const pane of ["one", "two", "three"])
      f.monitoring.record("a", pane, { private: "PRIVATE-TERMINAL" });
    const body = { id: "a", section: "terminals", limit: 1 };
    const receipt = f.management.receipt("monitoring.list", body);
    expect(receipt).toEqual({
      id: "a",
      section: "terminals",
      through: 3,
      transient: true,
    });
    const first: any = f.read("monitoring.list", body, receipt);
    f.monitoring.record("a", "four", { private: "PRIVATE-TERMINAL" });
    const second: any = f.read("monitoring.list", {
      ...body,
      after: first.next,
      through: first.through,
    });
    const third: any = f.read("monitoring.list", {
      ...body,
      after: second.next,
      through: first.through,
    });
    expect([
      first.entries[0].pane,
      second.entries[0].pane,
      third.entries[0].pane,
    ]).toEqual(["one", "two", "three"]);
    expect(third.next).toBeNull();
    expect(
      (f.read("monitoring.list", { ...body, limit: 200 }) as any).entries,
    ).toHaveLength(4);
    expect(
      JSON.stringify([receipt, first, f.read("monitoring.show", { id: "a" })]),
    ).not.toContain("PRIVATE");
    expect(() => f.read("monitoring.list", { ...body, after: 1 })).toThrow(
      "watermark",
    );
    expect(() =>
      f.read("monitoring.list", { ...body, after: 4, through: 3 }),
    ).toThrow("beyond");
    expect(() => f.read("monitoring.list", { ...body, through: 999 })).toThrow(
      "unavailable",
    );
    expect(() => f.read("monitoring.list", { ...body, limit: 201 })).toThrow();
    expect(() => f.read("monitoring.show", { id: "a", extra: true })).toThrow();
  } finally {
    f.close();
  }
});

it("keeps only scoped transient replay receipts, rereads append data and refuses tombstoned bytes", () => {
  const f = fixture();
  try {
    f.monitoring.record("a", pane, { note: "PRIVATE-日本語" });
    const body = { id: "a", pane, offset: 0 };
    const receipt = f.management.receipt("monitoring.replay", body);
    expect(receipt).toEqual({ id: "a", transient: true });
    const first: any = f.read("monitoring.replay", body, receipt);
    expect(first.text).toContain("PRIVATE-日本語");
    expect(first.nextOffset).toBe(Buffer.byteLength(first.text));
    expect(first.availableBytes).toBe(first.nextOffset);
    f.monitoring.record("a", pane, { note: "appended" });
    expect((f.read("monitoring.replay", body, receipt) as any).text).toContain(
      "appended",
    );
    expect(() => f.read("monitoring.replay", { ...body, offset: 2 })).toThrow(
      "complete event",
    );
    expect(() =>
      f.read("monitoring.replay", body, { ...receipt, id: "other" }),
    ).toThrow("scope mismatch");
    f.monitoring.delete("a", "teacher");
    expect(() => f.read("monitoring.replay", body, receipt)).toThrow("deleted");
    // Epoch zero must still mean deleted, even with orphaned metadata.
    f.store.db.exec(
      "UPDATE tombstones SET deleted=0; INSERT INTO recordings VALUES('orphan','a','orphan',1)",
    );
    const shown: any = f.read("monitoring.show", { id: "a" });
    expect(shown.current.monitoringDeleted).toBe(0);
    expect(shown.terminals).toBe(0);
    expect(
      JSON.stringify(f.store.db.prepare("SELECT * FROM audit").all()),
    ).not.toContain("PRIVATE-日本語");
  } finally {
    f.close();
  }
});

it("refuses nonregular/link recording storage without following it or exposing private IO errors", () => {
  const f = fixture();
  try {
    f.monitoring.record("a", pane, { note: "private" });
    const path = `${f.store.dir}/monitoring/a/${pane}.ndjson`,
      original = path + ".original";
    writeFileSync(original, "private\n");
    const body = { id: "a", pane };
    unlinkSync(path);
    symlinkSync(original, path);
    expect(() => f.monitoring.replay("a", pane, 0)).toThrow();
    expect(() => f.read("monitoring.replay", body)).toThrow(
      "storage/permissions",
    );
    unlinkSync(path);
    linkSync(original, path);
    expect(() => f.monitoring.replay("a", pane, 0)).toThrow(
      "regular private file",
    );
    unlinkSync(path);
    if (process.platform === "linux") {
      // Real FIFO with no writer: a blocking open would hang this regression.
      execFileSync("mkfifo", [path]);
      expect(() => f.monitoring.replay("a", pane, 0)).toThrow(
        "regular private file",
      );
      expect(() => f.read("monitoring.replay", body)).toThrow(
        "storage/permissions",
      );
      unlinkSync(path);
    }
    try {
      f.read("monitoring.replay", body);
      throw Error("unexpected success");
    } catch (e) {
      expect((e as Error).message).not.toContain(f.store.dir);
      expect((e as any).statusCode).toBe(503);
    }
  } finally {
    f.close();
  }
});
