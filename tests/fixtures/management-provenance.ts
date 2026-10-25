import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";

// Actual compiled root-mapped CLI -> signed HTTPS management. Only the
// cancelled, never-started preparation below is a synthetic lifecycle outcome.
export async function qualifyProvenanceCLI(
  f: any,
  invoke: (category: string, args: string[]) => Promise<{ stdout: string }>,
) {
  const run = async (category: string, args: string[]) =>
    JSON.parse((await invoke(category, args)).stdout).result;
  await run("exams", [
    "create",
    "provenance-cli",
    "--template",
    "v1",
    "--template-version",
    "a".repeat(64),
    "--earliest",
    new Date(Date.now() - 60000).toISOString(),
    "--latest",
    new Date(Date.now() + 3600000).toISOString(),
  ]);
  await run("students", ["add", "provenance-cli", "provenance01"]);
  const original = (
    await run("grants", [
      "list",
      "provenance-cli",
      "--username",
      "provenance01",
    ])
  ).grants[0];
  const ids = [randomUUID(), randomUUID()],
    id = ids[0],
    grants = new AttemptGrants(f.current.store, "class");
  for (const id of ids) {
    f.current.store.db.transaction(() => {
      const current = grants.claim(original.id, id, 21001),
        binding = grants.binding(current);
      f.current.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial,grant_work) VALUES(?,'provenance-cli','provenance01',21001,'PREPARING',?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          JSON.stringify(current.settings),
          current.id,
          current.revision,
          current.hash,
          binding.kind ?? null,
          current.issuance_order,
          current.initial_grant ?? null,
          binding.work ? JSON.stringify(binding.work) : null,
        );
      f.current.store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START',ended=? WHERE id=?",
        )
        .run(Date.now(), id);
      grants.retire(f.current.store.attempt(id));
    })();
  }
  await run("grants", [
    "revise",
    original.id,
    "--revision",
    "1",
    "--duration-minutes",
    "75",
    "--work",
    "empty",
    "--reason",
    "Explicit unused revision after cancelled CLI preparation",
  ]);
  await f.restart();
  const inspected = (await run("attempts", ["show", id])).attempt;
  expect(inspected).toMatchObject({
    attempt_number: 1,
    state: "CANCELLED_BEFORE_START",
    start: null,
    deadline: null,
    grantContext: {
      state: "recorded",
      id: original.id,
      revision: 1,
      hash: original.hash,
      current_revision: 2,
      current_status: "AVAILABLE",
      settings: { duration: 5400 },
      work: original.work,
    },
  });
  expect(inspected.settings.template_version).toBe("a".repeat(64));
  const history = (await run("attempts", ["list", "provenance-cli"])).attempts;
  expect(history.map((a: any) => a.attempt_number).sort()).toEqual([1, 2]);
  for (const attempt of history)
    expect(attempt.grantContext).toEqual(inspected.grantContext);
  expect(f.current.store.attempt(id)).toMatchObject({
    grant_revision: 1,
    grant_hash: original.hash,
    start: null,
    deadline: null,
    access_state: "UNKNOWN",
  });
}
