import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  grantIssuePreview,
  grantIssueIntent,
} from "../../../packages/protocol/grants.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { hash, now, type Store } from "./db.js";
import { AttemptGrants } from "./attempt-grants.js";
import { ExamDefinitions } from "./exam-definitions.js";

const refuse = (message: string, statusCode = 409): never => {
  throw Object.assign(Error(message), { statusCode });
};
// Runtime callers: shared root/web review, inspect, cancel and confirm routes.
// Preview is metadata, never an account reservation or native admission proof.
export class GrantIssuance {
  private grants: AttemptGrants;
  private definitions: ExamDefinitions;
  constructor(
    private store: Store,
    private agent: string,
  ) {
    this.grants = new AttemptGrants(store, agent);
    this.definitions = new ExamDefinitions(store, agent);
  }
  private eligible(exam: string, username: string) {
    const enrollment = this.store.db
      .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
      .get(exam, username) as any;
    if (
      !enrollment ||
      this.store.db
        .prepare("SELECT 1 FROM attempts WHERE exam=? AND username=?")
        .get(exam, username) ||
      this.store.db
        .prepare("SELECT 1 FROM attempt_grants WHERE exam=? AND username=?")
        .get(exam, username)
    )
      return refuse(
        `Student ${username} is not a legacy unused enrollment: enrollment required, with no grant or attempt history. Inspect web students/grants list; no batch issued.`,
      );
    return enrollment;
  }
  preview(input: unknown, actor: string) {
    const b = grantIssuePreview.parse(input);
    return this.grants.request(
      actor,
      b.request,
      { operation: "issue-preview", ...b },
      () => {
        if (isSandbox(b.exam))
          return refuse(
            "Sandbox requires its repeatable practice workflow; legacy initial issuance is ordinary exams only",
          );
        const definition = this.definitions.show(b.exam);
        if (
          definition.revision !== b.definition_revision ||
          definition.exam.template_version !== b.template_version
        )
          return refuse(
            "Selected definition/source changed; run web exams show EXAM and review its exact current version before a new preview",
          );
        if (b.latest <= now())
          return refuse(
            "Choose an explicit finite Begin window that has not closed; no grant issued",
          );
        const rows = [...b.usernames].sort().map((username) => {
          const enrollment = this.eligible(b.exam, username);
          const value = this.grants.snapshot({
            ...definition.exam,
            earliest: b.earliest,
            latest: b.latest,
            duration: enrollment.duration ?? definition.exam.duration,
            webcam:
              enrollment.webcam === null
                ? definition.exam.webcam
                : !!enrollment.webcam,
          });
          return { username, enrollment: JSON.stringify(enrollment), ...value };
        });
        const id = randomUUID(),
          created = now(),
          snapshot = JSON.stringify({
            kind: "NEW_LEGACY_INITIAL_GRANTS",
            agent: this.agent,
            exam: b.exam,
            actor,
            definition_revision: b.definition_revision,
            reason: b.reason,
            rows,
          });
        this.store.db
          .prepare(
            "INSERT INTO grant_issuance_previews VALUES(?,?,?,?,?,?,?,'REVIEW','[]')",
          )
          .run(
            id,
            this.agent,
            actor,
            snapshot,
            hash(snapshot),
            created,
            created + 15 * 60000,
          );
        this.store.audit(
          actor,
          "preview-new-legacy-grants",
          id,
          JSON.stringify({
            exam: b.exam,
            usernames: rows.map((r) => r.username),
            revision: hash(snapshot),
          }),
        );
        return this.show(id, actor);
      },
    );
  }
  private row(id: string, actor: string) {
    z.string().uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT * FROM grant_issuance_previews WHERE id=? AND agent=?")
      .get(id, this.agent) as any;
    if (!row || row.actor !== actor)
      return refuse(
        "Issuance review is unavailable for this actor/class agent; inspect the original preview ID using its original identity",
        403,
      );
    if (hash(row.snapshot) !== row.revision)
      return refuse(
        "Issuance snapshot is inconsistent; preserve review/history and restore matching authority before confirmation",
      );
    return row;
  }
  show(id: string, actor: string) {
    const row = this.row(id, actor),
      saved = JSON.parse(row.snapshot);
    return {
      id,
      kind: saved.kind,
      agent: row.agent,
      exam: saved.exam,
      actor: row.actor,
      reason: saved.reason,
      definition_revision: saved.definition_revision,
      revision: row.revision,
      created: row.created,
      expires: row.expires,
      status:
        row.status === "REVIEW" && row.expires <= now()
          ? "EXPIRED"
          : row.status,
      rows: saved.rows.map(({ enrollment: _enrollment, ...r }: any) => r),
      issued: JSON.parse(row.issued),
    };
  }
  change(
    id: string,
    input: unknown,
    actor: string,
    operation: "confirm" | "cancel",
  ) {
    const b = grantIssueIntent.parse(input);
    return this.grants.request(
      actor,
      b.request,
      { operation: `issue-${operation}`, id, ...b },
      () => {
        const row = this.row(id, actor),
          saved = JSON.parse(row.snapshot);
        if (row.revision !== b.revision)
          return refuse(
            "Reviewed hash changed; inspect issue-show PREVIEW_UUID, then use its exact revision for a new intent",
          );
        if (operation === "cancel") {
          if (row.status === "CONFIRMED")
            return refuse(
              "Issuance already confirmed; inspect its grant IDs and explicitly revise/revoke unused grants. Cancellation cannot undo history.",
            );
          this.store.db
            .prepare(
              "UPDATE grant_issuance_previews SET status='CANCELLED' WHERE id=?",
            )
            .run(id);
          this.store.audit(actor, "cancel-new-legacy-grants", id);
          return this.show(id, actor);
        }
        if (row.status === "CONFIRMED") return this.show(id, actor); // Same immutable review, never another issuance.
        if (row.status !== "REVIEW" || row.expires <= now())
          return refuse(
            "Review cancelled or expired; create and inspect a NEW issue-preview. No allowance or account reservation was consumed.",
          );
        if (
          this.definitions.show(saved.exam).revision !==
          saved.definition_revision
        )
          return refuse(
            "Definition changed since review; create and inspect a NEW issue-preview. No partial batch issued.",
          );
        for (const r of saved.rows) {
          if (
            JSON.stringify(this.eligible(saved.exam, r.username)) !==
            r.enrollment
          )
            return refuse(
              `Enrollment for ${r.username} changed since review; create and inspect a NEW issue-preview. No partial batch issued.`,
            );
          if (r.settings.latest <= now())
            return refuse(
              "Reviewed Begin window has closed; select a new explicit window in a NEW preview. No grant issued.",
            );
        }
        const issued = saved.rows.map((r: any) => {
          const grant = this.grants.reviewedInitial(
            r.settings,
            r.username,
            actor,
            saved.reason,
          );
          if (grant.hash !== r.hash)
            return refuse(
              "Reviewed source/settings hash differs at confirmation; no partial batch issued",
            );
          return { username: r.username, grant: grant.id };
        });
        this.store.db
          .prepare(
            "UPDATE grant_issuance_previews SET status='CONFIRMED',issued=? WHERE id=?",
          )
          .run(JSON.stringify(issued), id);
        this.store.audit(
          actor,
          "confirm-new-legacy-grants",
          id,
          JSON.stringify({ revision: row.revision, issued }),
        );
        return this.show(id, actor);
      },
    );
  }
}
