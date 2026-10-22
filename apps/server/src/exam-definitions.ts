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

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reasonSchema = z.string().trim().min(8).max(1000);
const failure = (message: string, statusCode: number): never => {
  throw Object.assign(Error(message), { statusCode });
};

// The only definition writer for browser and root CLI. Attempt/grant snapshots,
// native work/submissions, clocks and account policy are never rewritten here.
export class ExamDefinitions {
  constructor(private store: Store) {}
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
  private describe(row: { config: string }) {
    return { exam: JSON.parse(row.config), revision: hash(row.config) };
  }
  show(id: string) {
    idSchema.parse(id);
    const row = this.store.db
      .prepare("SELECT config FROM exams WHERE id=?")
      .get(id) as { config: string } | undefined;
    if (!row)
      return failure(
        "Exam definition not found; use examctl web exams list",
        404,
      );
    return this.describe(row);
  }
  all() {
    return (
      this.store.db
        .prepare("SELECT config FROM exams ORDER BY (id='sandbox'),rowid")
        .all() as { config: string }[]
    ).map((row) => {
      const d = this.describe(row);
      return { ...d.exam, revision: d.revision };
    });
  }
  page(after: string, limit: number) {
    const rows = this.store.db
      .prepare("SELECT id,config FROM exams WHERE id>? ORDER BY id LIMIT ?")
      .all(after, limit + 1) as { id: string; config: string }[];
    const page = rows.slice(0, limit);
    return {
      exams: page.map((row) => this.describe(row)),
      next: rows.length > limit ? page.at(-1)!.id : null,
    };
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
      const current = this.show(id);
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
    const why = reasonSchema.parse(reason ?? "Exam definition configuration");
    return this.store.db.transaction(() => {
      const prior = this.store.db
        .prepare("SELECT config FROM exams WHERE id=?")
        .get(exam.id) as { config: string } | undefined;
      if (expected === null && prior)
        return failure(
          "Exam definition already exists; reload its settings/current revision, or use web exams show followed by update --revision HASH",
          409,
        );
      if (expected !== null && (!prior || hash(prior.config) !== expected))
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
          beforeRevision: prior ? hash(prior.config) : null,
          revision: hash(config),
          before: prior ? JSON.parse(prior.config) : null,
          exam,
        }),
      );
      return { exam, revision: hash(config) };
    })();
  }
}
