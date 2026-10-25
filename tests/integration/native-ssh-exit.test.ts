import { expect, it } from "vitest";
import { sign } from "node:crypto";
import { hash } from "../../apps/server/src/db.js";
import { liveMonitoring } from "../fixtures/live-monitoring.js";

it("signed SSH-exit callbacks retire only the exact current retained owner; unknown and stale facts preserve live SSH", async () => {
  const f = await liveMonitoring({ ownedAttempt: true });
  const original = f.store.attempt(f.id);
  const owner = {
    attempt: f.id,
    exam: original.exam,
    username: original.username,
    uid: original.uid,
    transport_hash: f.connection.transport,
    boot: "77777777-1234-4234-8234-123456789abc",
    page_epoch: hash(f.page),
    input_epoch: hash("synthetic current native owner"),
    generation: 0,
    clock_revision: 0,
  };
  f.store.db
    .prepare(
      "UPDATE attempts SET monitoring_mode='v1',registered_owner=? WHERE id=?",
    )
    .run(JSON.stringify(owner), f.id);
  const remote: any = {
    ...original,
    settings: JSON.parse(original.settings),
    state: "LOCKED",
    generation: 1,
    boot: owner.boot,
    registered_owner: owner,
    monitoring_mode: "v1",
    browser_ssh: true,
    terminal_supervised: true,
    retained_hold: "held",
    monitoring_hold_kind: "technical",
    reason:
      "Monitoring verification unavailable; technical safety hold, not a student violation",
  };
  let sequence = 0;
  const post = async (extra: any) => {
    const payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        sequence: ++sequence,
        at: Date.now(),
        attempt: { ...remote, ...extra },
      }),
    );
    const result = await f.app.inject({
      method: "POST",
      url: "/api/agent/events",
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, f.h.callbackKey).toString(
          "base64",
        ),
      },
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
  };
  const live = async () => {
    expect(f.connection.alive).toBe(true);
    // Positive authenticated SSH round trip, not just an alive flag/timer.
    await f.connection.command("register", { exam: original.exam });
    expect(f.h.sshTransports.get(owner.transport_hash)).toMatchObject({
      username: original.username,
      closed: false,
    });
    expect(f.store.attempt(f.id)).toMatchObject({
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      state: "LOCKED",
      generation: 1,
    });
  };
  try {
    for (const proof of [
      undefined,
      null,
      { ...owner, transport_hash: "unknown" },
      { ...owner, transport_hash: hash("unrelated transport") },
      { ...owner, input_epoch: hash("stale pane lifetime") },
      { ...owner, clock_revision: 1 },
    ]) {
      await post({ ssh_exited_owner: proof });
      await live();
    }
    const current = { ...owner, clock_revision: 1 };
    f.store.db
      .prepare(
        "UPDATE attempts SET clock_revision=1,registered_owner=? WHERE id=?",
      )
      .run(JSON.stringify(current), f.id);
    await post({ ssh_exited_owner: owner }); // Valid old fact, old clock revision.
    await live();
    await post({
      clock_revision: 1,
      registered_owner: current,
      ssh_exited_owner: current,
    });
    expect(f.connection.alive).toBe(false);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      monitoring_hold_kind: "technical",
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
    });
    expect(
      f.store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit WHERE action='native-ssh-exited' AND target=?",
        )
        .get(f.id),
    ).toEqual({ count: 1 });
    expect(f.store.attempt(f.id).reason).not.toContain("SSH transport lost");
  } finally {
    await f.close();
  }
});
