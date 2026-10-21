import { expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { InterruptionManagement } from "../../apps/server/src/interruption-management.js";

// Real compiled namespace-root CLI/HTTPS/gateway; native attempt fixture is
// synthetic. No host account, installed SSH/PAM or freeze qualification claim.
export async function qualifyInterruptionCLI(
  f: any,
  invoke: (
    category: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  const run = async (args: string[]) =>
    JSON.parse((await invoke("interruptions", args)).stdout).result;
  const id = f.current.store.db
    .prepare(
      "SELECT id FROM attempts WHERE exam='clock-exam' AND username='clock02'",
    )
    .get().id;
  f.current.store.db
    .prepare(
      "INSERT INTO incidents(id,attempt,generation,opened,events,message,review_at) VALUES(? ,?,1,?,'[]','PRIVATE-CLI-REVIEW-TEXT',?)",
    )
    .run(randomUUID(), id, Date.now(), Date.now());
  const before = f.current.store.attempt(id);
  const shown = await run(["show", id]);
  expect(shown).toMatchObject({
    id,
    generation: before.generation,
    revision: before.continuation_revision,
    state: "LOCKED",
    authorization: null,
  });
  expect(JSON.stringify(shown)).not.toContain("PRIVATE");
  const reviewID = randomUUID(),
    reviewArgs = [
      "review",
      id,
      "--section",
      "requests",
      "--limit",
      "1",
      "--request",
      reviewID,
    ];
  expect((await run(reviewArgs)).entries[0].message).toBe(
    "PRIVATE-CLI-REVIEW-TEXT",
  );
  // A correctly signed gateway envelope is not sufficient if its nested
  // resource scope is wrong. The CLI must refuse BEFORE printing private text.
  const realReview = InterruptionManagement.prototype.review;
  const wrongScope = vi
    .spyOn(InterruptionManagement.prototype, "review")
    .mockImplementationOnce(function (this: InterruptionManagement, ...args) {
      const result = realReview.apply(this, args);
      return {
        ...result,
        current: { ...result.current, id: "different-attempt" },
      };
    });
  try {
    await expect(
      invoke("interruptions", ["review", id, "--section", "requests"]),
    ).rejects.toMatchObject({
      stdout: "",
      stderr: expect.stringContaining("target mismatch"),
    });
    expect(wrongScope).toHaveBeenCalledOnce();
  } finally {
    wrongScope.mockRestore();
  }
  const receipt = f.current.store.db
    .prepare("SELECT outcome FROM agent_management_requests WHERE request=?")
    .get(reviewID).outcome;
  expect(receipt).not.toContain("PRIVATE");
  expect(JSON.parse(receipt).result).toMatchObject({
    id,
    revision: shown.revision,
    transient: true,
  });
  const history = await run(["review", id, "--section", "history"]);
  expect(history.current.id).toBe(id);
  const intent = randomUUID(),
    args = [
      "authorize",
      id,
      "--generation",
      String(shown.generation),
      "--revision",
      String(shown.revision),
      "--reason",
      "Reviewed synthetic interruption",
      "--request",
      intent,
    ];
  const result = await run(args);
  expect(result).toMatchObject({
    id,
    generation: before.generation,
    execution: false,
    status: "authorized",
    requestID: intent,
  });
  const grant = f.current.store.db
    .prepare("SELECT * FROM continuations WHERE attempt=?")
    .get(id);
  expect(grant.expires).toBeLessThanOrEqual(before.deadline);
  await f.restart();
  expect(await run(args)).toEqual(result);
  expect(
    f.current.store.db
      .prepare("SELECT * FROM continuations WHERE attempt=?")
      .get(id),
  ).toEqual(grant);
  expect(f.current.store.attempt(id)).toMatchObject({
    state: before.state,
    deadline: before.deadline,
    original_deadline: before.original_deadline,
    page_hash: before.page_hash,
    access_state: before.access_state,
  });
  await expect(invoke("interruptions", reviewArgs)).rejects.toMatchObject({
    stderr: expect.stringContaining("review changed"),
  });
  const freshRead = randomUUID(),
    freshArgs = ["review", id, "--section", "requests", "--request", freshRead];
  expect((await run(freshArgs)).entries[0].message).toBe(
    "PRIVATE-CLI-REVIEW-TEXT",
  );
  expect((await run(freshArgs)).entries[0].message).toBe(
    "PRIVATE-CLI-REVIEW-TEXT",
  );
  const old = await run(["show", id]);
  f.current.store.db
    .prepare(
      "UPDATE incidents SET message='CHANGED-PRIVATE-CLI-REVIEW-TEXT' WHERE attempt=?",
    )
    .run(id);
  await expect(
    invoke("interruptions", [
      "authorize",
      id,
      "--generation",
      String(old.generation),
      "--revision",
      String(old.revision),
      "--reason",
      "Stale review must be refused",
    ]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("changed after review"),
  });
  await expect(invoke("interruptions", freshArgs)).rejects.toMatchObject({
    stderr: expect.stringContaining("review changed"),
  });
  f.current.store.db
    .prepare("UPDATE attempts SET state='COMPLETED',ended=? WHERE id=?")
    .run(Date.now(), id);
  new Monitoring(f.current.store).delete(id, "fixture-retention");
  await f.restart();
  await expect(invoke("interruptions", freshArgs)).rejects.toMatchObject({
    stderr: expect.stringContaining("deleted"),
  });
  expect((await run(["show", id])).historyDeleted).toBe(true);
  const stored = JSON.stringify(
    f.current.store.db
      .prepare("SELECT outcome FROM agent_management_requests")
      .all(),
  );
  expect(stored).not.toContain("PRIVATE-CLI-REVIEW-TEXT");
  expect(
    f.current.store.db
      .prepare(
        "SELECT actor FROM audit WHERE action='authorize-continuation' AND target=?",
      )
      .get(id),
  ).toEqual({ actor: "agent:class:root" });
}
