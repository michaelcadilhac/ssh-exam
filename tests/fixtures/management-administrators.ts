import { expect } from "vitest";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";

// Actual compiled CLI -> private user-namespace root -> pinned local TLS -> real
// gateway, durable intents and restart. No password arguments/environment/files.
export async function qualifyAdministratorCLI(
  f: any,
  binary: string,
  configPath: string,
  invoke: (
    category: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>,
  corrupt: (mode: "drop" | "scope" | "refusal" | null) => void,
) {
  f.config.agent.managementOperations.push(
    "administrators.list",
    "administrators.show",
    "administrators.create",
  );
  const create = (username: string, password: string, request = randomUUID()) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const args = [
        "--user",
        "--map-root-user",
        binary,
        "--config",
        configPath,
        "web",
        "administrators",
        "create",
        username,
        "--password-stdin",
        "--request",
        request,
      ];
      const child = execFile(
        "/usr/bin/unshare",
        args,
        { timeout: 20000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          expect(child.spawnargs.join(" ")).not.toContain(password);
          if (error) reject(Object.assign(error, { stdout, stderr }));
          else resolve({ stdout, stderr });
        },
      );
      child.stdin!.on("error", () => {});
      child.stdin!.end(Buffer.from(password, "utf8"));
    });
  const call = async (args: string[]) =>
    JSON.parse((await invoke("administrators", args)).stdout);
  const password = "compiled-cli-synthetic-password",
    request = randomUUID();
  const original = JSON.parse(
    (await create("cli_admin_a", password, request)).stdout,
  );
  expect(original).toMatchObject({
    confirmed: true,
    operation: "administrators.create",
    request,
    result: { username: "cli_admin_a" },
  });
  await f.restart();
  expect(
    JSON.parse((await create("cli_admin_a", password, request)).stdout).result,
  ).toEqual(original.result);
  await expect(
    create("cli_admin_a", "different-synthetic-password", request),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringMatching(/conflicts[\s\S]*original password/),
  });
  await expect(
    create("cli_admin_a", "replacement-synthetic-password"),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("already exists"),
  });
  const account = f.current.store.db
    .prepare("SELECT hash FROM admins WHERE username='cli_admin_a'")
    .get() as any;
  expect(await argon2.verify(account.hash, password)).toBe(true);
  expect((await call(["show", "cli_admin_a"])).result).toEqual({
    username: "cli_admin_a",
    role: "admin",
  });
  await create("cli_admin_b", "exact-stdin-newline-secret\n");
  const newline = f.current.store.db
    .prepare("SELECT hash FROM admins WHERE username='cli_admin_b'")
    .get() as any;
  expect(
    await argon2.verify(newline.hash, "exact-stdin-newline-secret\n"),
  ).toBe(true);
  expect(await argon2.verify(newline.hash, "exact-stdin-newline-secret")).toBe(
    false,
  );
  await create("cli_admin_c", "😀".repeat(6));
  await create("cli_admin_d", "a".repeat(1024));
  for (const invalid of [
    "short",
    "😀".repeat(5),
    "😀".repeat(513),
    "a".repeat(4097),
  ]) {
    const id = randomUUID();
    await expect(
      create("invalid_cli_admin", invalid, id),
    ).rejects.toMatchObject({ code: 1, stdout: "" });
    expect(
      f.current.store.db
        .prepare("SELECT * FROM agent_management_requests WHERE request=?")
        .get(id),
    ).toBeUndefined();
  }
  expect((await call(["list", "--limit", "2"])).result).toEqual({
    administrators: [{ username: "cli_admin_a" }, { username: "cli_admin_b" }],
    next: "cli_admin_b",
  });
  expect(
    (await call(["list", "--limit", "2", "--after", "cli_admin_b"])).result,
  ).toEqual({
    administrators: [{ username: "cli_admin_c" }, { username: "cli_admin_d" }],
    next: null,
  });
  for (const mode of ["drop", "scope", "refusal"] as const) {
    const id = randomUUID(),
      username = "cli_fault_" + mode;
    corrupt(mode);
    let failure: any;
    try {
      await create(username, "PRIVATE-ADMIN-PASSWORD-MUST-NOT-PRINT", id);
    } catch (error) {
      failure = error;
    } finally {
      corrupt(null);
    }
    expect(failure).toMatchObject({ code: 1, stdout: "" });
    expect(failure.stderr).not.toContain(
      "PRIVATE-ADMIN-PASSWORD-MUST-NOT-PRINT",
    );
    expect(
      JSON.parse(
        (await create(username, "PRIVATE-ADMIN-PASSWORD-MUST-NOT-PRINT", id))
          .stdout,
      ).result,
    ).toEqual({ username });
    expect(
      f.current.store.db
        .prepare("SELECT * FROM audit WHERE action='create-admin' AND target=?")
        .all(username),
    ).toHaveLength(1);
  }
  expect(f.logs()).not.toContain(password);
  expect(f.logs()).not.toContain(account.hash);
  expect(
    f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
  ).toEqual({ n: 0 });
}
