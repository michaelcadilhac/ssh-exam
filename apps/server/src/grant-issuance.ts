import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  grantIssuePreview,
  grantIssueIntent,
  grantAdditionalPreview,
  grantReviewList,
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
  private eligible(exam: string, username: string, additional = false) {
    const enrollment = this.store.db
      .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
      .get(exam, username) as any;
    if (
      !enrollment ||
      (!additional &&
        (this.store.db
          .prepare("SELECT 1 FROM attempts WHERE exam=? AND username=?")
          .get(exam, username) ||
          this.store.db
            .prepare("SELECT 1 FROM attempt_grants WHERE exam=? AND username=?")
            .get(exam, username)))
    )
      return refuse(
        additional
          ? `Student ${username} is not enrolled. Add them to this exam before allowing another attempt. This request allowed no attempts.`
          : `Student ${username} must be enrolled and have no earlier allowed attempts or exam history. Check their enrollment and Allowed attempts. This request allowed no attempts.`,
      );
    return enrollment;
  }
  preview(input: unknown, actor: string) {
    return this.previewSelection(grantIssuePreview.parse(input), actor, false);
  }
  additional(input: unknown, actor: string) {
    return this.previewSelection(
      grantAdditionalPreview.parse(input),
      actor,
      true,
    );
  }
  list(input: unknown, actor: string) {
    const b = grantReviewList.parse(input),
      previous = b.after ? this.row(b.after, actor) : null;
    if (previous && JSON.parse(previous.snapshot).exam !== b.exam)
      return refuse(
        "The request list changed exam. Refresh it before continuing.",
      );
    const rows = this.store.db
      .prepare(
        `SELECT id FROM grant_issuance_previews
      WHERE agent=? AND actor=? AND json_extract(snapshot,'$.exam')=?
      ${previous ? "AND (created<? OR (created=? AND id<?))" : ""}
      ORDER BY created DESC,id DESC LIMIT ?`,
      )
      .all(
        this.agent,
        actor,
        b.exam,
        ...(previous ? [previous.created, previous.created, previous.id] : []),
        b.limit + 1,
      ) as any[];
    const visible = rows.slice(0, b.limit);
    return {
      agent: this.agent,
      exam: b.exam,
      actor,
      rows: visible.map((row) => {
        const r = this.show(row.id, actor);
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          created: r.created,
          expires: r.expires,
          reason: r.reason,
          usernames: r.rows.map((student: any) => student.username),
        };
      }),
      next: rows.length > b.limit ? visible.at(-1)!.id : null,
    };
  }
  private previewSelection(
    b: z.infer<typeof grantIssuePreview> & {
      duration?: number;
      preserve_duration?: true;
      webcam?: boolean;
      work?: z.infer<typeof grantAdditionalPreview>["work"];
      saved_sources?: z.infer<typeof grantAdditionalPreview>["saved_sources"];
      work_sources?: z.infer<typeof grantAdditionalPreview>["work_sources"];
      student_settings?: z.infer<
        typeof grantAdditionalPreview
      >["student_settings"];
    },
    actor: string,
    additional: boolean,
  ) {
    return this.grants.request(
      actor,
      b.request,
      { operation: additional ? "additional-preview" : "issue-preview", ...b },
      () => {
        if (isSandbox(b.exam) && !additional)
          return refuse(
            "Sandbox uses repeatable practice; explicit NEW authority uses web grants additional-preview sandbox --duration-minutes 5, not legacy initial issuance",
          );
        if (
          isSandbox(b.exam) &&
          ((b.duration !== undefined && b.duration !== 300) ||
            b.webcam === true)
        )
          return refuse(
            "Sandbox practice grants are fixed at five minutes/no webcam; use --duration-minutes 5 and omit webcam or select optional. No grant issued.",
          );
        const definition = this.definitions.requireActive(b.exam);
        if (
          definition.revision !== b.definition_revision ||
          definition.exam.template_version !== b.template_version
        )
          return refuse(
            "The exam settings or selected files changed. Refresh them and review again. This request allowed no attempts.",
          );
        if (b.latest <= now())
          return refuse(
            "Choose opening and closing times with a closing time in the future. This request allowed no attempts.",
          );
        const sources = new Map(
          (
            b.work_sources ??
            b.saved_sources?.map((s) => ({
              username: s.username,
              work: {
                kind: "saved" as const,
                attempt: s.attempt,
                checksum: s.checksum,
              },
            }))
          )?.map((s) => [s.username, s.work]),
        );
        const overrides = new Map(
          b.student_settings?.map((s) => [s.username, s]),
        );
        const rows = [...b.usernames].sort().map((username) => {
          const enrollment = this.eligible(b.exam, username, additional);
          const source = sources.get(username);
          const override = overrides.get(username);
          const value = this.grants.snapshot(
            {
              ...definition.exam,
              earliest: b.earliest,
              latest: b.latest,
              duration: additional
                ? (override?.duration ??
                  (b.preserve_duration
                    ? isSandbox(b.exam)
                      ? 300
                      : (enrollment.duration ?? definition.exam.duration)
                    : b.duration!))
                : (enrollment.duration ?? definition.exam.duration),
              webcam: isSandbox(b.exam)
                ? false
                : additional && override?.webcam !== undefined
                  ? override.webcam
                  : additional && b.webcam !== undefined
                    ? b.webcam
                    : enrollment.webcam === null
                      ? definition.exam.webcam
                      : !!enrollment.webcam,
            },
            source ?? b.work,
            username,
          );
          const replaces = additional
            ? this.grants.replacements(b.exam, username)
            : [];
          return {
            username,
            enrollment: JSON.stringify(enrollment),
            ...value,
            replaces,
            ...(additional
              ? {
                  existing_grants: replaces.length,
                }
              : {}),
          };
        });
        const id = randomUUID(),
          created = now(),
          snapshot = JSON.stringify({
            kind: isSandbox(b.exam)
              ? "NEW_SANDBOX_PRACTICE_GRANTS"
              : additional
                ? "NEW_ADDITIONAL_TEMPLATE_GRANTS"
                : "NEW_LEGACY_INITIAL_GRANTS",
            agent: this.agent,
            exam: b.exam,
            actor,
            definition_revision: b.definition_revision,
            replacement_policy: "single-unused-v1",
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
          isSandbox(b.exam)
            ? "preview-practice-grants"
            : additional
              ? "preview-additional-template-grants"
              : "preview-new-legacy-grants",
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
              "These attempts were already allowed. Open Allowed attempts to change or cancel unused ones. Cancelling this review cannot remove history.",
            );
          this.store.db
            .prepare(
              "UPDATE grant_issuance_previews SET status='CANCELLED' WHERE id=?",
            )
            .run(id);
          this.store.audit(
            actor,
            saved.kind === "NEW_ADDITIONAL_TEMPLATE_GRANTS"
              ? "cancel-additional-template-grants"
              : "cancel-new-legacy-grants",
            id,
          );
          return this.show(id, actor);
        }
        if (row.status === "CONFIRMED") return this.show(id, actor); // Same immutable review, never another issuance.
        if (row.status !== "REVIEW" || row.expires <= now())
          return refuse(
            "This review was cancelled or expired. Create a new review before allowing attempts. This request did not allow attempts or reserve accounts.",
          );
        if (
          saved.kind !== "NEW_LEGACY_INITIAL_GRANTS" &&
          (saved.replacement_policy !== "single-unused-v1" ||
            b.replacement_policy !== "single-unused-v1")
        )
          return refuse(
            "This request uses an older attempt policy. Edit and review again before confirming; update examctl if using the CLI. No allowed attempt changed.",
          );
        if (
          this.definitions.requireActive(saved.exam).revision !==
          saved.definition_revision
        )
          return refuse(
            "The exam settings changed after this review. Create a new review. This request allowed no attempts.",
          );
        for (const r of saved.rows) {
          if (
            JSON.stringify(
              this.eligible(
                saved.exam,
                r.username,
                saved.kind !== "NEW_LEGACY_INITIAL_GRANTS",
              ),
            ) !== r.enrollment
          )
            return refuse(
              `Enrollment or settings for ${r.username} changed after this review. Create a new review. This request allowed no attempts.`,
            );
          if (
            saved.kind !== "NEW_LEGACY_INITIAL_GRANTS" &&
            (!Array.isArray(r.replaces) ||
              !isDeepStrictEqual(
                this.grants.replacements(saved.exam, r.username),
                r.replaces,
              ))
          )
            return refuse(
              `Allowed attempts for ${r.username} changed after this review. Create a new review. No permission was replaced and no exam time started.`,
            );
          if (r.settings.latest <= now())
            return refuse(
              "The reviewed start window has closed. Choose new opening and closing times and create a new review. This request allowed no attempts.",
            );
        }
        const issued = saved.rows.map((r: any) => {
          const grant =
            saved.kind !== "NEW_LEGACY_INITIAL_GRANTS"
              ? this.grants.additional(
                  r.settings,
                  r.username,
                  actor,
                  saved.reason,
                  r.work,
                )
              : this.grants.reviewedInitial(
                  r.settings,
                  r.username,
                  actor,
                  saved.reason,
                );
          if (grant.hash !== r.hash)
            return refuse(
              "Reviewed source/settings hash differs at confirmation; no partial batch issued",
            );
          return {
            username: r.username,
            grant: grant.id,
            replaced: r.replaces ?? [],
          };
        });
        this.store.db
          .prepare(
            "UPDATE grant_issuance_previews SET status='CONFIRMED',issued=? WHERE id=?",
          )
          .run(JSON.stringify(issued), id);
        this.store.audit(
          actor,
          saved.kind === "NEW_SANDBOX_PRACTICE_GRANTS"
            ? "confirm-practice-grants"
            : saved.kind === "NEW_ADDITIONAL_TEMPLATE_GRANTS"
              ? "confirm-additional-template-grants"
              : "confirm-new-legacy-grants",
          id,
          JSON.stringify({ revision: row.revision, issued }),
        );
        return this.show(id, actor);
      },
    );
  }
}
