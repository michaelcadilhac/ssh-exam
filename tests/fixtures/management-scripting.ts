import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
  const users = ["shell01", "shell02"];
  // These represent pre-grant historical enrollments, so no enrollment-time
  // grant is invented. Every source below actually has a native collected archive.
  for (const [index, user] of users.entries())
    f.current.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,webcam,duration) VALUES(?,?,?,?,?)",
      )
      .run(
        target,
        user,
        29901 + index,
        index === 0 ? 0 : null,
        index === 0 ? 7200 : null,
      );
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
          EXAMCTL_EXAM: target,
          EXAMCTL_SOURCE_EXAMS: `${target} ${recovery}`,
        },
      },
    );
  const directory = f.dir + "/scripting-run";
  loseSourceReply("preview");
  await expect(
    executeScript("prepare", directory, [earliest, latest]),
  ).rejects.toMatchObject({ code: 1 });
  const preparedSelection = readFileSync(directory + "/sources.csv", "utf8");
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
  ).toEqual({ n: 2 });
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM grant_source_retentions WHERE grant_id IN (?,?)",
      )
      .get(issued[0].grant, issued[1].grant),
  ).toEqual({ n: 2 });
  for (const [index, row] of authored.entries())
    expect(f.current.store.attempt(row.id)).toEqual(history[index]);
  expect(
    JSON.parse(readFileSync(configuration.state + "/state.json", "utf8")),
  ).toEqual(native);

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
