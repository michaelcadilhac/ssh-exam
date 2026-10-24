import { z } from "zod";
import {
  examSchema,
  examConfiguration,
} from "../../../packages/protocol/index.js";
import {
  isSandbox,
  sandboxExam,
  hasSandboxWindow,
} from "../../../packages/protocol/sandbox.js";
import { hash, now, type Store } from "./db.js";
import { TemplateCatalog } from "./template-catalog.js";

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reasonSchema = z.string().trim().min(8).max(1000);
const failure = (message: string, statusCode: number): never => {
  throw Object.assign(Error(message), { statusCode });
};

// The only definition writer for browser and root CLI. Attempt/grant snapshots,
// native work/submissions, clocks and account policy are never rewritten here.
export class ExamDefinitions {
  constructor(
    private store: Store,
    private agent?: string,
  ) {}
  withRequest<T>(
    actor: string,
    request: string | undefined,
    intent: unknown,
    execute: () => T,
  ): T {
    if (!request) return execute();
    z.string().uuid().parse(request);
    const fingerprint = hash(JSON.stringify(intent));
    return this.store.db.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT fingerprint,result FROM exam_definition_requests WHERE actor=? AND request=?",
        )
        .get(actor, request) as
        | { fingerprint: string; result: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          return failure(
            "Definition request ID conflicts with different settings; review current state and submit a new intent",
            409,
          );
        return JSON.parse(prior.result) as T;
      }
      const result = execute();
      this.store.db
        .prepare("INSERT INTO exam_definition_requests VALUES(?,?,?,?,?)")
        .run(actor, request, fingerprint, JSON.stringify(result), now());
      return result;
    })();
  }
  private record(id: string): any {
    return this.store.db
      .prepare(
        "SELECT e.id,e.config,m.instance,m.version,m.archived,m.deleted,m.changed_at,m.legacy_unreconciled FROM exams e LEFT JOIN exam_lifecycle m ON m.exam=e.id WHERE e.id=?",
      )
      .get(id);
  }
  private describe(row: any) {
    if (
      !/^[a-f0-9]{32}$/.test(row.instance ?? "") ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      ![0, 1].includes(row.archived) ||
      ![0, 1].includes(row.legacy_unreconciled) ||
      row.deleted !== 0
    )
      return failure(
        "Definition lifecycle metadata is unavailable or unsafe; preserve records and repair matching migration/state before management",
        409,
      );
    return {
      exam: JSON.parse(row.config),
      revision: hash(
        JSON.stringify([
          row.config,
          row.instance,
          row.version,
          row.archived,
          row.legacy_unreconciled,
        ]),
      ),
      lifecycle: row.archived ? "archived" : "active",
    };
  }
  show(id: string) {
    idSchema.parse(id);
    const row = this.record(id);
    if (!row)
      return failure(
        "Exam definition not found; use examctl web exams list",
        404,
      );
    return this.describe(row);
  }
  requireActive(id: string) {
    const definition = this.show(id);
    if (definition.lifecycle !== "active")
      return failure(
        "Exam definition is archived; inspect web exams show and use reviewed unarchive before changing defaults, roster or grant authority. Existing attempts and history are preserved.",
        409,
      );
    return definition;
  }
  all(lifecycle: "active" | "archived" | "all" = "active") {
    return (
      this.store.db
        .prepare(
          "SELECT e.id,e.config,m.instance,m.version,m.archived,m.deleted,m.changed_at,m.legacy_unreconciled FROM exams e LEFT JOIN exam_lifecycle m ON m.exam=e.id WHERE m.archived IS NULL OR ?='all' OR m.archived=? OR (?='active' AND EXISTS(SELECT 1 FROM attempts a WHERE a.exam=e.id AND a.state IN ('PREPARING','ACTIVATING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED'))) ORDER BY (e.id='sandbox'),e.rowid",
        )
        .all(lifecycle, lifecycle === "archived" ? 1 : 0, lifecycle) as any[]
    ).map((row) => {
      const d = this.describe(row);
      return { ...d.exam, revision: d.revision, lifecycle: d.lifecycle };
    });
  }
  page(
    after: string,
    limit: number,
    lifecycle: "active" | "archived" | "all" = "active",
  ) {
    const rows = this.store.db
      .prepare(
        "SELECT e.id,e.config,m.instance,m.version,m.archived,m.deleted,m.changed_at,m.legacy_unreconciled FROM exams e LEFT JOIN exam_lifecycle m ON m.exam=e.id WHERE e.id>? AND (m.archived IS NULL OR ?='all' OR m.archived=? OR (?='active' AND EXISTS(SELECT 1 FROM attempts a WHERE a.exam=e.id AND a.state IN ('PREPARING','ACTIVATING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED')))) ORDER BY e.id LIMIT ?",
      )
      .all(
        after,
        lifecycle,
        lifecycle === "archived" ? 1 : 0,
        lifecycle,
        limit + 1,
      ) as any[];
    const page = rows.slice(0, limit);
    return {
      exams: page.map((row) => this.describe(row)),
      next: rows.length > limit ? page.at(-1)!.id : null,
    };
  }
  retirementPreview(id: string, input: unknown) {
    idSchema.parse(id);
    const { action } = z
      .object({ action: z.enum(["delete", "archive", "unarchive"]) })
      .strict()
      .parse(input);
    return this.store.db.transaction(() => {
      const definition = this.show(id);
      const enrollments = this.store.db
        .prepare(
          "SELECT username,uid,duration,webcam FROM enrollments WHERE exam=? ORDER BY username",
        )
        .all(id) as any[];
      const attempts = this.store.db
        .prepare(
          "SELECT id,username,state,start,deadline,original_deadline,protected,access_state,checksum,generation,clock_revision,grant_id FROM attempts WHERE exam=? ORDER BY id",
        )
        .all(id) as any[];
      const grants = this.store.db
        .prepare(
          "SELECT g.id,g.username,g.revision,g.status,r.hash FROM attempt_grants g LEFT JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.exam=? ORDER BY g.id",
        )
        .all(id) as any[];
      if (
        grants.some(
          (g) =>
            !/^[a-f0-9]{64}$/.test(g.hash ?? "") ||
            !["AVAILABLE", "PENDING_NATIVE", "CONSUMED", "REVOKED"].includes(
              g.status,
            ),
        )
      )
        return failure(
          "Grant history is inconsistent; preserve records and repair matching grant revisions before definition retirement",
          409,
        );
      const claims = this.store.db
        .prepare(
          "SELECT c.attempt,c.grant_id,c.revision,c.hash,c.uid,c.state FROM grant_claims c JOIN attempt_grants g ON g.id=c.grant_id WHERE g.exam=? ORDER BY c.attempt",
        )
        .all(id) as any[];
      const rosterPreviews = this.store.db
        .prepare(
          "SELECT id,created,consumed FROM previews WHERE exam=? ORDER BY id",
        )
        .all(id);
      const grantPreviews = this.store.db
        .prepare(
          "SELECT id,revision,status,expires FROM grant_issuance_previews WHERE json_extract(snapshot,'$.exam')=? ORDER BY id",
        )
        .all(id);
      const allowanceEdits = this.store.db
        .prepare(
          "SELECT revision,username,duration FROM recovery_allowance_edits WHERE exam=? ORDER BY revision",
        )
        .all(id);
      const recoverySources = this.store.db
        .prepare(
          "SELECT agent,username,uid,source_attempt,checksum FROM recovery_grant_sources WHERE exam=? ORDER BY agent,username",
        )
        .all(id);
      const modes = this.store.db
        .prepare("SELECT activated_at FROM grant_exam_modes WHERE exam=?")
        .all(id);
      const graph = {
        enrollments,
        attempts,
        grants,
        claims,
        rosterPreviews,
        grantPreviews,
        allowanceEdits,
        recoverySources,
        modes,
      };
      const counts = Object.fromEntries(
        Object.entries(graph).map(([key, value]) => [key, value.length]),
      );
      const blockers: string[] = [];
      if (action !== "unarchive" && this.record(id).legacy_unreconciled)
        blockers.push(
          "Legacy native authority has not been reconciled; inspect examctl recovery-grants and native attempts and retain this definition until supported migration verifies its dependencies. Never clear lifecycle flags or native grant files to force retirement.",
        );
      if (isSandbox(id))
        blockers.push(
          "Sandbox is maintained automatically; configure its finite Begin window with web exams update sandbox instead of retiring it.",
        );
      if (
        action === "delete" &&
        Object.values(counts).some((value) => value > 0)
      )
        blockers.push(
          "Definition has roster, grant, preparation or attempt history; use reviewed archive. No history or protected data may be cascaded.",
        );
      if (action === "archive") {
        if (definition.lifecycle !== "active")
          blockers.push(
            "Definition is already archived; inspect current state and use the original request ID after a lost reply.",
          );
        if (
          attempts.some(
            (a) =>
              !["COMPLETED", "CANCELLED_BEFORE_START"].includes(a.state) ||
              (a.state === "COMPLETED" &&
                (!a.protected ||
                  !["RELEASED", "OVERRIDDEN"].includes(a.access_state))),
          )
        )
          blockers.push(
            "Unfinished or unreleased work remains; inspect web attempts list/show and resolve it without resetting clocks or clearing holds before archive.",
          );
        if (
          grants.some((g) => ["AVAILABLE", "PENDING_NATIVE"].includes(g.status))
        )
          blockers.push(
            "Unused grants remain; inspect web grants list/show and explicitly revoke or resolve them before archive. Archive never cancels an allowance.",
          );
        if (
          grants.some(
            (g) =>
              g.status === "CONSUMED" &&
              !attempts.some(
                (a) =>
                  a.grant_id === g.id && a.state === "COMPLETED" && a.start > 0,
              ),
          )
        )
          blockers.push(
            "Consumed grant has no verified closed attempt; inspect web grants/attempts and reconcile the uncertain native outcome before archive. Never infer completion from consumption alone.",
          );
        if (recoverySources.length)
          blockers.push(
            "Native saved-work authority has no verified terminal disposition in this catalog; inspect examctl recovery-grants and retain the definition until supported native reconciliation. Do not remove source expectations to force archive.",
          );
        if (
          claims.some((c) => ["PREPARING", "BEGIN_PENDING"].includes(c.state))
        )
          blockers.push(
            "A grant preparation/Begin outcome is unresolved; preserve its claim and inspect attempts/grants before archive.",
          );
        if (
          enrollments.some(
            (e) =>
              !attempts.some((a) => a.username === e.username && a.start > 0) &&
              !grants.some((g) => g.username === e.username),
          )
        )
          blockers.push(
            "Legacy unused enrollment remains; review web students/grants and explicitly resolve its authority before archive, never invent historical settings.",
          );
      }
      if (action === "unarchive" && definition.lifecycle !== "archived")
        blockers.push(
          "Definition is already active; unarchive does not reopen attempts or elapsed Begin windows.",
        );
      return {
        id,
        action,
        revision: definition.revision,
        lifecycle: definition.lifecycle,
        exam: definition.exam,
        counts,
        allowed: !blockers.length,
        blockers,
        review: hash(
          JSON.stringify({ id, action, revision: definition.revision, graph }),
        ),
        preserves: [
          "grants and revisions",
          "attempts and submissions",
          "original deadlines and holds",
          "protected work and source retention",
          "audit and request history",
        ],
      };
    })();
  }
  retire(id: string, input: unknown, actor: string, request?: string) {
    const body = z
      .object({
        action: z.enum(["delete", "archive", "unarchive"]),
        revision: revisionSchema,
        review: revisionSchema,
        reason: reasonSchema,
      })
      .strict()
      .parse(input);
    return this.withRequest(
      actor,
      request,
      { operation: "definition-retirement", id, ...body },
      () =>
        this.store.db.transaction(() => {
          const current = this.retirementPreview(id, { action: body.action });
          if (
            current.revision !== body.revision ||
            current.review !== body.review
          )
            return failure(
              "Definition or dependencies changed; run a fresh retire-preview, review the differences and submit a NEW intent. Do not silently adopt a new review after a lost reply.",
              409,
            );
          if (!current.allowed) return failure(current.blockers.join(" "), 409);
          const at = now();
          if (body.action === "delete") {
            this.store.db.prepare("DELETE FROM exams WHERE id=?").run(id);
            this.store.db
              .prepare("UPDATE exam_lifecycle SET changed_at=? WHERE exam=?")
              .run(at, id);
          } else
            this.store.db
              .prepare(
                "UPDATE exam_lifecycle SET archived=?,version=version+1,changed_at=? WHERE exam=?",
              )
              .run(Number(body.action === "archive"), at, id);
          const lifecycle =
            body.action === "delete"
              ? "deleted"
              : body.action === "archive"
                ? "archived"
                : "active";
          const result = {
            id,
            action: body.action,
            lifecycle,
            previous_revision: current.revision,
            revision: body.action === "delete" ? null : this.show(id).revision,
          };
          this.store.audit(
            actor,
            `${body.action}-exam`,
            id,
            JSON.stringify({
              reason: body.reason,
              review: body.review,
              counts: current.counts,
              before: current.exam,
              ...result,
            }),
          );
          return result;
        })(),
    );
  }
  create(input: unknown, actor: string, reason?: string) {
    return this.save(input, null, actor, reason);
  }
  update(
    id: string,
    changes: unknown,
    revision: string,
    actor: string,
    reason?: string,
  ) {
    idSchema.parse(id);
    revisionSchema.parse(revision);
    const raw = z.record(z.string(), z.unknown()).parse(changes);
    if (!Object.keys(raw).length)
      return failure("Choose at least one exam setting to update", 400);
    const parsed = examConfiguration
      .omit({ id: true })
      .strict()
      .partial()
      .parse(raw);
    // Zod create defaults must never become unintended changes in a partial
    // update. Only fields actually supplied by the caller may override state.
    const patch = Object.fromEntries(
      Object.keys(raw).map((key) => [key, parsed[key as keyof typeof parsed]]),
    );
    return this.store.db.transaction(() => {
      const current = this.requireActive(id);
      if (current.revision !== revision)
        return failure(
          "Exam definition changed; reload current settings with web exams show, review the differences, then submit a new intent with the current revision",
          409,
        );
      return this.save(
        { ...current.exam, ...patch, id },
        revision,
        actor,
        reason,
      );
    })();
  }
  private save(
    input: unknown,
    expected: string | null,
    actor: string,
    reason?: string,
  ) {
    const parsed = examSchema.parse(input);
    if (isSandbox(parsed.id) && !hasSandboxWindow(parsed))
      return failure(
        "Sandbox requires an explicit finite Begin window; use Exam settings or examctl web exams show sandbox, then update sandbox --revision HASH --earliest RFC3339 --latest RFC3339. Existing attempts are unchanged.",
        400,
      );
    const exam = isSandbox(parsed.id)
      ? sandboxExam(parsed.template, parsed)
      : parsed;
    if (exam.template_version) {
      if (!this.agent)
        return failure(
          "Exact source selection needs the configured class-agent identity; preserve settings and inspect the authenticated template catalog",
          503,
        );
      // Historical source attestation, not a live availability lease. Native
      // staging/Begin must still verify the actual exact bytes.
      new TemplateCatalog(this.store, this.agent).show({
        name: exam.template,
        hash: exam.template_version,
      });
    } else delete exam.template_version;
    const why = reasonSchema.parse(reason ?? "Exam definition configuration");
    return this.store.db.transaction(() => {
      const prior = this.record(exam.id);
      if (expected === null && prior)
        return failure(
          "Exam definition already exists; reload its settings/current revision, or use web exams show followed by update --revision HASH",
          409,
        );
      if (
        expected !== null &&
        (!prior || this.describe(prior).revision !== expected)
      )
        return failure(
          "Exam definition changed; reload current settings with web exams show, review the differences, then submit a new intent with the current revision",
          409,
        );
      const config = JSON.stringify(exam);
      if (prior)
        this.store.db
          .prepare("UPDATE exams SET config=? WHERE id=?")
          .run(config, exam.id);
      else
        this.store.db
          .prepare("INSERT INTO exams(id,config) VALUES(?,?)")
          .run(exam.id, config);
      this.store.audit(
        actor,
        "configure-exam",
        exam.id,
        JSON.stringify({
          reason: why,
          beforeRevision: prior ? this.describe(prior).revision : null,
          revision: this.show(exam.id).revision,
          before: prior ? JSON.parse(prior.config) : null,
          exam,
        }),
      );
      return this.show(exam.id);
    })();
  }
}
