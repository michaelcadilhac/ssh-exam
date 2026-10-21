import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../../apps/server/src/db.js";
import { InterruptionManagement } from "../../apps/server/src/interruption-management.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";

function fixture() {
  const dir = mkdtempSync(tmpdir() + "/interruption-management-");
  let store = new Store(dir);
  store.db.exec("INSERT INTO exams VALUES('e','{}')");
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,generation,page_hash,access_state) VALUES('a','e','alice',1001,'LOCKED','{}',1,900000,900000,2,'PRIVATE-PAGE','HELD')",
    )
    .run();
  store.interruptions.pause(store.attempt("a"), "PRIVATE-REASON", 10000);
  store.db
    .prepare(
      "INSERT INTO incidents(id,attempt,generation,opened,events,message,review_at) VALUES('i','a',2,10000,'[]','PRIVATE-MESSAGE',10001)",
    )
    .run();
  return {
    get store() {
      return store;
    },
    get management() {
      return new InterruptionManagement(store);
    },
    body() {
      const s = this.management.show({ id: "a" });
      return {
        id: "a",
        generation: s.generation,
        revision: s.revision,
        requestID: randomUUID(),
        reason: "Reviewed interruption safely",
      };
    },
    restart() {
      store.close();
      store = new Store(dir);
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("fences generations AND same-generation review changes, without invalidating no-op reports", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  const f = fixture();
  try {
    const b = f.body();
    f.store.db.exec(
      "UPDATE attempts SET state=state,deadline=deadline,generation=generation; UPDATE incidents SET message=message,events=events",
    );
    expect(f.management.show({ id: "a" }).revision).toBe(b.revision);
    f.store.db.exec(
      "UPDATE incidents SET message='NEW-PRIVATE-MESSAGE' WHERE id='i'",
    );
    expect(() => f.management.authorize(b, "teacher")).toThrow(
      "changed after review",
    );
    expect(f.store.db.prepare("SELECT * FROM continuations").all()).toEqual([]);
    const changed = f.body();
    f.store.db.exec("UPDATE attempts SET generation=generation+1 WHERE id='a'");
    expect(() => f.management.authorize(changed, "teacher")).toThrow(
      "generation 3",
    );
    const fresh = f.body();
    const result = f.management.authorize(fresh, "teacher");
    expect(result).toMatchObject({
      id: "a",
      generation: 3,
      expires: 400000,
      execution: false,
    });
    expect(f.store.attempt("a")).toMatchObject({
      state: "LOCKED",
      deadline: 900000,
      original_deadline: 900000,
      access_state: "HELD",
      page_hash: "PRIVATE-PAGE",
    });
  } finally {
    f.close();
    clock.mockRestore();
  }
});

it("exact restart/expired retries never renew or overwrite a later deliberate authorization", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  const f = fixture();
  try {
    const b = f.body(),
      accepted = f.management.authorize(b, "teacher");
    clock.mockReturnValue(120000);
    const renewed = f.management.authorize(f.body(), "teacher");
    expect(renewed.expires).toBe(420000);
    const currentGrant = f.store.db
      .prepare("SELECT * FROM continuations")
      .get();
    f.restart();
    clock.mockReturnValue(500000);
    expect(f.management.authorize(b, "teacher")).toEqual(accepted);
    expect(f.store.db.prepare("SELECT * FROM continuations").get()).toEqual(
      currentGrant,
    );
    expect(
      f.store.db.prepare("SELECT count(*) n FROM continuation_requests").get(),
    ).toEqual({ n: 2 });
    expect(() =>
      f.management.authorize(
        { ...b, reason: "Different intent reason" },
        "teacher",
      ),
    ).toThrow("conflicts");
    const grants = f.store.interruptions.list("a")[0].authorizations;
    expect(grants).toHaveLength(2);
    expect(grants[0].replaced_at).toBe(120000);
  } finally {
    f.close();
    clock.mockRestore();
  }
});

it("caps expiry at the existing deadline and refuses unstarted/ended/protected/nonlocked/expired attempts", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  const f = fixture();
  try {
    for (const patch of [
      "state='ACTIVE'",
      "state='COMPLETED'",
      "start=NULL",
      "ended=99999",
      "protected=1",
      "deadline=100000",
    ]) {
      f.store.db.exec(
        "UPDATE attempts SET state='LOCKED',start=1,ended=NULL,protected=0,deadline=900000",
      );
      f.store.db.exec("UPDATE attempts SET " + patch);
      expect(() => f.management.authorize(f.body(), "teacher")).toThrow(
        "Attempt cannot continue",
      );
    }
    f.store.db.exec("UPDATE attempts SET deadline=120000");
    expect(f.management.authorize(f.body(), "teacher").expires).toBe(120000);
  } finally {
    f.close();
    clock.mockRestore();
  }
});

