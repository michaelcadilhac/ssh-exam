import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { managementOperations } from "../../packages/protocol/management.js";
import { RecoverySources } from "../../apps/server/src/recovery-source.js";

// Actual root-mapped CLI, private native files, signed HTTPS and shared browser
// administration. Terminal records are synthetic metadata, not kernel/collection
// qualification or a fresh archive-integrity claim.
export async function qualifyNativeRetirementCLI(
  f: any,
  binary: string,
  configPath: string,
  creation: string[],
  run: (
    file: string,
    args: string[],
    options: any,
  ) => Promise<{ stdout: string; stderr: string }>,
  corrupt: (mode: "drop" | "scope" | null) => void,
) {
  f.config.agent.managementOperations = [...managementOperations];
  const nativeState = f.dir + "/retirement-native-state",
    work = f.dir + "/retirement-work";
  for (const path of [nativeState, work]) mkdirSync(path, { mode: 0o700 });
  const configuration = JSON.parse(readFileSync(configPath, "utf8"));
  configuration.state = nativeState;
  configuration.work = work;
  const nativeConfig = f.dir + "/retirement-native.json";
  writeFileSync(nativeConfig, JSON.stringify(configuration), { mode: 0o600 });
  const state: any = { attempts: {}, capabilities: {}, registrations: {} };
  const save = () =>
    writeFileSync(nativeState + "/state.json", JSON.stringify(state), {
      mode: 0o600,
    });
  writeFileSync(
    nativeState + "/initialized",
    "Native initialized synthetic authority\n",
    { mode: 0o600 },
  );
  save();
  const cli = async (args: string[]) =>
    run(
      "/usr/bin/unshare",
      [
        "--user",
        "--map-root-user",
        binary,
        "--config",
        nativeConfig,
        "web",
        "exams",
        ...args,
      ],
      { timeout: 20000 },
    );
  const native = async (args: string[]) =>
    run(
      "/usr/bin/unshare",
      ["--user", "--map-root-user", binary, "--config", nativeConfig, ...args],
      { timeout: 20000 },
    );
  const value = async (args: string[]) =>
    JSON.parse((await cli(args)).stdout).result;
  const make = async (exam: string) => {
    await cli(creation.map((v) => (v === "cli-exam" ? exam : v)));
    f.current.store.db
      .prepare("UPDATE exam_lifecycle SET legacy_unreconciled=1 WHERE exam=?")
      .run(exam);
  };
  const preview = (exam: string, action = "archive") =>
    value(["retire-preview", exam, "--action", action]);
  const observe = async (exam: string) => {
    const path = f.dir + "/evidence-" + randomUUID() + ".json";
    await cli(["native-review", exam, "--out", path]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path).uid).toBe(process.getuid!());
    return path;
  };
  const reconcile = (
    exam: string,
    review: any,
    file: string,
    request = randomUUID(),
  ) => [
    "reconcile-native",
    exam,
    "--action",
    review.action,
    "--revision",
    review.revision,
    "--review",
    review.review,
    "--evidence",
    file,
    "--reason",
    "Reviewed exact terminal native dependencies",
    "--request",
    request,
  ];
  const retire = (exam: string, review: any) => [
    review.action,
    exam,
    "--revision",
    review.revision,
    "--review",
    review.review,
    "--reason",
    "Reviewed retirement preserving original history",
  ];

  // Positive empty authority; no raw flag clearing. Lost response/restart retries
  // exactly the same file and request, despite later observation expiry.
  const unused = "native-retire-unused";
  await make(unused);
  const blocked = await preview(unused, "delete");
  expect(blocked.allowed).toBe(false);
  expect(blocked.blockers.join(" ")).toContain("native-review");
  const file = await observe(unused),
    args = reconcile(unused, blocked, file);
  f.config.agent.managementOperations =
    f.config.agent.managementOperations.filter(
      (s: string) => s !== "exams.native-reconcile",
    );
  await expect(cli(args)).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("managementOperations"),
  });
  f.config.agent.managementOperations = [...managementOperations];
  corrupt("scope");
  await expect(cli(args)).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("scope/evidence mismatch"),
  });
  corrupt("drop");
  await expect(cli(args)).rejects.toMatchObject({ code: 1, stdout: "" });
  corrupt(null);
  await f.restart();
  const acknowledged = await value(args);
  expect(acknowledged).toMatchObject({
    id: unused,
    attempts: 0,
    permissions: 0,
    released_retentions: 0,
  });
  expect(await value(args)).toEqual(acknowledged);
  const fresh = await preview(unused, "delete");
  expect(fresh.allowed).toBe(true);
  expect(fresh.review).not.toBe(blocked.review);
  await expect(cli(retire(unused, blocked))).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("changed"),
  });
  expect((await value(retire(unused, fresh))).lifecycle).toBe("deleted");
  expect(
    f.current.store.db
      .prepare("SELECT legacy_unreconciled FROM exam_lifecycle WHERE exam=?")
      .get(unused),
  ).toEqual({ legacy_unreconciled: 1 });
  await make(unused);
  expect(await value(args)).toEqual(acknowledged);
  expect((await preview(unused, "delete")).native.status).toBe("stale");
  expect((await preview(unused, "delete")).allowed).toBe(false);
  expect(() =>
    f.current.store.db.prepare("DELETE FROM exams WHERE id=?").run(unused),
  ).toThrow("Definition has unreconciled authority/history");

  // Native-only history survives with no gateway attempt row. Even a later
  // stale/empty report cannot remove the historical deletion fence.
  const history = "native-retire-history",
    id = randomUUID(),
    start = Date.now() - 1800000;
  await make(history);
  state.attempts[id] = {
    id,
    exam: history,
    username: "synthetic",
    uid: 29999,
    state: "COMPLETED",
    start,
    deadline: start + 600000,
    original_deadline: start + 600000,
    ended: start + 600000,
    protected: true,
    checksum: "b".repeat(64),
    access_state: "RELEASED",
    policy_state: "NORMAL",
    units: [],
    collection_job: "historical-collector-epoch",
    errors: ["Historical successful collection retry"],
  };
  save();
  const original = readFileSync(nativeState + "/state.json");
  const hFile = await observe(history),
    hReview = await preview(history);
  await value(reconcile(history, hReview, hFile));
  expect((await preview(history, "delete")).allowed).toBe(false);
  const session = f.current.store.session("admin", "synthetic-reviewer", null);
  const admin = async (url: string, payload: any) =>
    f.current.app.inject({
      method: "POST",
      url,
      headers: {
        origin: f.config.origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      payload,
    });
  const browserPreview = await admin(
    `/api/admin/exams/${history}/retirement-preview`,
    { action: "archive" },
  );
  expect(browserPreview.statusCode, browserPreview.body).toBe(200);
  expect(browserPreview.json().allowed).toBe(true);
  const approved = browserPreview.json();
  const archived = await admin(`/api/admin/exams/${history}/retire`, {
    action: "archive",
    revision: approved.revision,
    review: approved.review,
    reason: "Archive verified native-only historical work",
    requestID: randomUUID(),
  });
  expect(archived.statusCode, archived.body).toBe(200);
  expect(archived.json().lifecycle).toBe("archived");
  expect(readFileSync(nativeState + "/state.json")).toEqual(original);
  expect(
    f.current.store.db.prepare("SELECT id FROM attempts WHERE id=?").get(id),
  ).toBeUndefined();
  await value(retire(history, await preview(history, "unarchive")));
  const next = await value(["show", history]);
  await value([
    "update",
    history,
    "--revision",
    next.revision,
    "--name",
    "Changed future definition",
  ]);
  expect((await preview(history)).allowed).toBe(false);
  expect((await preview(history, "delete")).allowed).toBe(false);
  const lostHistory = f.dir + "/missing-known-history.json";
  const emptyNative = JSON.parse(readFileSync(hFile, "utf8"));
  emptyNative.attempts = [];
  emptyNative.observed_at = Date.now();
  writeFileSync(lostHistory, JSON.stringify(emptyNative), { mode: 0o600 });
  await expect(
    cli(reconcile(history, await preview(history), lostHistory)),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining(
      "Previously acknowledged native history is missing",
    ),
  });
  expect(
    f.current.store.db
      .prepare(
        "SELECT has_history FROM exam_native_reconciliations WHERE exam=?",
      )
      .get(history),
  ).toEqual({ has_history: 1 });

  // Rejected native observation: live account hold, orphan durable work and
  // unpublished source data each refuse before creating an evidence file.
  const refused = f.dir + "/refused-evidence.json";
  state.attempts[id].access_state = "HELD";
  save();
  await expect(
    cli(["native-review", history, "--out", refused]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("not positively closed"),
  });
  expect(existsSync(refused)).toBe(false);
  state.attempts[id].access_state = "RELEASED";
  save();
  const orphan = work + "/" + randomUUID();
  mkdirSync(orphan, { mode: 0o700 });
  await expect(
    cli(["native-review", history, "--out", refused]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("unknown workspace"),
  });
  // Remove only this newly authored, empty synthetic orphan, never history.
  rmdirSync(orphan);
  mkdirSync(nativeState + "/source-retentions", { mode: 0o700 });
  const unpublished = nativeState + "/source-retentions/.pending-synthetic";
  writeFileSync(unpublished, "{}", { mode: 0o600 });
  await expect(
    cli(["native-review", history, "--out", refused]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("unpublished saved-source metadata"),
  });
  expect(existsSync(refused)).toBe(false);
  unlinkSync(unpublished);
  rmdirSync(nativeState + "/source-retentions");

  // An old saved-source expectation is preserved and matched to the permanent
  // cancellation receipt. Source bytes/old allowance are neither edited nor read
  // as a fresh archive verification by retirement.
  const saved = "native-retire-saved",
    source = randomUUID();
  await make(saved);
  state.attempts[source] = {
    ...state.attempts[id],
    id: source,
    exam: "synthetic-source",
  };
  save();
  for (const path of [
    nativeState + "/recovery-preparations",
    nativeState + "/recovery-preparations/" + saved,
  ])
    mkdirSync(path, { mode: 0o700 });
  const permission = {
    exam: saved,
    username: "synthetic",
    uid: 29999,
    duration: 3600,
    source_attempt: source,
    checksum: "b".repeat(64),
    created_at: Date.now(),
    reason: "Synthetic old unused saved-work permission",
  };
  const legacyPath =
    nativeState + "/recovery-preparations/" + saved + "/synthetic.json";
  writeFileSync(legacyPath, JSON.stringify(permission), { mode: 0o600 });
  const { reason: _reason, ...receipt } = permission;
  new RecoverySources(f.current.store, "class").remember({
    version: 1,
    ...receipt,
    grant_hash: "c".repeat(64),
    allowance_revision: null,
  });
  const expected = f.current.store.db
    .prepare("SELECT * FROM recovery_grant_sources WHERE exam=?")
    .get(saved);
  await expect(
    cli(["native-review", saved, "--out", refused]),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("unused, uncertain or pending"),
  });
  const cancel = JSON.parse(
    (await native(["recovery-grants", "revoke-preview", saved, "synthetic"]))
      .stdout,
  );
  expect(cancel.eligible).toBe(true);
  await native([
    "recovery-grants",
    "revoke",
    saved,
    "synthetic",
    "--review",
    cancel.review,
    "--reason",
    "Cancel confirmed unused permission before retirement",
  ]);
  const cancelled = readFileSync(legacyPath);
  const sFile = await observe(saved),
    sReview = await preview(saved);
  const mismatched = f.dir + "/mismatched-source-evidence.json";
  const badSource = JSON.parse(readFileSync(sFile, "utf8"));
  badSource.permissions[0].checksum = "c".repeat(64);
  writeFileSync(mismatched, JSON.stringify(badSource), { mode: 0o600 });
  await expect(
    cli(reconcile(saved, sReview, mismatched)),
  ).rejects.toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining(
      "lacks matching terminal native permission",
    ),
  });
  expect(
    f.current.store.db
      .prepare("SELECT * FROM exam_native_reconciliations WHERE exam=?")
      .get(saved),
  ).toBeUndefined();
  await value(reconcile(saved, sReview, sFile));
  expect((await preview(saved)).allowed).toBe(true);
  await value(retire(saved, await preview(saved)));
  expect(readFileSync(legacyPath)).toEqual(cancelled);
  expect(
    f.current.store.db
      .prepare("SELECT * FROM recovery_grant_sources WHERE exam=?")
      .get(saved),
  ).toEqual(expected);
  expect(
    f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
  ).toEqual({ n: 9 });
}
