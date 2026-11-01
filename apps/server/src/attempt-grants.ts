import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { examSchema } from "../../../packages/protocol/index.js";
import { observeNativeMonitoring } from "./native-monitoring-state.js";
import {
  isSandbox,
  hasSandboxWindow,
} from "../../../packages/protocol/sandbox.js";
import {
  grantBinding,
  grantList,
  grantShow,
  grantRevision,
  grantRevocation,
  grantBeginRequest,
  grantWorkspace,
  grantSourceRequest,
  grantSourceConfirmation,
} from "../../../packages/protocol/grants.js";
import { hash, now, type Store, type Attempt } from "./db.js";
import { TemplateCatalog } from "./template-catalog.js";
import { enqueueSourceSetup } from "./source-setup.js";
import { ExamDefinitions } from "./exam-definitions.js";
import {
  monitoringOwner,
  monitoringBootstrap,
  type MonitoringOwner,
  type MonitoringBootstrap,
} from "../../../packages/protocol/monitoring-evidence.js";

const conflict = (message: string, code?: string): never => {
  throw Object.assign(Error(message), {
    statusCode: 409,
    ...(code ? { code } : {}),
  });
};
// Real callers: shared enrollment/CSV, shared web/root management, student
// preflight/Begin, signed native verification and positive lifecycle receipts.
export class AttemptGrants {
  constructor(
    private store: Store,
    private agent: string,
  ) {}
  // The only runtime caller is the explicitly authorized root management
  // synchronization workflow, never a browser's claimed native receipt.
  sourcePlan(input: unknown) {
    const b = grantSourceRequest.parse(input),
      current = this.row(b.id),
      revision = this.store.db
        .prepare(
          "SELECT * FROM grant_revisions WHERE grant_id=? AND revision=?",
        )
        .get(b.id, b.revision) as any;
    if (!revision)
      return conflict(
        "Grant revision not found; inspect its retained history before source synchronization",
      );
    const snapshot = this.view({
        ...current,
        ...revision,
        revision: b.revision,
      }),
      work = snapshot.work;
    if (work.kind !== "saved")
      return conflict(
        "This revision has no saved-work source; select its original saved-source revision for retention reconciliation",
      );
    const source = this.store.attempt(work.attempt),
      retain =
        current.revision === b.revision &&
        ["PENDING_NATIVE", "AVAILABLE"].includes(current.status);
    if (retain)
      new ExamDefinitions(this.store, this.agent).requireActive(current.exam);
    if (
      !source ||
      source.username !== current.username ||
      !Number.isSafeInteger(source.uid) ||
      source.uid < 1000 ||
      source.checksum !== work.checksum ||
      (retain &&
        (source.state !== "COMPLETED" ||
          !source.protected ||
          !source.start ||
          !source.original_deadline))
    )
      return conflict(
        "Source identity/protection differs from issued authority; preserve source and grant history; no retention acknowledgement or fallback accepted",
      );
    return {
      version: 1,
      agent: this.agent,
      grant: this.binding(snapshot),
      exam: current.exam,
      username: current.username,
      uid: source.uid,
      settings: snapshot.settings,
      source: { attempt: work.attempt, checksum: work.checksum },
      action: retain ? "retain" : "release",
      current_revision: current.revision,
      status: current.status,
    };
  }
  confirmSource(input: unknown, actor: string) {
    const b = grantSourceConfirmation.parse(input);
    return this.store.db.transaction(() => {
      const plan = this.sourcePlan({ id: b.id, revision: b.revision });
      if (
        b.grant_hash !== plan.grant.hash ||
        b.source.attempt !== plan.source.attempt ||
        b.source.checksum !== plan.source.checksum ||
        b.source.uid !== plan.uid ||
        b.retained_at > now() + 1000 ||
        (b.state === "RETAINED") !== (plan.action === "retain")
      )
        return conflict(
          "Native retention confirmation is stale or differs from the exact grant/source; retry source-sync for the SAME revision after inspecting current history",
        );
      const old = this.store.db
        .prepare(
          "SELECT * FROM grant_source_retentions WHERE grant_id=? AND revision=?",
        )
        .get(b.id, b.revision) as any;
      if (
        old &&
        (old.grant_hash !== b.grant_hash ||
          old.source_attempt !== b.source.attempt ||
          old.checksum !== b.source.checksum ||
          old.uid !== b.source.uid ||
          old.metadata_hash !== b.source.metadata_hash ||
          old.retention_hash !== b.retention_hash ||
          old.retained_at !== b.retained_at ||
          (old.state === "RELEASED" && b.state !== "RELEASED"))
      )
        return conflict(
          "Native retention identity changed; preserve both receipts and inspect source-show; do not overwrite a pin or revive released authority",
        );
      this.store.db
        .prepare(
          "INSERT INTO grant_source_retentions VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(grant_id,revision) DO UPDATE SET state=excluded.state,acknowledged_at=excluded.acknowledged_at",
        )
        .run(
          b.id,
          b.revision,
          b.grant_hash,
          b.source.attempt,
          b.source.checksum,
          b.source.uid,
          b.source.metadata_hash,
          b.retention_hash,
          b.retained_at,
          b.state,
          now(),
        );
      if (b.state === "RETAINED")
        this.store.db
          .prepare(
            "UPDATE attempt_grants SET status='AVAILABLE' WHERE id=? AND revision=? AND status='PENDING_NATIVE'",
          )
          .run(b.id, b.revision);
      this.store.audit(
        actor,
        "native-grant-source-" + b.state.toLowerCase(),
        b.id,
        JSON.stringify({
          revision: b.revision,
          retention_hash: b.retention_hash,
        }),
      );
      return {
        id: b.id,
        revision: b.revision,
        state: b.state,
        retention_hash: b.retention_hash,
        status: this.row(b.id).status,
      };
    })();
  }
  private row(id: string): any {
    z.string().uuid().parse(id);
    const row = this.store.db
      .prepare(
        "SELECT g.rowid AS issuance_order,g.*,r.settings,r.work,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.id=? AND g.agent=?",
      )
      .get(id, this.agent);
    if (!row)
      return conflict(
        "Grant not found for this class agent; inspect examctl web grants list EXAM",
      );
    return row;
  }
  private view(row: any) {
    if (
      row.initial_grant &&
      (row.issuance !== "ADDITIONAL_TEMPLATE" ||
        !this.store.db
          .prepare(
            "SELECT 1 FROM attempt_grants WHERE id=? AND agent=? AND exam=? AND username=? AND issuance IN ('ENROLLMENT','REVIEWED_NEW') AND rowid<?",
          )
          .get(
            row.initial_grant,
            this.agent,
            row.exam,
            row.username,
            row.issuance_order,
          ))
    )
      return conflict(
        "Additional grant's original initial authority is inconsistent; preserve grant/attempt history before admission",
      );
    const settings = examSchema.parse(JSON.parse(row.settings)),
      work = grantWorkspace.parse(JSON.parse(row.work));
    if (
      ![
        "ENROLLMENT",
        "REVIEWED_NEW",
        "ADDITIONAL_TEMPLATE",
        "PRACTICE",
      ].includes(row.issuance) ||
      !Number.isSafeInteger(row.issuance_order) ||
      row.issuance_order < 1 ||
      isSandbox(row.exam) !== (row.issuance === "PRACTICE") ||
      (isSandbox(row.exam) &&
        (settings.duration !== 300 ||
          settings.webcam ||
          settings.terminals !== 4 ||
          !hasSandboxWindow(settings))) ||
      !settings.template_version ||
      hash(JSON.stringify({ settings, work })) !== row.hash
    )
      return conflict(
        "Grant snapshot is inconsistent; preserve revisions/history and restore matching authority before admission",
      );
    grantBinding.parse({ id: row.id, revision: row.revision, hash: row.hash });
    return {
      id: row.id,
      agent: row.agent,
      exam: row.exam,
      username: row.username,
      revision: row.revision,
      status: row.status,
      issued_at: row.issued_at,
      actor: row.actor,
      reason: row.reason,
      issuance: row.issuance,
      issuance_order: row.issuance_order,
      initial_grant: row.initial_grant,
      hash: row.hash,
      settings,
      work,
      claims: this.store.db
        .prepare(
          "SELECT attempt,revision,hash,uid,state,created_at,ended_at FROM grant_claims WHERE grant_id=? ORDER BY state<>'CANCELLED' DESC,created_at DESC LIMIT 100",
        )
        .all(row.id),
    };
  }
  snapshot(input: unknown, selectedWork?: unknown, username?: string) {
    const settings = examSchema.parse(input);
    if (
      isSandbox(settings.id) &&
      (settings.duration !== 300 ||
        settings.webcam ||
        settings.terminals !== 4 ||
        !hasSandboxWindow(settings))
    )
      return conflict(
        "Sandbox practice grants require exactly five minutes, no webcam, four terminals and a finite explicit Begin window; inspect web exams show sandbox. No authority changed.",
      );
    if (!settings.template_version)
      return conflict(
        "Choose a published version of the exam files in Exam defaults before allowing an attempt. No attempt or enrollment changed.",
      );
    new TemplateCatalog(this.store, this.agent).show({
      name: settings.template,
      hash: settings.template_version,
    });
    const work = grantWorkspace.parse(
      selectedWork ?? {
        kind: "template",
        name: settings.template,
        hash: settings.template_version,
      },
    );
    if (work.kind === "template")
      new TemplateCatalog(this.store, this.agent).show({
        name: work.name,
        hash: work.hash,
      });
    if (work.kind === "saved") {
      const source = this.store.attempt(work.attempt);
      if (
        !username ||
        !source ||
        source.username !== username ||
        !Number.isSafeInteger(source.uid) ||
        source.uid < 1000 ||
        source.state !== "COMPLETED" ||
        !source.protected ||
        source.checksum !== work.checksum ||
        !source.start ||
        !source.deadline ||
        !source.original_deadline
      )
        return conflict(
          "Choose this student's completed attempt with confirmed protected files. Refresh saved work and review again. No different files were used, no account was reserved and no exam time started.",
        );
    }
    return { settings, work, hash: hash(JSON.stringify({ settings, work })) };
  }
  initial(
    exam: string,
    username: string,
    duration: number | null,
    webcam: boolean | null,
    actor: string,
    window?: { earliest: number; latest: number },
  ) {
    if (isSandbox(exam)) return null; // Repeatable practice issues at authenticated preflight.
    if (!this.store.db.inTransaction)
      throw Error(
        "Initial issuance requires its shared enrollment/import transaction; no partial grant authorized",
      );
    const old = this.store.db
      .prepare(
        "SELECT id FROM attempt_grants WHERE agent=? AND exam=? AND username=? AND issuance IN ('ENROLLMENT','REVIEWED_NEW')",
      )
      .get(this.agent, exam, username) as any;
    if (old) return this.view(this.row(old.id)); // Re-enrollment never invents another allowance.
    if (
      this.store.db
        .prepare("SELECT 1 FROM attempts WHERE exam=? AND username=?")
        .get(exam, username)
    )
      return null; // Legacy history needs explicit C13/additional issuance, never backfill.
    const definition = JSON.parse(
      (
        this.store.db
          .prepare("SELECT config FROM exams WHERE id=?")
          .get(exam) as any
      ).config,
    );
    const value = this.snapshot({
      ...definition,
      earliest: window?.earliest ?? definition.earliest,
      latest: window?.latest ?? definition.latest,
      duration: duration ?? definition.duration,
      webcam: webcam ?? definition.webcam,
    });
    return this.issueGrant(
      exam,
      username,
      value,
      actor,
      "Initial ordinary grant at enrollment",
    );
  }
  reviewedInitial(
    settings: unknown,
    username: string,
    actor: string,
    reason: string,
  ) {
    if (!this.store.db.inTransaction)
      throw Error("Reviewed issuance requires its confirmation transaction");
    const value = this.snapshot(settings),
      exam = value.settings.id;
    if (
      isSandbox(exam) ||
      !this.store.db
        .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
        .get(exam, username) ||
      this.store.db
        .prepare("SELECT 1 FROM attempt_grants WHERE exam=? AND username=?")
        .get(exam, username) ||
      this.store.db
        .prepare("SELECT 1 FROM attempts WHERE exam=? AND username=?")
        .get(exam, username)
    )
      return conflict(
        "Reviewed initial issuance requires an enrolled ordinary student with no grant or attempt history; inspect existing authority, never replace it",
      );
    return this.issueGrant(
      exam,
      username,
      value,
      actor,
      reason,
      "REVIEWED_NEW",
    );
  }
  additional(
    settings: unknown,
    username: string,
    actor: string,
    reason: string,
    work?: unknown,
  ) {
    if (!this.store.db.inTransaction)
      throw Error(
        "Additional issuance requires its reviewed confirmation transaction",
      );
    const value = this.snapshot(settings, work, username),
      exam = value.settings.id;
    if (
      !this.store.db
        .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
        .get(exam, username)
    )
      return conflict(
        "New grants require an enrolled student; no history/default/clock changed",
      );
    return this.issueGrant(
      exam,
      username,
      value,
      actor,
      reason,
      isSandbox(exam) ? "PRACTICE" : "ADDITIONAL_TEMPLATE",
      isSandbox(exam) ? null : (this.initialFor(exam, username)?.id ?? null),
    );
  }
  // These are read-only hints. Fresh native/preflight/Begin checks still own
  // admission. Never accept a username here: a public check must not reveal
  // whether a particular account has saved permission or an unfinished attempt.
  practiceSignInBlock() {
    const definition = JSON.parse(
      (
        this.store.db
          .prepare("SELECT config FROM exams WHERE id='sandbox'")
          .get() as { config: string }
      ).config,
    );
    const block = this.practiceWindowBlock(definition);
    if (!block) return null;
    const unfinished = this.store.db
      .prepare(
        "SELECT 1 FROM attempts WHERE exam='sandbox' AND (state NOT IN ('COMPLETED','CANCELLED_BEFORE_START') OR (start IS NOT NULL AND (coalesce(protected,0)<>1 OR coalesce(access_state,'') NOT IN ('RELEASED','OVERRIDDEN'))) OR coalesce(policy_state,'NORMAL')<>'NORMAL' OR coalesce(policy_error,'')<>'' OR coalesce(access_error,'')<>'') LIMIT 1",
      )
      .get();
    // Match available()'s closing filter conservatively, including future or
    // claimed grants and source setup still awaiting confirmation. This does
    // not make any of them usable; it merely preserves authenticated inspection.
    const issued = this.store.db
      .prepare(
        "SELECT 1 FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.agent=? AND g.exam='sandbox' AND g.status IN ('AVAILABLE','PENDING_NATIVE') AND json_extract(r.settings,'$.latest')>=? LIMIT 1",
      )
      .get(this.agent, now());
    return unfinished || issued ? null : block.message;
  }
  practiceWindowBlock(settings: { earliest: number; latest: number }) {
    const at = now();
    if (!hasSandboxWindow(settings) || at > settings.latest)
      return {
        status: "CLOSED",
        message: "Practice is closed. Ask your instructor to open it.",
      };
    if (at < settings.earliest)
      return {
        status: "NOT_OPEN",
        message: `This practice attempt opens ${new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone: "America/Chicago",
            dateStyle: "medium",
            timeStyle: "medium",
          },
        ).format(settings.earliest)} (Chicago time). Try again then.`,
      };
    return null;
  }
  // Runtime caller: authenticated student preflight, after native role/UID and
  // prior completion/release checks. This transaction never waits on native IO.
  practice(username: string) {
    return this.store.db.transaction(() => {
      if (this.available("sandbox", username).length) return;
      const last = this.store.db
        .prepare(
          "SELECT id,status FROM attempt_grants WHERE agent=? AND exam='sandbox' AND username=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(this.agent, username) as any;
      if (last && last.status !== "CONSUMED")
        return conflict(
          "Your practice attempt is not available. Ask your instructor to update it or allow another attempt.",
        );
      if (
        last &&
        !this.store.db
          .prepare(
            "SELECT 1 FROM grant_claims c JOIN grant_begin_intents b ON b.attempt=c.attempt JOIN attempts a ON a.id=c.attempt JOIN attempt_grants g ON g.id=c.grant_id JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE c.grant_id=? AND g.issuance='PRACTICE' AND c.state='CONSUMED' AND b.state='CONSUMED' AND a.state='COMPLETED' AND a.protected=1 AND a.access_state IN ('RELEASED','OVERRIDDEN') AND a.grant_id=g.id AND a.grant_revision=c.revision AND c.revision=g.revision AND a.grant_hash=c.hash AND c.hash=r.hash AND a.settings=r.settings AND a.uid=c.uid AND a.username=g.username AND a.exam=g.exam AND a.grant_kind='PRACTICE' AND a.grant_issued_order=g.rowid AND a.grant_begin_intent=b.id AND a.start=b.start AND a.original_deadline=b.deadline AND b.start>0 AND b.deadline-b.start=300000",
          )
          .get(last.id)
      )
        return conflict(
          "Your earlier practice attempt's completion or server access could not be confirmed. Ask your instructor to check it before starting again.",
        );
      const prior = this.store.db
        .prepare(
          "SELECT state,protected,access_state FROM attempts WHERE exam='sandbox' AND username=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(username) as any;
      if (
        prior &&
        (prior.state !== "COMPLETED" ||
          !prior.protected ||
          !["RELEASED", "OVERRIDDEN"].includes(prior.access_state))
      )
        return conflict(
          "Your earlier practice attempt needs review before you can start again. Ask your instructor to check it. Its deadline and access restrictions are unchanged.",
        );
      const definition = JSON.parse(
        (
          this.store.db
            .prepare("SELECT config FROM exams WHERE id='sandbox'")
            .get() as any
        ).config,
      );
      let value: ReturnType<AttemptGrants["snapshot"]>;
      try {
        value = this.snapshot(definition);
      } catch (error) {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (error instanceof z.ZodError || status === 404 || status === 409)
          throw Object.assign(
            Error(
              "Practice is not ready. Ask your instructor to check its settings.",
            ),
            {
              statusCode: status ?? 409,
              cause: error,
            },
          );
        throw error;
      }
      const block = this.practiceWindowBlock(value.settings);
      if (block) return conflict(block.message);
      this.issueGrant(
        "sandbox",
        username,
        value,
        "policy:sandbox",
        "Automatic five-minute practice in explicit operator window",
        "PRACTICE",
      );
    })();
  }
  private issueGrant(
    exam: string,
    username: string,
    value: ReturnType<AttemptGrants["snapshot"]>,
    actor: string,
    reason: string,
    issuance:
      | "ENROLLMENT"
      | "REVIEWED_NEW"
      | "ADDITIONAL_TEMPLATE"
      | "PRACTICE" = "ENROLLMENT",
    initial: string | null = null,
  ) {
    if (!this.store.db.inTransaction)
      throw Error("Grant issuance requires its shared atomic transaction");
    const predecessors = this.replacements(exam, username);
    const id = randomUUID(),
      at = now();
    new ExamDefinitions(this.store, this.agent).requireActive(exam);
    for (const previous of predecessors) {
      this.store.db
        .prepare("UPDATE attempt_grants SET status='REVOKED' WHERE id=?")
        .run(previous.id);
      this.store.audit(
        actor,
        "supersede-unused-grant",
        previous.id,
        JSON.stringify({ ...previous, replacement: id, reason }),
      );
    }
    this.store.db
      .prepare(
        "INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance,initial_grant) VALUES(?,?,?,?,1,?,?,?,?,?,?)",
      )
      .run(
        id,
        this.agent,
        exam,
        username,
        value.work.kind === "saved" ? "PENDING_NATIVE" : "AVAILABLE",
        at,
        actor,
        reason,
        issuance,
        initial,
      );
    this.store.db
      .prepare("INSERT INTO grant_revisions VALUES(?,1,?,?,?,?,?,?)")
      .run(
        id,
        JSON.stringify(value.settings),
        JSON.stringify(value.work),
        value.hash,
        actor,
        reason,
        at,
      );
    const issued = this.view(this.row(id));
    if (value.work.kind === "saved")
      enqueueSourceSetup(this.store, this.agent, id, 1);
    this.store.audit(
      actor,
      issuance === "PRACTICE"
        ? "issue-practice-grant"
        : issuance === "ADDITIONAL_TEMPLATE"
          ? "issue-additional-grant"
          : "issue-initial-grant",
      id,
      JSON.stringify({
        exam,
        username,
        hash: value.hash,
        issuance,
        issuance_order: issued.issuance_order,
        initial_grant: initial,
      }),
    );
    return issued;
  }
  list(input: unknown) {
    const b = grantList.parse(input);
    const rows = this.store.db
      .prepare(
        `SELECT id FROM attempt_grants WHERE agent=? AND exam=? ${b.username ? "AND username=?" : ""} AND id>? ORDER BY id LIMIT ?`,
      )
      .all(
        this.agent,
        b.exam,
        ...(b.username ? [b.username] : []),
        b.after ?? "",
        b.limit + 1,
      ) as any[];
    return {
      grants: rows.slice(0, b.limit).map((r) => this.view(this.row(r.id))),
      next: rows.length > b.limit ? rows[b.limit - 1].id : null,
    };
  }
  show(input: unknown) {
    const b = grantShow.parse(input),
      row = this.row(b.id);
    const history = this.store.db
      .prepare(
        "SELECT revision,settings,work,hash,actor,reason,at FROM grant_revisions WHERE grant_id=? AND revision<? ORDER BY revision DESC LIMIT 51",
      )
      .all(b.id, b.before ?? Number.MAX_SAFE_INTEGER) as any[];
    return {
      ...this.view(row),
      history: history.slice(0, 50).map((r) => ({
        ...r,
        settings: JSON.parse(r.settings),
        work: JSON.parse(r.work),
      })),
      history_next: history.length > 50 ? history[49].revision : null,
    };
  }
  // Immediate callers: instructor history/review and the shared root CLI
  // attempts projection. Read the APPLIED revision, never today's defaults or
  // a later revision issued after an old preparation was cancelled.
  forAttempt(
    a: Pick<
      Attempt,
      | "id"
      | "exam"
      | "username"
      | "uid"
      | "grant_id"
      | "grant_revision"
      | "grant_hash"
    >,
  ) {
    if (!a.grant_id && !a.grant_revision && !a.grant_hash)
      return { state: "legacy" as const };
    try {
      const current = this.row(a.grant_id!);
      if (current.exam !== a.exam || current.username !== a.username)
        throw Error("Grant account differs");
      const revision = this.store.db
        .prepare(
          "SELECT settings,work,hash,actor,reason,at FROM grant_revisions WHERE grant_id=? AND revision=?",
        )
        .get(a.grant_id, a.grant_revision) as any;
      if (
        !revision ||
        revision.hash !== a.grant_hash ||
        revision.settings.length > 16384 ||
        revision.work.length > 2048
      )
        throw Error("Applied grant revision unavailable");
      const saved = this.view({
        ...current,
        settings: revision.settings,
        work: revision.work,
        hash: revision.hash,
        revision: a.grant_revision,
      });
      let sourceAttempt;
      if (saved.work.kind === "saved") {
        const source = this.store.db
          .prepare(
            "SELECT a.id,a.exam,a.username,a.uid,a.state,a.protected,a.checksum,(SELECT COUNT(*) FROM attempts earlier WHERE earlier.exam=a.exam AND earlier.username=a.username AND earlier.rowid<=a.rowid) attempt_number FROM attempts a WHERE a.id=?",
          )
          .get(saved.work.attempt) as any;
        sourceAttempt =
          source && source.username === a.username && source.uid === a.uid
            ? {
                id: source.id,
                exam: source.exam,
                attempt_number: source.attempt_number,
                state: source.state,
                recorded_protected: !!source.protected,
                checksum_matches: source.checksum === saved.work.checksum,
                available_in_gateway: true,
              }
            : { id: saved.work.attempt, available_in_gateway: false };
      }
      return {
        state: "recorded" as const,
        id: saved.id,
        revision: saved.revision,
        hash: saved.hash,
        issuance: saved.issuance,
        issuance_order: saved.issuance_order,
        issued_at: saved.issued_at,
        actor: String(saved.actor).slice(0, 160),
        reason: String(saved.reason).slice(0, 1000),
        revision_reason: String(revision.reason).slice(0, 1000),
        current_revision: current.revision,
        current_status: current.status,
        settings: {
          duration: saved.settings.duration,
          webcam: saved.settings.webcam,
          earliest: saved.settings.earliest,
          latest: saved.settings.latest,
          template: saved.settings.template,
          template_version: saved.settings.template_version,
        },
        work: saved.work,
        ...(sourceAttempt ? { source_attempt: sourceAttempt } : {}),
      };
    } catch {
      return {
        state: "unavailable" as const,
        message:
          "Recorded grant linkage is unavailable or inconsistent. Preserve this attempt and inspect web grants/history; current defaults are not historical settings.",
      };
    }
  }
  unusedSummary(exam: string, username: string) {
    const result = {
      available: 0,
      future: 0,
      closed: 0,
      pendingNative: 0,
      more: false,
      unavailable: false,
    };
    try {
      const rows = this.store.db
        .prepare(
          "SELECT g.rowid issuance_order,g.*,r.settings,r.work,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.agent=? AND g.exam=? AND g.username=? AND g.status IN ('AVAILABLE','PENDING_NATIVE') AND NOT EXISTS (SELECT 1 FROM grant_claims c WHERE c.grant_id=g.id AND c.state<>'CANCELLED') ORDER BY g.rowid LIMIT 201",
        )
        .all(this.agent, exam, username) as any[];
      result.more = rows.length > 200;
      const at = now();
      for (const row of rows.slice(0, 200)) {
        const grant = this.view(row);
        if (grant.status === "PENDING_NATIVE") result.pendingNative++;
        else if (grant.settings.latest < at) result.closed++;
        else if (grant.settings.earliest > at) result.future++;
        else result.available++;
      }
    } catch {
      result.unavailable = true;
    }
    return result; // Gateway metadata; native readiness/Begin still verifies.
  }
  request<T>(
    actor: string,
    request: string | undefined,
    intent: unknown,
    execute: () => T,
  ): T {
    const run = () => {
      if (!request) return execute();
      const fingerprint = hash(JSON.stringify(intent));
      const prior = this.store.db
        .prepare(
          "SELECT fingerprint,result FROM grant_management_requests WHERE actor=? AND request=?",
        )
        .get(actor, request) as any;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          return conflict(
            "Grant request ID conflicts with a different intent; inspect current grant and use a new request ID",
          );
        return JSON.parse(prior.result);
      }
      const result = execute();
      this.store.db
        .prepare("INSERT INTO grant_management_requests VALUES(?,?,?,?,?)")
        .run(actor, request, fingerprint, JSON.stringify(result), now());
      return result;
    };
    return this.store.db.transaction(run)();
  }
  private unused(id: string, revision: number) {
    const row = this.row(id);
    if (
      !["AVAILABLE", "PENDING_NATIVE"].includes(row.status) ||
      row.revision !== revision
    )
      return conflict(
        "This attempt is unavailable or its settings changed. Refresh its current status.",
      );
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM grant_begin_intents b JOIN grant_claims c ON c.attempt=b.attempt WHERE c.grant_id=? AND (b.state<>'CANCELLED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL)",
        )
        .get(id)
    )
      return conflict(
        "Recorded start or unfinished start evidence remains. This attempt cannot be changed or cancelled as unused. Check the original attempt and keep its history. No time is refunded.",
      );
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM grant_claims WHERE grant_id=? AND state<>'CANCELLED'",
        )
        .get(id)
    )
      return conflict(
        "This attempt is in setup, starting, or already started. Cancel a confirmed unstarted setup before changing it; otherwise check the original attempt. This refusal does not cancel an attempt or refund time.",
      );
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM attempts WHERE grant_id=? AND (state<>'CANCELLED_BEFORE_START' OR start IS NOT NULL OR deadline IS NOT NULL OR original_deadline IS NOT NULL OR protected<>0 OR checksum IS NOT NULL OR registered_owner IS NOT NULL) LIMIT 1",
        )
        .get(id)
    )
      return conflict(
        "Recorded setup, start, saved-file or ownership evidence remains. Inspect the original attempt and obtain verified unstarted cleanup before replacing it. No permission or deadline changed.",
      );
    return row;
  }
  // Runtime callers: issuance review/confirmation and the sole atomic issuer.
  // Validate the complete set before a caller revokes any predecessor.
  replacements(exam: string, username: string) {
    const rows = this.store.db
      .prepare(
        "SELECT id,revision FROM attempt_grants WHERE agent=? AND exam=? AND username=? AND status IN ('AVAILABLE','PENDING_NATIVE') ORDER BY rowid",
      )
      .all(this.agent, exam, username) as { id: string; revision: number }[];
    return rows.map((row) => {
      const grant = this.view(this.unused(row.id, row.revision));
      return {
        id: grant.id as string,
        revision: grant.revision as number,
        hash: grant.hash as string,
      };
    });
  }
  current(exam: string, username: string) {
    const rows = this.store.db
      .prepare(
        "SELECT id FROM attempt_grants WHERE agent=? AND exam=? AND username=? AND status IN ('AVAILABLE','PENDING_NATIVE') ORDER BY rowid LIMIT 2",
      )
      .all(this.agent, exam, username) as { id: string }[];
    if (rows.length > 1)
      return conflict(
        "Your allowed attempt needs an instructor update. Ask your instructor to review it before opening setup.",
        "ROSTER_REVIEW_REQUIRED",
      );
    return rows.length ? this.view(this.row(rows[0].id)) : null;
  }
  revise(id: string, input: unknown, actor: string) {
    const b = grantRevision.parse(input);
    return this.request(actor, b.request, { id, ...b }, () => {
      const row = this.unused(id, b.revision),
        previous = this.view(row);
      new ExamDefinitions(this.store, this.agent).requireActive(row.exam);
      if (!Object.keys((input as any).changes).length && !b.work)
        return conflict(
          "Choose an explicit grant setting to revise; defaults do not revise issued grants",
        );
      // Partial create defaults must not overwrite omitted saved settings.
      const supplied = z
        .record(z.string(), z.unknown())
        .parse((input as any).changes);
      const changes = Object.fromEntries(
        Object.keys(supplied).map((k) => [
          k,
          b.changes[k as keyof typeof b.changes],
        ]),
      );
      const value = this.snapshot(
          {
            ...previous.settings,
            ...changes,
            id: row.exam,
          },
          b.work ?? previous.work,
          row.username,
        ),
        revision = row.revision + 1;
      this.store.db
        .prepare("INSERT INTO grant_revisions VALUES(?,?,?,?,?,?,?,?)")
        .run(
          id,
          revision,
          JSON.stringify(value.settings),
          JSON.stringify(value.work),
          value.hash,
          actor,
          b.reason,
          now(),
        );
      this.store.db
        .prepare("UPDATE attempt_grants SET revision=?,status=? WHERE id=?")
        .run(
          revision,
          value.work.kind === "saved" ? "PENDING_NATIVE" : "AVAILABLE",
          id,
        );
      this.store.audit(
        actor,
        "revise-unused-grant",
        id,
        JSON.stringify({ revision, reason: b.reason, hash: value.hash }),
      );
      if (value.work.kind === "saved")
        enqueueSourceSetup(this.store, this.agent, id, revision);
      return this.show({ id });
    });
  }
  revoke(id: string, input: unknown, actor: string) {
    const b = grantRevocation.parse(input);
    return this.request(actor, b.request, { id, ...b }, () => {
      this.unused(id, b.revision);
      this.store.db
        .prepare("UPDATE attempt_grants SET status='REVOKED' WHERE id=?")
        .run(id);
      this.store.audit(actor, "revoke-unused-grant", id, b.reason);
      return this.show({ id });
    });
  }
  initialFor(exam: string, username: string) {
    const row = this.store.db
      .prepare(
        "SELECT id FROM attempt_grants WHERE agent=? AND exam=? AND username=? AND issuance IN ('ENROLLMENT','REVIEWED_NEW')",
      )
      .get(this.agent, exam, username) as any;
    return row ? this.view(this.row(row.id)) : null;
  }
  lastPracticeFor(username: string) {
    const row = this.store.db
      .prepare(
        "SELECT id FROM attempt_grants WHERE agent=? AND exam='sandbox' AND username=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(this.agent, username) as any;
    return row ? this.view(this.row(row.id)) : null;
  }
  select(exam: string, username: string, id: string) {
    const grant = this.view(this.row(id));
    if (grant.exam !== exam || grant.username !== username)
      return conflict(
        "Grant does not belong to the authenticated exam/account; select one from your own waiting page",
      );
    return grant;
  }
  available(exam: string, username: string) {
    const grant = this.current(exam, username);
    return grant?.status === "AVAILABLE" && grant.settings.latest >= now()
      ? [grant]
      : [];
  }
  binding(grant: ReturnType<AttemptGrants["select"]>) {
    return grantBinding.parse({
      id: grant.id,
      revision: grant.revision,
      hash: grant.hash,
      ...(grant.issuance === "ADDITIONAL_TEMPLATE"
        ? { kind: "ADDITIONAL" }
        : grant.issuance === "PRACTICE"
          ? { kind: "PRACTICE" }
          : {}),
      issuance_order: grant.issuance_order,
      ...(grant.initial_grant ? { initial_grant: grant.initial_grant } : {}),
      ...(grant.work.kind === "template" &&
      grant.work.name === grant.settings.template &&
      grant.work.hash === grant.settings.template_version
        ? {}
        : { work: grant.work }),
    });
  }
  bindingForAttempt(a: Attempt) {
    return grantBinding.parse({
      id: a.grant_id,
      revision: a.grant_revision,
      hash: a.grant_hash,
      ...(a.grant_kind ? { kind: a.grant_kind } : {}),
      ...(a.grant_issued_order ? { issuance_order: a.grant_issued_order } : {}),
      ...(a.grant_initial ? { initial_grant: a.grant_initial } : {}),
      ...(a.grant_work
        ? { work: grantWorkspace.parse(JSON.parse(a.grant_work)) }
        : {}),
    });
  }
  claim(id: string, attempt: string, uid: number) {
    if (!this.store.db.inTransaction)
      throw Error("Grant claim requires its shared preparation transaction");
    if (!Number.isSafeInteger(uid) || uid < 1000)
      return conflict(
        "A current verified course-server UID is required; enrollment/import UID values are not identity proof",
      );
    if (
      this.store.db
        .prepare("SELECT 1 FROM grant_claims WHERE grant_id=? AND uid<>?")
        .get(id, uid)
    )
      return conflict(
        "Verified Unix identity changed after this grant was claimed; preserve original claim/attempt history and obtain reviewed new authorization, never rebind the old allowance",
      );
    const grant = this.view(this.row(id));
    if (grant.status !== "AVAILABLE")
      return conflict(
        "Grant is revoked or consumed; ask your instructor to inspect grant history; no allowance started",
        "GRANT_UNAVAILABLE",
      );
    if (grant.work.kind === "saved") {
      const retained = this.store.db
        .prepare(
          "SELECT * FROM grant_source_retentions WHERE grant_id=? AND revision=?",
        )
        .get(id, grant.revision) as any;
      if (
        !retained ||
        retained.state !== "RETAINED" ||
        retained.grant_hash !== grant.hash ||
        retained.uid !== uid ||
        retained.source_attempt !== grant.work.attempt ||
        retained.checksum !== grant.work.checksum
      )
        return conflict(
          "Saved source retention does not match this verified Unix identity/current grant. Ask your instructor to inspect source-show/source-sync; no preparation, account reservation, grant or clock consumed.",
        );
    }
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM grant_begin_intents b JOIN grant_claims c ON c.attempt=b.attempt WHERE c.grant_id=? AND (b.state='CONSUMED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL)",
        )
        .get(id)
    )
      return conflict(
        "Original Begin consumption/interval evidence remains; preserve authority and inspect the native attempt, never infer an unused allowance",
      );
    if (now() > grant.settings.latest)
      return conflict(
        "This grant's finite Begin window is closed; no new preparation or clock authorized",
      );
    const previous = this.store.db
      .prepare("SELECT * FROM grant_claims WHERE attempt=?")
      .get(attempt) as any;
    if (previous) {
      if (
        previous.grant_id !== id ||
        previous.revision !== grant.revision ||
        previous.hash !== grant.hash ||
        previous.uid !== uid ||
        previous.state === "CANCELLED"
      )
        return conflict(
          "Preparation belongs to a different/retired grant revision; inspect its original no-start status",
        );
      return grant;
    }
    this.store.db
      .prepare("INSERT INTO grant_claims VALUES(?,?,?,?,?,'PREPARING',?,NULL)")
      .run(attempt, id, grant.revision, grant.hash, uid, now());
    return grant;
  }
  begin(a: Attempt, transport: string, page?: string) {
    return this.store.db.transaction(() => {
      if (!a.grant_id) return conflict("Grant-bound preparation required");
      const grant = this.claim(a.grant_id, a.id, a.uid);
      if (now() < grant.settings.earliest)
        return conflict(
          "The grant's Begin window is not open; preflight consumes no time and no Begin intent was reserved",
        );
      if (
        !isDeepStrictEqual(this.binding(grant), this.bindingForAttempt(a)) ||
        grant.revision !== a.grant_revision ||
        grant.hash !== a.grant_hash ||
        !isDeepStrictEqual(grant.settings, JSON.parse(a.settings))
      )
        return conflict(
          "Prepared grant settings changed; preserve the original preparation and inspect its status",
        );
      const prior = this.store.db
        .prepare("SELECT * FROM grant_begin_intents WHERE attempt=?")
        .get(a.id) as any;
      if (prior) {
        if (
          prior.state !== "PENDING" ||
          prior.transport !== transport ||
          (prior.owner_page !== null && prior.owner_page !== (page ?? null))
        )
          return conflict(
            "Original Begin intent/owner changed; inspect its exact native outcome, never create a replacement clock",
          );
        return prior.id as string;
      }
      const id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,owner_page) VALUES(?,?,?,'PENDING',?,?)",
        )
        .run(id, a.id, transport, now(), page ?? null);
      this.store.db
        .prepare(
          "UPDATE grant_claims SET state='BEGIN_PENDING' WHERE attempt=?",
        )
        .run(a.id);
      this.store.db
        .prepare("UPDATE attempts SET grant_begin_intent=? WHERE id=?")
        .run(id, a.id);
      this.store.audit(
        "gateway",
        "reserve-grant-begin",
        id,
        JSON.stringify({ grant: a.grant_id, attempt: a.id }),
      );
      return id;
    })();
  }
  verifyBegin(
    input: unknown,
    freshCapture: (
      a: Attempt,
      owner?: MonitoringOwner,
    ) => number | { remainingMS: number; bootstrap: MonitoringBootstrap },
  ) {
    const b = grantBeginRequest.parse(input),
      a = this.store.attempt(b.attempt),
      g = this.view(this.row(b.grant.id));
    const intent = this.store.db
      .prepare("SELECT * FROM grant_begin_intents WHERE id=? AND attempt=?")
      .get(b.intent, b.attempt) as any;
    const claim = this.store.db
      .prepare("SELECT * FROM grant_claims WHERE attempt=?")
      .get(b.attempt) as any;
    if (
      b.agent !== this.agent ||
      Math.abs(now() - b.at) > 30000 ||
      !a ||
      a.state !== "PREPARING" ||
      a.grant_id !== b.grant.id ||
      a.grant_revision !== b.grant.revision ||
      a.grant_hash !== b.grant.hash ||
      a.uid !== b.uid ||
      a.username !== b.username ||
      a.exam !== b.exam ||
      g.username !== b.username ||
      g.exam !== b.exam ||
      g.status !== "AVAILABLE" ||
      g.revision !== b.grant.revision ||
      g.hash !== b.grant.hash ||
      !intent ||
      intent.state !== "PENDING" ||
      intent.transport !== b.transport ||
      (intent.owner_page ?? null) !== (b.page_epoch ?? null) ||
      (b.page_epoch !== undefined && a.page_hash !== b.page_epoch) ||
      a.grant_begin_intent !== b.intent ||
      !claim ||
      claim.state !== "BEGIN_PENDING" ||
      claim.grant_id !== b.grant.id ||
      claim.revision !== b.grant.revision ||
      claim.hash !== b.grant.hash ||
      claim.uid !== b.uid ||
      !isDeepStrictEqual(JSON.parse(a.settings), g.settings) ||
      !isDeepStrictEqual(b.settings, g.settings) ||
      !isDeepStrictEqual(b.grant, this.bindingForAttempt(a)) ||
      !isDeepStrictEqual(b.grant, this.binding(g)) ||
      now() < g.settings.earliest ||
      now() > g.settings.latest
    )
      return conflict(
        "Fresh grant Begin verification refused; preserve original intent/attempt and inspect current grant, owner, window and native status. No refund or new clock authorized.",
      );
    // PREPARING/AVAILABLE labels alone do not establish an unused allowance:
    // retained interval, protected work, ownership or other-claim consumption
    // must refuse before signing anything that can authorize a native start.
    this.unstartedEvidence(a);
    const initial = b.initial_owner;
    if (
      initial &&
      (initial.attempt !== a.id ||
        initial.exam !== a.exam ||
        initial.username !== a.username ||
        initial.uid !== a.uid ||
        initial.transport_hash !== b.transport ||
        initial.boot !== b.boot ||
        initial.page_epoch !== b.page_epoch ||
        initial.generation !== a.generation ||
        initial.clock_revision !== a.clock_revision)
    )
      return conflict(
        "Provisional monitoring owner differs from the exact unused Begin; preserve intent and retry current-page preparation without consuming time",
      );
    // This in-memory observation is checked again at the authenticated native
    // request, after any slow handoff/source work. It is not an ACTIVE permit.
    const observation = freshCapture(a, initial),
      remaining =
        typeof observation === "number" ? observation : observation.remainingMS,
      bootstrap =
        typeof observation === "number"
          ? undefined
          : monitoringBootstrap.parse(observation.bootstrap);
    if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 15000)
      return conflict(
        "Fresh preflight capture unavailable; sample again before retrying the same Begin intent. No interval committed.",
      );
    if (
      (b.type === "grant-begin/v3") !== !!bootstrap ||
      (bootstrap && !isDeepStrictEqual(bootstrap.owner, initial))
    )
      return conflict(
        "Fresh monitoring Begin bootstrap unavailable or mismatched; require matching native/gateway roles and retry the same intent before time starts",
      );
    this.store.db
      .prepare("UPDATE grant_begin_intents SET verified_at=? WHERE id=?")
      .run(now(), b.intent);
    return {
      type: b.type,
      audience: this.agent,
      nonce: b.nonce,
      expires: now() + remaining,
      capture_valid_for_ms: remaining,
      attempt: b.attempt,
      grant: b.grant,
      intent: b.intent,
      transport: b.transport,
      boot: b.boot,
      ...(b.page_epoch ? { page_epoch: b.page_epoch } : {}),
      ...(bootstrap ? { bootstrap } : {}),
    };
  }
  accept(remote: any, a: Attempt) {
    if (!a.grant_id) return;
    if (
      remote.id !== a.id ||
      remote.exam !== a.exam ||
      remote.username !== a.username ||
      remote.uid !== a.uid
    )
      return conflict(
        "Native grant receipt identity mismatch; no cancellation/start confirmation accepted",
      );
    const expected = this.bindingForAttempt(a);
    if (
      remote.state === "CANCELLED_BEFORE_START" &&
      !remote.start &&
      !remote.deadline &&
      !remote.original_deadline
    ) {
      this.unstartedEvidence(a);
      return; // exact no-start fence may precede native grant creation.
    }
    if (!isDeepStrictEqual(remote.grant, expected))
      return conflict(
        "Native grant binding differs from the retained preparation; preserve authority and original interval",
      );
    if (!isDeepStrictEqual(remote.settings, JSON.parse(a.settings)))
      return conflict(
        "Native grant settings differ from the immutable issued preparation; preserve original authority before retry",
      );
    if (expected.work && (remote.workspace || remote.start)) {
      const source =
        expected.work.kind === "empty"
          ? { kind: "empty" }
          : expected.work.kind === "saved"
            ? {
                kind: "saved",
                attempt: expected.work.attempt,
                checksum: expected.work.checksum,
              }
            : {
                kind: "template",
                template: expected.work.name,
                version: expected.work.hash,
              };
      if (expected.work.kind === "saved") {
        const retention = this.store.db
          .prepare(
            "SELECT * FROM grant_source_retentions WHERE grant_id=? AND revision=?",
          )
          .get(a.grant_id, a.grant_revision) as any;
        if (
          !retention ||
          retention.grant_hash !== a.grant_hash ||
          retention.source_attempt !== expected.work.attempt ||
          retention.checksum !== expected.work.checksum ||
          retention.uid !== a.uid ||
          !remote.workspace ||
          remote.workspace.recovery_hash !== retention.retention_hash ||
          (retention.state !== "RETAINED" &&
            !(remote.state === "COMPLETED" && remote.protected))
        )
          return conflict(
            "Saved-source readiness differs from durable native retention/source; inspect source-show/source-sync and preserve original authority. No fallback, grant consumption or clock authorized.",
          );
      }
      if (
        !remote.workspace ||
        !isDeepStrictEqual(remote.workspace.grant, expected) ||
        !isDeepStrictEqual(remote.workspace.source, source)
      )
        return conflict(
          "Native workspace receipt differs from the explicit issued source; preserve private work and original authority, no fallback accepted",
        );
    }
    if (!remote.start) return;
    const original = remote.original_deadline || remote.deadline;
    if (
      !Number.isSafeInteger(remote.start) ||
      remote.start <= 0 ||
      !Number.isSafeInteger(original) ||
      original - remote.start !== JSON.parse(a.settings).duration * 1000
    )
      return conflict(
        "Native original interval differs from the issued fixed allowance; preserve canonical state/intent and inspect before retry",
      );
    if (
      remote.grant_begin_intent !== a.grant_begin_intent ||
      !a.grant_begin_intent
    )
      return conflict(
        "Native start lacks its original one-use Begin intent; preserve native interval/history",
      );
    const prior = this.store.db
      .prepare(
        "SELECT state,start,deadline,owner_page FROM grant_begin_intents WHERE id=? AND attempt=?",
      )
      .get(a.grant_begin_intent, a.id) as any;
    if (
      !prior ||
      prior.state === "CANCELLED" ||
      (prior.start !== null && prior.start !== remote.start) ||
      (prior.deadline !== null && prior.deadline !== original)
    )
      return conflict(
        "Native start contradicts the retained original Begin outcome; preserve interval/intent history before repair",
      );
    const owner =
      remote.registered_owner === undefined
        ? null
        : monitoringOwner.parse(remote.registered_owner);
    if (
      (prior.owner_page && prior.start === null && !owner) ||
      (owner &&
        (owner.attempt !== a.id ||
          owner.exam !== a.exam ||
          owner.username !== a.username ||
          owner.uid !== a.uid ||
          (prior.start === null && prior.owner_page !== owner.page_epoch)))
    )
      return conflict(
        "Native registered owner contradicts the original Begin scope; preserve the authoritative interval and inspect the pending original outcome, never issue a replacement clock",
      );
    this.store.db.transaction(() => {
      observeNativeMonitoring(this.store, a, remote);
      const saved = this.store.attempt(a.id)?.registered_owner;
      const previous = saved ? monitoringOwner.parse(JSON.parse(saved)) : null;
      const stale =
        owner &&
        previous &&
        (owner.generation < previous.generation ||
          owner.clock_revision < previous.clock_revision ||
          (owner.generation === previous.generation &&
            owner.clock_revision === previous.clock_revision &&
            !isDeepStrictEqual(owner, previous)));
      if (owner && !stale && remote.retained_hold !== "resuming")
        this.store.db
          .prepare("UPDATE attempts SET registered_owner=? WHERE id=?")
          .run(JSON.stringify(owner), a.id);
      this.store.db
        .prepare("UPDATE attempt_grants SET status='CONSUMED' WHERE id=?")
        .run(a.grant_id);
      this.store.db
        .prepare("UPDATE grant_claims SET state='CONSUMED' WHERE attempt=?")
        .run(a.id);
      this.store.db
        .prepare(
          "UPDATE grant_begin_intents SET state='CONSUMED',start=?,deadline=? WHERE id=?",
        )
        .run(
          remote.start,
          remote.original_deadline || remote.deadline,
          a.grant_begin_intent,
        );
    })();
  }
  private unstartedEvidence(a: Attempt) {
    const claim = this.store.db
      .prepare("SELECT * FROM grant_claims WHERE attempt=?")
      .get(a.id) as any;
    if (
      !claim ||
      claim.grant_id !== a.grant_id ||
      claim.revision !== a.grant_revision ||
      claim.hash !== a.grant_hash ||
      claim.uid !== a.uid
    )
      return conflict(
        "No-start verification lacks its exact retained grant claim; preserve history and restore matching authority before Begin or retirement",
      );
    if (a.grant_issued_order !== null) {
      const current = this.row(a.grant_id!),
        revision = this.store.db
          .prepare(
            "SELECT settings,work,hash FROM grant_revisions WHERE grant_id=? AND revision=?",
          )
          .get(a.grant_id, a.grant_revision) as any;
      if (
        !revision ||
        (current.revision !== a.grant_revision &&
          claim.state !== "CANCELLED") ||
        !isDeepStrictEqual(
          this.binding(
            this.view({ ...current, ...revision, revision: a.grant_revision }),
          ),
          this.bindingForAttempt(a),
        ) ||
        !isDeepStrictEqual(
          JSON.parse(revision.settings),
          JSON.parse(a.settings),
        )
      )
        return conflict(
          "No-start verification contradicts original issuance/type evidence; preserve grant/monitoring history before Begin or retirement",
        );
    }
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM attempt_grants WHERE id=? AND status='CONSUMED' UNION ALL SELECT 1 FROM grant_claims c LEFT JOIN grant_begin_intents b ON b.attempt=c.attempt WHERE c.grant_id=? AND (c.state='CONSUMED' OR b.state='CONSUMED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL) UNION ALL SELECT 1 FROM attempts WHERE grant_id=? AND (start IS NOT NULL OR deadline IS NOT NULL OR original_deadline IS NOT NULL OR protected<>0 OR checksum IS NOT NULL OR registered_owner IS NOT NULL) LIMIT 1",
        )
        .get(a.grant_id, a.grant_id, a.grant_id)
    )
      return conflict(
        "No-start verification contradicts durable grant consumption/interval, protected-work or ownership evidence; preserve history and inspect native status before Begin or retirement",
      );
  }
  checkRetirement(a: Attempt) {
    if (!a.grant_id) return;
    if (
      a.state !== "CANCELLED_BEFORE_START" ||
      a.start !== null ||
      a.deadline !== null
    )
      return conflict(
        "Grant claim retirement requires positively confirmed no-start cancellation",
      );
    this.unstartedEvidence(a);
  }
  retire(a: Attempt) {
    if (!a.grant_id) return;
    this.checkRetirement(a);
    this.store.db
      .prepare(
        "UPDATE grant_claims SET state='CANCELLED',ended_at=COALESCE(ended_at,?) WHERE attempt=? AND state<>'CONSUMED'",
      )
      .run(a.ended ?? now(), a.id);
    this.store.db
      .prepare(
        "UPDATE grant_begin_intents SET state='CANCELLED' WHERE attempt=? AND state='PENDING'",
      )
      .run(a.id);
  }
}
