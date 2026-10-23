import { expect } from "vitest";
import { randomUUID, sign } from "node:crypto";

// Real compiled root-mapped CLI -> HTTPS -> gateway; only the already-running
// native records and signed native reports below are synthetic test fixtures.
export async function qualifyClockCLI(
  f: any,
  invoke: (
    category: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  const run = async (category: string, args: string[]) =>
    JSON.parse((await invoke(category, args)).stdout);
  await run("exams", [
    "create",
    "clock-exam",
    "--template",
    "v1",
    "--earliest",
    new Date(Date.now() - 60000).toISOString(),
    "--latest",
    new Date(Date.now() + 3600000).toISOString(),
  ]);
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const start = Date.now() - 60000,
    original = Date.now() + 3600000;
  const settings = {
    id: "clock-exam",
    duration: 5400,
    template: "v1",
    webcam: false,
    terminals: 4,
    private_extra: "PRIVATE-UNRECOGNIZED-SETTINGS",
  };
  const insert = f.current.store.db.prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state,access_held_at,page_hash,generation) VALUES(?,'clock-exam',?,?,?,?,?,?,?,'HELD',?,'PRIVATE-PAGE-HASH',1)",
  );
  ids.forEach((id, n) =>
    insert.run(
      id,
      `clock0${n + 1}`,
      20001 + n,
      n === 2 ? "COMPLETED" : "LOCKED",
      JSON.stringify(settings),
      start,
      original,
      original,
      start,
    ),
  );
  // These fixtures are already-started LEGACY records, not new grants. Seed
  // history before re-enrollment so enrollment cannot invent a new allowance.
  for (const user of ["clock01", "clock02", "clock03", "clock04"])
    await run("students", ["add", "clock-exam", user]);
  await run("students", [
    "settings",
    "clock-exam",
    "clock01",
    "--duration-minutes",
    "120",
  ]);
  // Real locked records already carry interruption history. Seed it before
  // taking the unchanged-state snapshot so restart recovery need not repair this
  // intentionally synthetic fixture and advance its new review fence.
  for (const id of ids.filter((_, n) => n !== 2))
    f.current.store.interruptions.pause(
      f.current.store.attempt(id),
      "Synthetic interruption",
    );
  const beforeB = f.current.store.attempt(ids[1]);
  let sequence = 0;
  const postSigned = async (path: string, body: unknown) => {
    const payload = Buffer.from(JSON.stringify(body));
    const response = await f.current.app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(
          null,
          payload,
          f.agentKeys.privateKey,
        ).toString("base64"),
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  await postSigned("/api/agent/events", {
    agent: "class",
    sequence: ++sequence,
    health: {
      ready: true,
      capabilities: ["clock-reset", "clock-extend", "deadline-timing-check"],
    },
    accounts: {
      clock01: 20001,
      clock02: 20002,
      clock03: 20003,
      clock04: 20004,
    },
  });
  const firstList = (
    await run("attempts", ["list", "clock-exam", "--limit", "1"])
  ).result;
  expect(firstList.attempts).toHaveLength(1);
  expect(firstList.next).not.toBeNull();
  const viewed = (await run("attempts", ["show", ids[0]])).result;
  expect(viewed.attempt).toMatchObject({
    state: "LOCKED",
    deadline: original,
    original_deadline: original,
    access_state: "HELD",
    connected: false,
  });
  expect(JSON.stringify(viewed)).not.toContain("PRIVATE-PAGE-HASH");
  expect(JSON.stringify(viewed)).not.toContain("PRIVATE-UNRECOGNIZED-SETTINGS");
  expect(
    (await run("attempts", ["list", "clock-exam", "--view", "working"])).result
      .attempts,
  ).toEqual([]);
  const resetID = randomUUID();
  const resetArgs = [
    "reset",
    ids[0],
    "--minutes",
    "20",
    "--revision",
    "0",
    "--request",
    resetID,
  ];
  const accepted = (await run("clocks", resetArgs)).result;
  expect(accepted).toMatchObject({
    confirmed: false,
    status: "pending",
    requestID: resetID,
    pending: { remaining_seconds: 1200, actor: "agent:class:root" },
  });
  expect(f.current.store.attempt(ids[0]).deadline).toBe(original);
  await f.restart();
  expect((await run("clocks", resetArgs)).result).toEqual(accepted);
  expect((await run("clocks", ["show", resetID])).result.status).toBe(
    "pending",
  );
  let native: any = {
    id: ids[0],
    exam: "clock-exam",
    username: "clock01",
    uid: 20001,
    state: "LOCKED",
    start,
    original_deadline: original,
    deadline: original,
    generation: 1,
    clock_revision: 0,
    clock_resets: [],
    access_state: "HELD",
    access_held_at: start,
  };
  const apply = async (request: any) => {
    const deadline = request.extend_seconds
      ? native.deadline + request.extend_seconds * 1000
      : request.requested_at + request.remaining_seconds * 1000;
    native = {
      ...native,
      deadline,
      clock_revision: native.clock_revision + 1,
      clock_resets: [
        ...native.clock_resets,
        {
          id: request.reset_id,
          actor: request.actor,
          requested_at: request.requested_at,
          applied_at: Date.now(),
          previous_deadline: native.deadline,
          deadline,
          remaining_seconds: request.remaining_seconds,
          ...(request.extend_seconds
            ? { extend_seconds: request.extend_seconds }
            : {}),
          revision: native.clock_revision + 1,
        },
      ],
    };
    await postSigned("/api/agent/events", {
      agent: "class",
      sequence: ++sequence,
      attempt: native,
    });
  };
  await apply(accepted.pending);
  expect((await run("clocks", ["show", resetID])).result).toMatchObject({
    confirmed: true,
    status: "applied",
  });
  expect((await run("clocks", resetArgs)).result.status).toBe("pending"); // cached intent, not a fresh status read
  expect(
    (
      await run("clocks", [
        "reset",
        ids[0],
        "--minutes",
        "20",
        "--revision",
        "0",
        "--intent",
        resetID,
      ])
    ).result.status,
  ).toBe("applied");
  const extend = (
    await run("clocks", ["extend", ids[0], "--minutes", "5", "--revision", "1"])
  ).result;
  expect(extend.pending).toMatchObject({
    extend_seconds: 300,
    remaining_seconds: 0,
    deadline: native.deadline,
  });
  const previous = native.deadline;
  await apply(extend.pending);
  expect(f.current.store.attempt(ids[0])).toMatchObject({
    deadline: previous + 300000,
    original_deadline: original,
    access_state: "HELD",
    generation: 1,
  });
  const parent = randomUUID();
  const preview = (
    await run("clocks", [
      "preview",
      "clock-exam",
      "--target",
      ids[0] + ":2",
      "--target",
      ids[1] + ":0",
    ])
  ).result;
  expect(preview.targets.map((t: any) => t.expectedSeconds)).toEqual([
    7200, 5400,
  ]);
  const batchArgs = [
    "reset-default",
    "clock-exam",
    "--target",
    ids[0] + ":2:7200",
    "--target",
    ids[2] + ":0:5400",
    "--request",
    parent,
  ];
  const partial = async (args: string[]) => {
    try {
      await invoke("clocks", args);
      throw Error("Expected partial batch exit status 1");
    } catch (error) {
      expect((error as any).code).toBe(1);
      return JSON.parse((error as any).stdout);
    }
  };
  const bulk = (await partial(batchArgs)).result;
  expect(bulk.results.map((r: any) => r.status)).toEqual(["pending", "failed"]);
  expect(bulk.results[0].pending.remaining_seconds).toBe(7200); // explicit current individual allowance
  expect(bulk.results[1].error).toContain("web attempts show");
  expect((await partial(batchArgs)).result).toEqual(bulk);
  expect(
    (
      await partial([
        "reset-default",
        "clock-exam",
        "--target",
        ids[2] + ":0:5400:" + bulk.results[1].requestID,
      ])
    ).result.results[0].status,
  ).toBe("failed");
  const defaultB = (
    await run("clocks", [
      "reset-default",
      "clock-exam",
      "--target",
      ids[1] + ":0:5400",
    ])
  ).result;
  expect(defaultB.results[0].pending.remaining_seconds).toBe(5400);
  const added = (
    await run("clocks", [
      "add",
      "clock-exam",
      "--minutes",
      "7",
      "--target",
      ids[3] + ":0",
    ])
  ).result;
  expect(added.results[0]).toMatchObject({
    status: "pending",
    confirmed: false,
    pending: { extend_seconds: 420, remaining_seconds: 0 },
  });
  await expect(
    invoke("clocks", [
      "add",
      "cli-exam",
      "--minutes",
      "5",
      "--target",
      ids[0] + ":2",
    ]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("selected exam"),
  });
  await expect(
    invoke("clocks", ["reset", ids[2], "--minutes", "90", "--revision", "0"]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("unfinished"),
  });
  const decision = await postSigned("/api/agent/timing", {
    agent: "class",
    nonce: "c".repeat(64),
    at: Date.now(),
    attempt: native,
  });
  const timing = JSON.parse(Buffer.from(decision.payload, "base64").toString());
  expect(timing).toMatchObject({
    collect: false,
    reset: {
      reset_id: bulk.results[0].requestID,
      remaining_seconds: 7200,
      actor: "agent:class:root",
    },
  });
  expect(f.current.store.attempt(ids[1])).toEqual(beforeB);
  expect(f.current.store.attempt(ids[2]).state).toBe("COMPLETED");
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM clock_reset_requests")
      .get(),
  ).toEqual({ n: 5 });
  expect(
    JSON.stringify(
      f.current.store.db
        .prepare("SELECT outcome FROM agent_management_requests")
        .all(),
    ),
  ).not.toContain("PRIVATE-PAGE-HASH");
  expect(
    JSON.stringify(
      f.current.store.db
        .prepare("SELECT outcome FROM agent_management_requests")
        .all(),
    ),
  ).not.toContain("PRIVATE-UNRECOGNIZED-SETTINGS");
}
