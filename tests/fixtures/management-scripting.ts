import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { managementOperations } from "../../packages/protocol/management.js";

// Real zsh -> compiled root-mapped CLI -> real signed gateway, real protected
// archives/native pins. Historical attempts are authored synthetic fixtures;
// no SSH/account/cgroup enforcement is simulated or claimed by this test.
export async function qualifyScriptingCLI(
  f: any,
  binary: string,
  configPath: string,
  invoke: (
    category: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
  run: (
    file: string,
    args: string[],
    options: any,
  ) => Promise<{ stdout: string; stderr: string }>,
  loseSourceReply: (operation?: "preview" | "source") => void,
) {
  f.config.agent.managementOperations = [...managementOperations];
  const target = "scripting-midterm",
    recovery = "scripting-recovery";
  const get = async (category: string, args: string[]) =>
    JSON.parse((await invoke(category, args)).stdout).result;
  const earliest = new Date(Date.now() - 60000).toISOString(),
    latest = new Date(Date.now() + 3600000).toISOString();
  for (const exam of [target, recovery])
    await get("exams", [
      "create",
      exam,
      "--template",
      "v1",
      "--template-version",
      "a".repeat(64),
      "--earliest",
      earliest,
      "--latest",
      latest,
    ]);
  const definitions = {
    [target]: (await get("exams", ["show", target])).exam,
    [recovery]: (await get("exams", ["show", recovery])).exam,
  };
  const users = ["shell01", "shell02"],
    starterUsers = ["fresh01", "fresh02"];
  // These represent pre-grant historical enrollments, so no enrollment-time
  // grant is invented. Every source below actually has a native collected archive.
  for (const [index, user] of [...users, ...starterUsers].entries())
    f.current.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,webcam,duration) VALUES(?,?,?,?,?)",
      )
      .run(
        target,
        user,
        29901 + index,
        index === 0 || index === 3 ? 0 : index === 2 ? 1 : null,
        index === 0 ? 7200 : index === 2 ? 3600 : null,
      );
  const unstarted = randomUUID();
  f.current.store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,access_state,policy_state) VALUES(?,?,?,?,'CANCELLED_BEFORE_START',?,'RELEASED','NORMAL')",
    )
    .run(
      unstarted,
      target,
      starterUsers[1],
      29904,
      JSON.stringify(definitions[target]),
    );
  const unstartedHistory = f.current.store.attempt(unstarted);
  const ended = Date.now() - 3600000;
  const authored = [
    {
      id: randomUUID(),
      exam: target,
      username: users[0],
      uid: 29901,
      settings: definitions[target],
      start: ended - 10800000,
      deadline: ended - 7200000,
      content: "OLD-SYNTHETIC-WORK",
    },
    {
      id: randomUUID(),
      exam: recovery,
      username: users[0],
      uid: 29901,
      settings: definitions[recovery],
      start: ended - 3600000,
      deadline: ended,
      content: "LATEST-RECOVERY-SYNTHETIC-WORK",
    },
    {
      id: randomUUID(),
      exam: target,
      username: users[1],
      uid: 29902,
      settings: { ...definitions[target], webcam: !definitions[target].webcam },
      start: ended - 7200000,
      deadline: ended - 3600000,
      content: "LATEST-MIDTERM-SYNTHETIC-WORK",
    },
  ];
  const nativeConfig = f.dir + "/scripting-config.json",
    configuration = JSON.parse(readFileSync(configPath, "utf8"));
  configuration.state = f.dir + "/scripting-native";
  configuration.work = f.dir + "/scripting-work";
  writeFileSync(nativeConfig, JSON.stringify(configuration), { mode: 0o600 });
  const spec = f.dir + "/scripting-native-spec.json";
  writeFileSync(
    spec,
    JSON.stringify({ config: nativeConfig, attempts: authored }),
    { mode: 0o600 },
  );
  const fixtureBinary = f.dir + "/scripting-fixture";
  await run("go", ["test", "-c", "-o", fixtureBinary, "./cmd/examctl"], {
    cwd: "ssh-server",
    timeout: 30000,
    env: { ...process.env, CGO_ENABLED: "0" },
  });
  await run(
    "/usr/bin/unshare",
    [
      "--user",
      "--map-root-user",
      fixtureBinary,
      "-test.run=^TestPrepareScriptingNativeFixture$",
    ],
    {
      timeout: 15000,
      env: { ...process.env, EXAM_SCRIPTING_NATIVE_SPEC: spec },
    },
  );
  const native = JSON.parse(
    readFileSync(f.dir + "/scripting-native-result.json", "utf8"),
  );
  for (const row of authored) {
    const source = native.attempts[row.id];
    expect(source.protected).toBe(true);
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,policy_state) VALUES(?,?,?,?,'COMPLETED',?,?,?,?,?,1,?,'RELEASED','NORMAL')",
      )
      .run(
        row.id,
        row.exam,
        row.username,
        row.uid,
        JSON.stringify(row.settings),
        row.start,
        row.deadline,
        row.deadline,
        row.deadline,
        source.checksum,
      );
  }
  const history = authored.map((row) => f.current.store.attempt(row.id));
  const executeScript = (
    mode: "prepare" | "resume-review" | "apply",
    directory: string,
    extra: string[] = [],
    selectedExam = target,
    selectedSources = `${target} ${recovery}`,
  ) =>
    run(
      "/usr/bin/unshare",
      [
        "--user",
        "--map-root-user",
        "/usr/bin/zsh",
        "examples/second-go.zsh",
        mode,
        directory,
        ...extra,
      ],
      {
        timeout: 25000,
        env: {
          ...process.env,
          EXAMCTL_BIN: binary,
          EXAMCTL_CONFIG: nativeConfig,
          EXAMCTL_EXAM: selectedExam,
          EXAMCTL_SOURCE_EXAMS: selectedSources,
        },
      },
    );
  const directory = f.dir + "/scripting-run";
  loseSourceReply("preview");
  await expect(
    executeScript("prepare", directory, [earliest, latest]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.not.stringContaining("no started attempt"),
  });
  const preparedSelection = readFileSync(directory + "/sources.csv", "utf8");
  await expect(executeScript("apply", directory)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Preparation incomplete"),
  });
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
      .get(target),
  ).toEqual({ n: 0 });
  writeFileSync(directory + "/sources.csv", preparedSelection + "changed\n");
  await expect(executeScript("resume-review", directory)).rejects.toMatchObject(
    { code: 1, stderr: expect.stringContaining("Prepared inputs changed") },
  );
  writeFileSync(directory + "/sources.csv", preparedSelection);
  await f.restart();
  await executeScript("resume-review", directory);
  const selected = readFileSync(directory + "/sources.csv", "utf8");
  expect(selected).toBe(preparedSelection);
  expect(selected).toContain(
    `${users[0]},${authored[1].id},${native.attempts[authored[1].id].checksum},7200,false\n`,
  );
  expect(selected).toContain(
    `${users[1]},${authored[2].id},${native.attempts[authored[2].id].checksum},${definitions[target].duration},${definitions[target].webcam}\n`,
  );
  expect(selected).not.toContain(authored[0].id);
  const starters = readFileSync(directory + "/starters.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(starters).toEqual([
    {
      username: starterUsers[0],
      settings: { duration: 3600, webcam: true },
      work: { kind: "template", name: "v1", hash: "a".repeat(64) },
    },
    {
      username: starterUsers[1],
      settings: { duration: definitions[target].duration, webcam: false },
      work: { kind: "template", name: "v1", hash: "a".repeat(64) },
    },
  ]);
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
      .get(target),
  ).toEqual({ n: 0 });
  loseSourceReply();
  await expect(executeScript("apply", directory)).rejects.toMatchObject({
    code: 1,
  });
  await f.restart();
  await executeScript("apply", directory);
  const confirmed = JSON.parse(
    readFileSync(directory + "/issued.receipt", "utf8"),
  );
  expect(confirmed.outcome).toBe("confirmed");
  const issued = confirmed.result.result.issued;
  expect(issued).toHaveLength(2);
  const starterIssued = JSON.parse(
    readFileSync(directory + "/starter-issued.receipt", "utf8"),
  ).result.result.issued;
  expect(starterIssued).toHaveLength(2);
  for (const row of starterIssued) {
    const grant = await get("grants", ["show", row.grant]);
    expect(grant).toMatchObject({
      status: "AVAILABLE",
      revision: 1,
      work: { kind: "template", name: "v1", hash: "a".repeat(64) },
      settings: {
        duration:
          row.username === starterUsers[0]
            ? 3600
            : definitions[target].duration,
        webcam: row.username === starterUsers[0],
        earliest: Date.parse(earliest),
        latest: Date.parse(latest),
      },
    });
    expect(grant.claims).toHaveLength(0);
  }
  for (const row of issued) {
    const grant = await get("grants", ["show", row.grant]);
    expect(grant).toMatchObject({
      status: "AVAILABLE",
      revision: 1,
      settings:
        row.username === users[0]
          ? { duration: 7200, webcam: false }
          : {
              duration: definitions[target].duration,
              webcam: definitions[target].webcam,
            },
    });
    expect(grant.claims).toHaveLength(0);
  }
  await executeScript("apply", directory);
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
      .get(target),
  ).toEqual({ n: 4 });
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM grant_source_retentions WHERE grant_id IN (?,?)",
      )
      .get(issued[0].grant, issued[1].grant),
  ).toEqual({ n: 2 });
  for (const [index, row] of authored.entries())
    expect(f.current.store.attempt(row.id)).toEqual(history[index]);
  expect(f.current.store.attempt(unstarted)).toEqual(unstartedHistory);
  expect(
    JSON.parse(readFileSync(configuration.state + "/state.json", "utf8")),
  ).toEqual(native);

  // Old reviewed saved-only directories retain their exact intent. A new script
  // must not retroactively add starter students to an already reviewed batch.
  const legacyDirectory = f.dir + "/scripting-legacy-retry";
  mkdirSync(legacyDirectory, { mode: 0o700 });
  for (const name of [
    "review.receipt",
    "issued.receipt",
    "synchronization.receipt",
  ])
    copyFileSync(directory + "/" + name, legacyDirectory + "/" + name);
  await executeScript("resume-review", legacyDirectory);
  await executeScript("apply", legacyDirectory);
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
      .get(target),
  ).toEqual({ n: 4 });

  // Empty saved-group and empty starter-group are real public workflows too.
  for (const [selectedExam, selectedUsers] of [
    ["scripting-only-starters", starterUsers],
    ["scripting-only-saved", users],
  ] as const) {
    await get("exams", [
      "create",
      selectedExam,
      "--template",
      "v1",
      "--template-version",
      "a".repeat(64),
      "--earliest",
      earliest,
      "--latest",
      latest,
    ]);
    for (const user of selectedUsers) {
      const enrollment = f.current.store.db
        .prepare(
          "SELECT uid,duration,webcam FROM enrollments WHERE exam=? AND username=?",
        )
        .get(target, user) as any;
      f.current.store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES(?,?,?,?,?)",
        )
        .run(
          selectedExam,
          user,
          enrollment.uid,
          enrollment.duration,
          enrollment.webcam,
        );
    }
    const onlyDirectory = f.dir + "/" + selectedExam;
    const onlyKind = selectedUsers === starterUsers ? "starter" : "saved";
    await executeScript(
      "prepare",
      onlyDirectory,
      [earliest, latest],
      selectedExam,
    );
    expect(readFileSync(onlyDirectory + "/groups.tsv", "utf8")).toBe(
      onlyKind + "\n",
    );
    const pinsBefore = (
      f.current.store.db
        .prepare("SELECT count(*) n FROM grant_source_retentions")
        .get() as any
    ).n;
    await executeScript("apply", onlyDirectory, [], selectedExam);
    await executeScript("apply", onlyDirectory, [], selectedExam);
    const onlyReceipt = JSON.parse(
      readFileSync(
        onlyDirectory +
          (onlyKind === "starter"
            ? "/starter-issued.receipt"
            : "/issued.receipt"),
        "utf8",
      ),
    );
    expect(onlyReceipt.result.result.issued).toHaveLength(2);
    for (const item of onlyReceipt.result.result.issued) {
      const grant = await get("grants", ["show", item.grant]);
      expect(grant.status).toBe("AVAILABLE");
      expect(grant.work.kind).toBe(
        onlyKind === "starter" ? "template" : "saved",
      );
      expect(grant.claims).toHaveLength(0);
    }
    expect(
      f.current.store.db
        .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
        .get(selectedExam),
    ).toEqual({ n: 2 });
    expect(
      (
        f.current.store.db
          .prepare("SELECT count(*) n FROM grant_source_retentions")
          .get() as any
      ).n,
    ).toBe(pinsBefore + (onlyKind === "saved" ? 2 : 0));
  }

  // A real started-but-unprotected source refuses instead of obtaining starter
  // files; a later equal-time ambiguity also refuses before any grant review.
  const strictExam = "scripting-strict-source",
    strictUser = "strict01",
    strictStart = ended - 1000;
  await get("exams", [
    "create",
    strictExam,
    "--template",
    "v1",
    "--template-version",
    "a".repeat(64),
    "--earliest",
    earliest,
    "--latest",
    latest,
  ]);
  f.current.store.db
    .prepare("INSERT INTO enrollments(exam,username,uid) VALUES(?,?,?)")
    .run(strictExam, strictUser, 29905);
  const insertStrict = (checksum: string, sourceExam = strictExam) =>
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,policy_state) VALUES(?,?,?,?,'COMPLETED',?,?,?,?,?,0,?,'RELEASED','NORMAL')",
      )
      .run(
        randomUUID(),
        sourceExam,
        strictUser,
        29905,
        JSON.stringify({ ...definitions[target], id: sourceExam }),
        strictStart,
        ended,
        ended,
        ended,
        checksum,
      );
  insertStrict("");
  await expect(
    executeScript(
      "prepare",
      f.dir + "/strict-missing-source",
      [earliest, latest],
      strictExam,
      strictExam,
    ),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("no starter/older-work fallback"),
  });
  insertStrict("e".repeat(64), recovery);
  await expect(
    executeScript(
      "prepare",
      f.dir + "/strict-tie",
      [earliest, latest],
      strictExam,
      `${strictExam} ${recovery}`,
    ),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("ambiguous latest attempt"),
  });
  expect(
    f.current.store.db
      .prepare("SELECT count(*) n FROM attempt_grants WHERE exam=?")
      .get(strictExam),
  ).toEqual({ n: 0 });

  // The same shared review accepts explicit per-student accommodations without
  // mutating defaults or old attempt settings. CSV is directly shell-friendly.
  const inputs = f.dir + "/scripting-allowances.csv";
  writeFileSync(
    inputs,
    `username,attempt,checksum,duration_seconds,require_webcam\n${users[0]},${authored[1].id},${native.attempts[authored[1].id].checksum},6000,true\n${users[1]},${authored[2].id},${native.attempts[authored[2].id].checksum},7200,false\n`,
    { mode: 0o600 },
  );
  const preview = await get("grants", [
    "additional-preview",
    target,
    "--input",
    inputs,
    "--definition-revision",
    (await get("exams", ["show", target])).revision,
    "--template-version",
    "a".repeat(64),
    "--earliest",
    earliest,
    "--latest",
    latest,
    "--reason",
    "Explicit synthetic per-student accommodations",
  ]);
  expect(
    preview.rows.map((row: any) => [
      row.username,
      row.settings.duration,
      row.settings.webcam,
    ]),
  ).toEqual([
    [users[0], 6000, true],
    [users[1], 7200, false],
  ]);
  const accommodated = await get("grants", [
    "issue-confirm",
    preview.id,
    "--revision",
    preview.revision,
  ]);
  for (const row of accommodated.issued) {
    expect((await get("grants", ["show", row.grant])).status).toBe(
      "PENDING_NATIVE",
    );
    await get("grants", [
      "source-sync",
      row.grant,
      "--revision",
      "1",
      "--config",
      nativeConfig,
    ]);
    const grant = await get("grants", ["show", row.grant]);
    expect(grant.settings).toMatchObject(
      row.username === users[0]
        ? { duration: 6000, webcam: true }
        : { duration: 7200, webcam: false },
    );
    expect(grant.status).toBe("AVAILABLE");
    expect(grant.claims).toHaveLength(0);
  }
  for (const [index, row] of authored.entries())
    expect(f.current.store.attempt(row.id)).toEqual(history[index]);
}
