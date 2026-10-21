import { expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { Monitoring } from "../../apps/server/src/monitoring.js";

// Actual compiled CLI/root user namespace -> real TLS gateway. All attempts and
// recording bytes are synthetic; no installed service/account is touched.
export async function qualifyMonitoringCLI(
  f: any,
  invoke: (
    category: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  const id = f.current.store.db
    .prepare(
      "SELECT id FROM attempts WHERE exam='clock-exam' AND username='clock03'",
    )
    .get().id;
  // The clock-only fixture marks this synthetic row COMPLETED without an end
  // timestamp. Supply its truthful fixture completion before reviewing deletion;
  // never relax the shared ended-at eligibility rule to make a test pass.
  f.current.store.db
    .prepare(
      "UPDATE attempts SET ended=MIN(deadline,?) WHERE id=? AND state='COMPLETED' AND ended IS NULL",
    )
    .run(Date.now(), id);
  const before = f.current.store.attempt(id);
  const pane = randomUUID(),
    peer = randomUUID();
  let media = new Monitoring(f.current.store);
  media.record(id, pane, {
    event: "output",
    data: "PRIVATE-CLI-TERMINAL-日本語",
  });
  media.record(id, peer, { event: "open" });
  for (let seq = 1; seq <= 2; seq++)
    f.current.store.db
      .prepare(
        "INSERT INTO frames VALUES(?,?, 'screen',?,'PRIVATE-PAGE-HASH',?,1,?,40,30,'PRIVATE-FRAME-HASH')",
      )
      .run(randomUUID(), id, seq, Date.now(), Date.now());
  const run = async (args: string[]) =>
    JSON.parse((await invoke("monitoring", args)).stdout).result;
  const shown = await run(["show", id]);
  expect(shown).toMatchObject({
    id,
    terminals: 2,
    frames: [{ source: "screen", count: 2 }],
  });
  expect(JSON.stringify(shown)).not.toContain("PRIVATE");
  expect(shown.physicalPurge).toEqual({
    status: "not-verified",
    verified: null,
  });
  const first = await run(["list", id, "--section", "frames", "--limit", "1"]);
  expect(first.entries).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain("PRIVATE");
  const last = await run([
    "list",
    id,
    "--section",
    "frames",
    "--limit",
    "1",
    "--after",
    String(first.next),
    "--through",
    String(first.through),
  ]);
  expect(last.next).toBeNull();
  expect(last.entries[0].id).not.toBe(first.entries[0].id);
  expect(
    (await run(["list", id, "--section", "terminals"])).entries.map(
      (r: any) => r.pane,
    ),
  ).toEqual([pane, peer]);
  const request = randomUUID(),
    args = ["replay", id, pane, "--request", request];
  const initial = await run(args);
  expect(initial.text).toContain("PRIVATE-CLI-TERMINAL-日本語");
  expect(initial.nextOffset).toBe(Buffer.byteLength(initial.text));
  const file = `${f.dir}/private-replay.ndjson`;
  expect(
    (await invoke("monitoring", [...args, "--output", file])).stderr,
  ).toContain("One replay batch only");
  expect(readFileSync(file, "utf8")).toBe(initial.text);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  await expect(
    invoke("monitoring", [...args, "--output", file]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("never overwrite"),
  });
  const protectedFile = `${f.dir}/not-an-output`,
    link = `${f.dir}/replay-link`;
  writeFileSync(protectedFile, "preserved");
  symlinkSync(protectedFile, link);
  await expect(
    invoke("monitoring", [...args, "--output", link]),
  ).rejects.toMatchObject({ code: 1 });
  expect(readFileSync(protectedFile, "utf8")).toBe("preserved");
  expect((await invoke("monitoring", [...args, "--output", "-"])).stdout).toBe(
    initial.text,
  );
  const stored = f.current.store.db
    .prepare("SELECT outcome FROM agent_management_requests WHERE request=?")
    .get(request).outcome;
  expect(JSON.parse(stored).result).toEqual({ id, transient: true });
  expect(stored).not.toContain("PRIVATE");
  await f.restart();
  expect(await run(args)).toEqual(initial);
  media = new Monitoring(f.current.store);
  media.record(id, pane, { event: "output", data: "appended" });
  expect((await run(args)).text).toContain("appended");
  const next = await run([
    "replay",
    id,
    pane,
    "--offset",
    String(initial.nextOffset),
  ]);
  expect(JSON.parse(next.text).data).toBe("appended");
  await expect(
    invoke("monitoring", ["replay", id, pane, "--offset", "2"]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("complete event"),
  });
  expect(f.current.store.attempt(id)).toEqual(before);
  f.current.store.db.transaction(() => {
    f.current.store.db
      .prepare("INSERT INTO tombstones VALUES('retired-preflight',0)")
      .run();
    f.current.store.db
      .prepare(
        "INSERT INTO monitoring_purges(attempt,status,next,updated,error) VALUES('retired-preflight','retry',?,1,'permission')",
      )
      .run(Date.now() + 3600000);
  })();
  const purgeRequest = randomUUID();
  // Earlier restart tests may retain other legitimately interrupted purge jobs.
  // Page past their actual IDs rather than assuming a globally empty backlog.
  const priorCursor = f.current.store.db
    .prepare(
      "SELECT MAX(attempt) cursor FROM tombstones WHERE attempt!='retired-preflight'",
    )
    .get().cursor;
  const inventory = await run([
    "purges",
    "--status",
    "retry",
    "--limit",
    "1",
    "--after",
    priorCursor,
    "--request",
    purgeRequest,
  ]);
  expect(inventory.entries).toHaveLength(1);
  expect(inventory.entries[0]).toMatchObject({
    id: "retired-preflight",
    status: "retry",
    username: null,
    deleted: 0,
  });
  await f.restart();
  expect(await run(["purge-status", "retired-preflight"])).toMatchObject({
    id: "retired-preflight",
    deleted: 0,
    attempt: null,
    job: { status: "retry", error: "permission" },
  });
  f.current.store.db
    .prepare(
      "UPDATE monitoring_purges SET status='pending',error=NULL WHERE attempt='retired-preflight'",
    )
    .run();
  expect(
    await run([
      "purges",
      "--status",
      "retry",
      "--limit",
      "1",
      "--after",
      priorCursor,
      "--request",
      purgeRequest,
    ]),
  ).toEqual(inventory);
  expect(
    (await run(["purges", "--status", "retry"])).entries.some(
      (e: any) => e.id === "retired-preflight",
    ),
  ).toBe(false);
  expect(f.current.store.attempt(id)).toEqual(before);
  const deletion = (await run(["show", id])).deletionReview;
  const intent = randomUUID(),
    parent = randomUUID();
  const deleteArgs = [
    "delete",
    id,
    "--confirm",
    deletion.confirm,
    "--revision",
    deletion.revision,
    "--reason",
    "Reviewed synthetic monitoring deletion",
    "--intent",
    intent,
    "--request",
    parent,
  ];
  await expect(
    invoke("monitoring", [...deleteArgs, "--confirm", "wrong-student"]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("confirmation"),
  });
  // A failed parent ID is durable too. Use a new parent for corrected arguments.
  deleteArgs[deleteArgs.length - 1] = randomUUID();
  const accepted = await run(deleteArgs);
  expect(accepted).toMatchObject({
    id,
    requestID: intent,
    status: "logical-deletion-accepted",
    logicalDeleted: true,
    physicalPurge: "pending-verification",
  });
  await f.restart();
  expect(await run(deleteArgs)).toEqual(accepted);
  deleteArgs[deleteArgs.length - 1] = randomUUID();
  expect(await run(deleteArgs)).toEqual(accepted); // New parent, same audited child intent.
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM monitoring_deletion_requests WHERE request=?",
      )
      .get(intent),
  ).toEqual({ n: 1 });
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='monitoring-delete-intent' AND target=?",
      )
      .get(id),
  ).toEqual({ n: 1 });
  const missing = `${f.dir}/deleted-replay.ndjson`;
  await expect(
    invoke("monitoring", [...args, "--output", missing]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("deleted"),
  });
  expect(existsSync(missing)).toBe(false);
  expect((await run(["show", id])).current.monitoringDeleted).toBeTypeOf(
    "number",
  );
  await vi.waitFor(
    async () => {
      const status = (await run(["show", id])).physicalPurge;
      expect(status.status).toBe("verified-absent");
      expect(status.verified).toBeTypeOf("number");
      expect(status.scope).toContain("not backup");
    },
    { timeout: 5000, interval: 100 },
  );
  let page = await run(["purges", "--limit", "1"]);
  const seen: string[] = [];
  for (let n = 0; n < 10; n++) {
    seen.push(...page.entries.map((e: any) => e.id));
    if (!page.next) break;
    page = await run(["purges", "--limit", "1", "--after", page.next]);
  }
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).toContain("retired-preflight");
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='management-monitoring.purges' AND json_extract(detail,'$.target')!='monitoring-purges'",
      )
      .get(),
  ).toEqual({ n: 0 });
  expect(f.current.store.attempt(id)).toEqual(before);
  expect(
    JSON.stringify(
      f.current.store.db
        .prepare("SELECT outcome FROM agent_management_requests")
        .all(),
    ),
  ).not.toContain("PRIVATE-CLI-TERMINAL");
  expect(
    f.current.store.db
      .prepare(
        "SELECT actor FROM audit WHERE action='terminal-replay' AND target=? LIMIT 1",
      )
      .get(id),
  ).toEqual({ actor: "agent:class:root" });
}