it("rolls back approval/history/revision/intent atomically when audit fails", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
  const f = fixture();
  try {
    const before = f.store.attempt("a"),
      history = f.store.interruptions.list("a");
    f.store.db.exec(
      "CREATE TRIGGER fail_auth_audit BEFORE INSERT ON audit WHEN NEW.action='authorize-continuation' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
    );
    expect(() => f.management.authorize(f.body(), "teacher")).toThrow(
      "synthetic audit failure",
    );
    expect(f.store.attempt("a")).toEqual(before);
    expect(f.store.interruptions.list("a")).toEqual(history);
    expect(f.store.db.prepare("SELECT * FROM continuations").all()).toEqual([]);
    expect(
      f.store.db.prepare("SELECT * FROM continuation_requests").all(),
    ).toEqual([]);
  } finally {
    f.close();
    clock.mockRestore();
  }
});

it("bounds private review, refuses changed/deleted receipt replay, and keeps metadata text-free", () => {
  const f = fixture();
  try {
    const b = { id: "a", section: "requests", limit: 1 };
    const receipt = f.management.receipt(b);
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    expect(JSON.stringify(f.management.show({ id: "a" }))).not.toContain(
      "PRIVATE",
    );
    expect(
      f.management.review(b, receipt, "agent:class:root").entries[0].message,
    ).toBe("PRIVATE-MESSAGE");
    f.restart();
    expect(
      f.management.review(b, receipt, "agent:class:root").entries[0].message,
    ).toBe("PRIVATE-MESSAGE");
    f.store.db.exec(
      "UPDATE incidents SET message='CHANGED-PRIVATE' WHERE id='i'",
    );
    expect(() => f.management.review(b, receipt, "root")).toThrow(
      "NEW --request",
    );
    const next = f.management.receipt(b);
    f.store.db.exec(
      "UPDATE attempts SET state='COMPLETED',ended=1 WHERE id='a'",
    );
    new Monitoring(f.store).delete("a", "teacher");
    expect(() => f.management.review(b, next, "root")).toThrow("deleted");
    expect(() => f.management.receipt(b)).toThrow("deleted");
    expect(f.store.attempt("a")).toMatchObject({
      deadline: 900000,
      original_deadline: 900000,
      access_state: "HELD",
    });
    const audits = JSON.stringify(
      f.store.db.prepare("SELECT * FROM audit").all(),
    );
    expect(audits).not.toContain("PRIVATE");
  } finally {
    f.close();
  }
});

it("fences paginated private review against a change on an earlier page", () => {
  const f = fixture();
  try {
    f.store.db.exec(
      "INSERT INTO incidents(id,attempt,generation,opened,events,message) VALUES('j','a',1,10002,'[]','Second message')",
    );
    const firstBody = { id: "a", section: "requests", limit: 1 };
    const first = f.management.review(
      firstBody,
      f.management.receipt(firstBody),
      "root",
    );
    expect(first.next).toBe("i");
    expect(() =>
      f.management.receipt({ ...firstBody, after: first.next }),
    ).toThrow("requires");
    const nextBody = {
      ...firstBody,
      after: first.next,
      revision: first.current.revision,
    };
    expect(
      f.management.review(nextBody, f.management.receipt(nextBody), "root")
        .entries[0].id,
    ).toBe("j");
    f.store.db.exec(
      "UPDATE incidents SET message='New first-page message' WHERE id='i'",
    );
    expect(() => f.management.receipt(nextBody)).toThrow("restart review");
  } finally {
    f.close();
  }
});

it("does not disclose malformed private fragments in errors and bounds stored strings before parsing", () => {
  const f = fixture();
  try {
    for (const events of ["PRIVATE-MALFORMED-JSON", "x".repeat(65537)]) {
      f.store.db
        .prepare("UPDATE incidents SET events=? WHERE id='i'")
        .run(events);
      const b = { id: "a", section: "requests" };
      let message = "";
      try {
        f.management.review(b, f.management.receipt(b), "root");
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/malformed|exceeds review bounds/);
      expect(message).not.toContain("PRIVATE");
    }
  } finally {
    f.close();
  }
});
