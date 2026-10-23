import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { examSchema } from "../../../packages/protocol/index.js";
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
} from "../../../packages/protocol/grants.js";
import { hash, now, type Store, type Attempt } from "./db.js";
import { TemplateCatalog } from "./template-catalog.js";

const conflict = (message: string): never => {
  throw Object.assign(Error(message), { statusCode: 409 });
};
// Real callers: shared enrollment/CSV, shared web/root management, student
// preflight/Begin, signed native verification and positive lifecycle receipts.
export class AttemptGrants {
  constructor(
    private store: Store,
    private agent: string,
  ) {}
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
  snapshot(input: unknown, selectedWork?: unknown) {
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
        "Grants require an exact authenticated template version before authorization; run templates verify/sync, then web exams update --template-version HASH. No grant or enrollment changed.",
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
    return { settings, work, hash: hash(JSON.stringify({ settings, work })) };
  }
  initial(
    exam: string,
    username: string,
    duration: number | null,
    webcam: boolean | null,
    actor: string,
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
    const value = this.snapshot(settings, work),
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
          "Unused practice authority is expired or revoked. Inspect examctl web grants list sandbox; explicitly revise an expired unused grant, or review NEW authority with web grants additional-preview sandbox --duration-minutes 5. No automatic replacement or clock authorized.",
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
          "Previous practice consumption, protected completion or access release is unconfirmed; inspect the original attempt. No new allowance authorized.",
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
          "Previous practice is unresolved or restricted; preserve its original attempt/clock and complete supported cancellation or protection/release before a new allowance.",
        );
      const definition = JSON.parse(
        (
          this.store.db
            .prepare("SELECT config FROM exams WHERE id='sandbox'")
            .get() as any
        ).config,
      );
      const value = this.snapshot(definition);
      if (now() < value.settings.earliest || now() > value.settings.latest)
        return conflict(
          "Outside configured practice Begin window; inspect examctl web exams show sandbox. No grant, account or clock reserved.",
        );
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
    const id = randomUUID(),
      at = now();
    this.store.db
      .prepare(
        "INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance,initial_grant) VALUES(?,?,?,?,1,'AVAILABLE',?,?,?,?,?)",
      )
      .run(
        id,
        this.agent,
        exam,
        username,
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
    if (row.status !== "AVAILABLE" || row.revision !== revision)
      return conflict(
        "Grant is unavailable or revision changed; inspect examctl web grants show GRANT before a new intent",
      );
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM grant_begin_intents b JOIN grant_claims c ON c.attempt=b.attempt WHERE c.grant_id=? AND (b.state='CONSUMED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL)",
        )
        .get(id)
    )
      return conflict(
        "Durable Begin consumption/interval evidence prevents unused revision or revocation; preserve grant history and inspect the original native attempt",
      );
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM grant_claims WHERE grant_id=? AND state<>'CANCELLED'",
        )
        .get(id)
    )
      return conflict(
        "Grant has an unresolved preparation/Begin or a committed attempt; positively cancel an unstarted preparation first, or inspect the original attempt. No withdrawal/refund confirmed.",
      );
    return row;
  }
  revise(id: string, input: unknown, actor: string) {
    const b = grantRevision.parse(input);
    return this.request(actor, b.request, { id, ...b }, () => {
      const row = this.unused(id, b.revision),
        previous = this.view(row);
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
        .prepare("UPDATE attempt_grants SET revision=? WHERE id=?")
        .run(revision, id);
      this.store.audit(
        actor,
        "revise-unused-grant",
        id,
        JSON.stringify({ revision, reason: b.reason, hash: value.hash }),
      );
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
    const rows = this.store.db
      .prepare(
        "SELECT g.id FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.agent=? AND g.exam=? AND g.username=? AND g.status='AVAILABLE' AND json_extract(r.settings,'$.latest')>=? ORDER BY g.rowid LIMIT 201",
      )
      .all(this.agent, exam, username, now()) as any[];
    if (rows.length > 200)
      return conflict(
        "Too many unused grants to select safely; ask the instructor to inspect/revoke unneeded authorizations, preserving their history",
      );
    return rows.map((r) => this.view(this.row(r.id)));
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
      );
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
  begin(a: Attempt, transport: string) {
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
        if (prior.state !== "PENDING" || prior.transport !== transport)
          return conflict(
            "Original Begin intent/owner changed; inspect its exact native outcome, never create a replacement clock",
          );
        return prior.id as string;
      }
      const id = randomUUID();
      this.store.db
        .prepare(
          "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at) VALUES(?,?,?,'PENDING',?)",
        )
        .run(id, a.id, transport, now());
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
  verifyBegin(input: unknown) {
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
    this.store.db
      .prepare("UPDATE grant_begin_intents SET verified_at=? WHERE id=?")
      .run(now(), b.intent);
    return {
      type: "grant-begin/v1",
      audience: this.agent,
      nonce: b.nonce,
      expires: now() + 30000,
      attempt: b.attempt,
      grant: b.grant,
      intent: b.intent,
      transport: b.transport,
      boot: b.boot,
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
          : {
              kind: "template",
              template: expected.work.name,
              version: expected.work.hash,
            };
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
        "SELECT state,start,deadline FROM grant_begin_intents WHERE id=? AND attempt=?",
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
    this.store.db.transaction(() => {
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
        "Cancelled preparation lacks its exact retained grant claim; preserve history and restore matching authority before retirement",
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
          "Cancelled preparation contradicts original issuance/type evidence; preserve grant/monitoring history before retirement",
        );
    }
    if (
      this.store.db
        .prepare(
          "SELECT 1 FROM attempt_grants WHERE id=? AND status='CONSUMED' UNION ALL SELECT 1 FROM grant_claims c LEFT JOIN grant_begin_intents b ON b.attempt=c.attempt WHERE c.grant_id=? AND (c.state='CONSUMED' OR b.state='CONSUMED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL) UNION ALL SELECT 1 FROM attempts WHERE grant_id=? AND (start IS NOT NULL OR deadline IS NOT NULL OR original_deadline IS NOT NULL OR protected<>0 OR checksum IS NOT NULL) LIMIT 1",
        )
        .get(a.grant_id, a.grant_id, a.grant_id)
    )
      return conflict(
        "Cancellation contradicts durable grant consumption/interval evidence; preserve history and inspect native status before retirement",
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
