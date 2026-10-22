import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";

// Actual compiled root-mapped CLI -> ordinary native verifier -> real local TLS
// -> gateway/restart. Only the service-manager interface is adapted in private
// namespaces; this does NOT replace separate real kernel/privileged qualification.
export async function qualifyTemplateCLI(
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
  corrupt: (operation: string | null) => void,
) {
  f.config.agent.managementOperations.push(
    "templates.sync",
    "templates.list",
    "templates.show",
  );
  const state = f.dir + "/catalog-native-state",
    source = f.dir + "/catalog-source",
    adapter = f.dir + "/catalog-test-manager";
  mkdirSync(state, { mode: 0o700 });
  const sentinel =
    '{"attempts":{"synthetic":{"state":"ACTIVE","deadline":1234,"original_deadline":1234,"access_state":"HELD","protected":true}}}';
  writeFileSync(state + "/state.json", sentinel, { mode: 0o600 });
  mkdirSync(state + "/submissions", { mode: 0o700 });
  writeFileSync(state + "/submissions/protected", "PROTECTED-SYNTHETIC-BYTES", {
    mode: 0o600,
  });
  const configuration = JSON.parse(readFileSync(configPath, "utf8"));
  configuration.state = state;
  const nativeConfig = f.dir + "/catalog-native.json";
  writeFileSync(nativeConfig, JSON.stringify(configuration), { mode: 0o600 });
  copyFileSync("tests/fixtures/native-template-manager.py", adapter);
  chmodSync(adapter, 0o700);
  const user = String(statSync("/proc/self/ns/user").ino),
    mount = String(statSync("/proc/self/ns/mnt").ino);
  const native = (args: string[]) =>
    run(
      "/usr/bin/unshare",
      [
        "--user",
        "--map-root-user",
        "--mount",
        "/usr/bin/python3",
        "tests/fixtures/native-template-manager.py",
        "--enter",
        adapter,
        user,
        mount,
        binary,
        "--config",
        nativeConfig,
        "templates",
        ...args,
      ],
      { timeout: 20000 },
    );
  const packageAt = (base: string) => {
    mkdirSync(base, { mode: 0o700, recursive: true });
    chmodSync(base, 0o700);
    for (const dir of ["work", "materials"]) {
      mkdirSync(base + "/" + dir, { mode: 0o755 });
      chmodSync(base + "/" + dir, 0o755);
    }
    for (const [name, text] of [
      ["work/starter.txt", "SYNTHETIC STARTER"],
      ["materials/WELCOME.txt", "PRIVATE-SYNTHETIC-EXAM-TEXT [USER]"],
    ]) {
      writeFileSync(base + "/" + name, text, { mode: 0o644 });
      chmodSync(base + "/" + name, 0o644);
      utimesSync(base + "/" + name, 1700000000, 1700000000);
    }
    for (const dir of ["work", "materials", ""])
      utimesSync(base + (dir ? "/" + dir : ""), 1700000000, 1700000000);
  };
  packageAt(source);
  const validated = JSON.parse(
    (await native(["validate", source, "--file-mib", "1", "--total-mib", "2"]))
      .stdout,
  );
  const info = { ...validated.info, name: "cli-catalog" };
  // Published synthetic fixture, not a claimed install test. The installation
  // interface is separately exercised on disk-backed scratch by Go CLI tests.
  const version = state + "/template-catalog/versions/cli-catalog/" + info.hash;
  for (const path of [
    state + "/template-catalog/versions/cli-catalog",
    version,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  packageAt(version + "/content");
  writeFileSync(version + "/version.json", JSON.stringify(info), {
    mode: 0o600,
  });
  const id = randomUUID(),
    args = [
      "sync",
      info.name,
      info.hash,
      "--reason",
      "Reviewed synthetic verified source",
      "--request",
      id,
    ];
  const synced = JSON.parse((await native(args)).stdout);
  expect(synced).toMatchObject({
    action: "sync",
    request: id,
    local_verified: true,
    gateway_confirmed: true,
    local: { name: info.name, hash: info.hash },
    gateway: {
      acknowledgement: { request: id },
      source: { name: info.name, hash: info.hash },
    },
  });
  expect(JSON.stringify(synced)).not.toContain("PRIVATE-SYNTHETIC-EXAM-TEXT");
  expect(JSON.stringify(synced)).not.toContain(source);
  await f.restart();
  const retry = JSON.parse((await native(args)).stdout);
  expect(retry.gateway).toEqual(synced.gateway);
  const show = () => invoke("templates", ["show", info.name, info.hash]);
  expect(JSON.parse((await show()).stdout).result.source).toEqual(
    synced.gateway.source,
  );
  expect(
    JSON.parse(
      (await invoke("templates", ["list", "--name", info.name, "--limit", "1"]))
        .stdout,
    ).result.sources,
  ).toHaveLength(1);
  corrupt("templates.show");
  try {
    await expect(show()).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("scope/bounds"),
    });
  } finally {
    corrupt(null);
  }
  const lost = randomUUID(),
    lostArgs = [...args.slice(0, -1), lost];
  corrupt("templates.sync");
  try {
    await expect(native(lostArgs)).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("scope/bounds"),
    });
  } finally {
    corrupt(null);
  }
  const recovered = JSON.parse((await native(lostArgs)).stdout);
  expect(recovered.gateway.acknowledgement.request).toBe(lost);
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='template-source-attested' AND detail LIKE ?",
      )
      .get("%" + lost + "%"),
  ).toEqual({ n: 1 });
  const utf8 = JSON.parse(
    (await native(["sync", info.name, info.hash, "--reason", "éééé"])).stdout,
  );
  expect(utf8.gateway_confirmed).toBe(true);
  writeFileSync(
    version + "/content/work/starter.txt",
    "DAMAGED SYNTHETIC SOURCE",
  );
  const sentBefore = f.current.store.db
    .prepare(
      "SELECT count(*) n FROM agent_management_requests WHERE outcome LIKE '%cli-catalog%'",
    )
    .get();
  await expect(
    native([
      "sync",
      info.name,
      info.hash,
      "--reason",
      "Refuse corrupted installed bytes",
    ]),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("no new gateway attestation sent"),
  });
  expect(
    f.current.store.db
      .prepare(
        "SELECT count(*) n FROM agent_management_requests WHERE outcome LIKE '%cli-catalog%'",
      )
      .get(),
  ).toEqual(sentBefore);
  expect(readFileSync(state + "/state.json", "utf8")).toBe(sentinel);
  expect(readFileSync(state + "/submissions/protected", "utf8")).toBe(
    "PROTECTED-SYNTHETIC-BYTES",
  );
}
