import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { hash } from "../../apps/server/src/db.js";
import { liveMonitoring } from "../fixtures/live-monitoring.js";

// Actual authenticated SSH/session/admin HTTP entry points. This fixture authors
// already-started native identity; it does not qualify Begin or kernel freezing.
it("policy receipt failure rolls the hold back, retry repairs atomically, and duplicate/conflicting reports cannot invalidate approval", async () => {
  const f = await liveMonitoring(),
    original = f.store.attempt(f.id),
    owner = {
      attempt: f.id,
      exam: original.exam,
      username: original.username,
      uid: original.uid,
      transport_hash: f.connection.transport,
      boot: randomUUID(),
      page_epoch: hash(f.page),
      input_epoch: "b".repeat(64),
      generation: 0,
      clock_revision: 0,
    };
  f.store.db
    .prepare(
      "UPDATE attempts SET monitoring_mode='v1',registered_owner=? WHERE id=?",
    )
    .run(JSON.stringify(owner), f.id);
  const report = {
      type: "incident",
      report: randomUUID(),
      generation: 0,
      reason: "Reviewed synthetic fullscreen loss",
    },
    receipt = () =>
      f.messages.find(
        (m) => m.type === "incident-recorded" && m.report === report.report,
      ),
    originalAudit = f.store.audit.bind(f.store),
    originalCommand = f.h.control.command!;
  let nativeLocks = 0;
  f.h.control.command = async (op, body, frame) => {
    if (op === "lock-attempt") nativeLocks++;
    return originalCommand(op, body, frame);
  };
  const audit = vi
    .spyOn(f.store, "audit")
    .mockImplementation((actor, action, target, detail) => {
      if (action === "policy-report-recorded")
        throw Error("Synthetic receipt transaction failure");
      return originalAudit(actor, action, target, detail);
    });
  try {
    f.send(report);
    await vi.waitFor(() =>
      expect(f.messages.some((m) => m.type === "error")).toBe(true),
    );
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "ACTIVE",
      generation: 0,
      deadline: original.deadline,
    });
    expect(
      f.store.db
        .prepare(
          "SELECT 1 FROM audit WHERE target=? AND action='policy-report-recorded'",
        )
        .get(f.id),
    ).toBeUndefined();
    expect(
      f.store.db.prepare("SELECT 1 FROM incidents WHERE attempt=?").get(f.id),
    ).toBeUndefined();
    expect(nativeLocks).toBe(0);
    expect(receipt()).toBeUndefined();
    audit.mockRestore();
    f.send(report);
    await vi.waitFor(() =>
      expect(receipt()).toMatchObject({ attempt: f.id, generation: 0 }),
    );
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      deadline: original.deadline,
    });
    expect(nativeLocks).toBe(1);
    const admin = f.store.session("admin", "instructor", null),
      headers = {
        origin: f.headers.origin,
        cookie: `session=${admin.token}`,
        "x-csrf-token": admin.csrf,
      },
      selected = await f.app.inject({
        url: `/api/admin/attempts/${f.id}/interruption`,
        headers,
      });
    expect(selected.statusCode, selected.body).toBe(200);
    const approval = await f.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${f.id}/authorize`,
      headers,
      payload: {
        generation: selected.json().generation,
        revision: selected.json().revision,
        requestID: randomUUID(),
        reason: "Reviewed synthetic receipt retry",
      },
    });
    expect(approval.statusCode, approval.body).toBe(200);
    const approved = (
      await f.app.inject({
        url: `/api/admin/attempts/${f.id}/interruption`,
        headers,
      })
    ).json();
    expect(approved.authorization).toMatchObject({
      consumed: 0,
      generation: 1,
    });
    const receiptsBefore = f.messages.filter(
      (m) => m.type === "incident-recorded",
    ).length;
    f.send(report);
    await vi.waitFor(() =>
      expect(
        f.messages.filter((m) => m.type === "incident-recorded").length,
      ).toBe(receiptsBefore + 1),
    );
    expect(
      (
        await f.app.inject({
          url: `/api/admin/attempts/${f.id}/interruption`,
          headers,
        })
      ).json(),
    ).toMatchObject({
      generation: approved.generation,
      revision: approved.revision,
      authorization: approved.authorization,
    });
    const errorsBefore = f.messages.filter((m) => m.type === "error").length;
    f.send({ ...report, reason: "Different original facts" });
    f.send({ ...report, report: randomUUID(), generation: 1 });
    await vi.waitFor(() =>
      expect(f.messages.filter((m) => m.type === "error").length).toBe(
        errorsBefore + 2,
      ),
    );
    expect(
      (
        await f.app.inject({
          url: `/api/admin/attempts/${f.id}/interruption`,
          headers,
        })
      ).json(),
    ).toMatchObject({
      generation: approved.generation,
      revision: approved.revision,
      authorization: approved.authorization,
    });
    expect(nativeLocks).toBe(1);
    expect(
      f.store.db
        .prepare(
          "SELECT COUNT(*) n FROM audit WHERE target=? AND action='policy-report-recorded'",
        )
        .get(f.id),
    ).toEqual({ n: 1 });
  } finally {
    audit.mockRestore();
    await f.close();
  }
}, 30000);
