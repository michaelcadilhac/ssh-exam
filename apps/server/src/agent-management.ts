import type { FastifyInstance } from "fastify";
import type { Config } from "../../../packages/config/index.js";
import {
  managementPurpose,
  managementRequest,
  examListRequest,
  examShowRequest,
  examCreateRequest,
  examUpdateRequest,
  studentManagement,
  studentListRequest,
} from "../../../packages/protocol/management.js";
import { hash, now, type Store } from "./db.js";
import type { Agent } from "./agent.js";
import { ExamDefinitions } from "./exam-definitions.js";
import { RosterManagement, rosterPreview } from "./roster-management.js";
import {
  parseRosterAsync,
  RosterUsernameError,
  type RosterRow,
} from "./roster.js";
import { z } from "zod";

type Outcome =
  | { ok: true; status: 200; result: unknown }
  | { ok: false; status: number; error: string };

// Gateway-owned operations only. No inbound native control route or arbitrary
// HTTP proxy. Add operations here only with their shared web service + CLI.
export function registerAgentManagement(
  app: FastifyInstance,
  store: Store,
  agent: Agent,
  config: Config,
  describe: (a: any) => any = (a) => a,
) {
  const definitions = new ExamDefinitions(store);
  const roster = new RosterManagement(store, describe);
  app.addContentTypeParser(
    "application/vnd.ssh-exam-management",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.post(
    "/api/agent/management",
    { bodyLimit: 12 * 1024 * 1024 },
    async (req) => {
      const payload = req.body;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw signed management request required");
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      const r = managementRequest.parse(JSON.parse(payload.toString("utf8")));
      const observed = now();
      if (
        r.audience !== config.origin ||
        r.agent !== config.agent.id ||
        r.issued > observed + 1000 ||
        r.issued < observed - 30000 ||
        r.expires <= observed ||
        r.expires <= r.issued ||
        r.expires > r.issued + 30000
      )
        throw Object.assign(
          Error("Management audience, identity or freshness rejected"),
          { statusCode: 403 },
        );
      const actor = `agent:${r.agent}:root`;
      // Pure CSV validation yields outside SQLite. The transaction below repeats
      // authorization/freshness and handles cached/replayed requests before use.
      let preparedRows: RosterRow[] | undefined;
      let preparationError: Error | undefined;
      const alreadyRecorded = !!store.db
        .prepare(
          "SELECT 1 FROM agent_management_requests WHERE agent=? AND request=?",
        )
        .get(r.agent, r.request);
      if (
        r.operation === "students.import-preview" &&
        !alreadyRecorded &&
        !config.loginOnly &&
        config.agent.managementOperations?.includes(r.operation)
      ) {
        try {
          const b = rosterPreview.parse(r.body);
          preparedRows = await parseRosterAsync(b.text, b.mode);
        } catch (error) {
          preparationError = error as Error;
        }
      }
      const refusal = (error: string, status = 409): Outcome => ({
        ok: false,
        status,
        error,
      });
      const outcome = store.db.transaction((): Outcome => {
        if (r.expires <= now())
          return refusal(
            "Management request expired during preparation; retry the same request ID with a fresh nonce",
            403,
          );
        if (config.loginOnly) {
          store.audit(actor, "management-refused", r.request, "login-only");
          return refusal(
            "Exam management is unavailable during login-only testing",
            403,
          );
        }
        if (!(config.agent.managementOperations || []).includes(r.operation)) {
          store.audit(
            actor,
            "management-refused",
            r.request,
            JSON.stringify({
              operation: r.operation,
              cause: "operation-not-authorized",
            }),
          );
          return refusal(
            "Management operation is not authorized for this agent; configure the explicit gateway managementOperations allowlist",
            403,
          );
        }
        store.db
          .prepare("DELETE FROM agent_management_nonces WHERE expires<?")
          .run(observed);
        if (
          store.db
            .prepare(
              "SELECT 1 FROM agent_management_nonces WHERE agent=? AND nonce=?",
            )
            .get(r.agent, r.nonce)
        ) {
          store.audit(
            actor,
            "management-replay-refused",
            r.request,
            r.operation,
          );
          return refusal(
            "Management nonce replay rejected; retry the same request ID with a fresh signed nonce",
          );
        }
        store.db
          .prepare("INSERT INTO agent_management_nonces VALUES(?,?,?)")
          .run(r.agent, r.nonce, r.expires);
        const fingerprint = hash(
          JSON.stringify({ operation: r.operation, body: r.body }),
        );
        const prior = store.db
          .prepare(
            "SELECT fingerprint,outcome FROM agent_management_requests WHERE agent=? AND request=?",
          )
          .get(r.agent, r.request) as
          | { fingerprint: string; outcome: string }
          | undefined;
        if (prior) {
          store.audit(actor, "management-retry", r.request, r.operation);
          return prior.fingerprint === fingerprint
            ? JSON.parse(prior.outcome)
            : refusal(
                "Request ID conflicts with different operation/arguments; inspect the original result and use a new request ID for a different intent",
              );
        }
        let result: Outcome;
        try {
          // Future mutation services must roll back their own failure, while the
          // outer transaction can still retain the authenticated failed outcome.
          result = store.db.transaction((): Outcome => {
            if (r.operation === "exams.list") {
              const b = examListRequest.parse(r.body);
              return {
                ok: true,
                status: 200,
                result: definitions.page(b.after || "", b.limit),
              };
            } else if (r.operation === "exams.show") {
              const b = examShowRequest.parse(r.body);
              return { ok: true, status: 200, result: definitions.show(b.id) };
            } else if (r.operation === "exams.create") {
              const b = examCreateRequest.parse(r.body);
              return {
                ok: true,
                status: 200,
                result: definitions.create(b.exam, actor, b.reason),
              };
            } else if (r.operation === "exams.update") {
              const b = examUpdateRequest.parse(r.body);
              return {
                ok: true,
                status: 200,
                result: definitions.update(
                  b.id,
                  b.changes,
                  b.revision,
                  actor,
                  b.reason,
                ),
              };
            } else {
              const b = studentManagement.parse(r.body);
              let value: unknown;
              switch (r.operation) {
                case "students.list": {
                  const page = studentListRequest.parse(r.body);
                  value = roster.page(page.exam, page.after || "", page.limit);
                  break;
                }
                case "students.add":
                  value = roster.add(b.exam, b, actor);
                  break;
                case "students.remove":
                  value = roster.remove(b.exam, b, actor);
                  break;
                case "students.settings":
                  value = roster.settings(b.exam, b, actor);
                  break;
                case "students.import-preview": {
                  if (preparationError) throw preparationError;
                  if (!preparedRows)
                    throw Error(
                      "CSV preparation unavailable; retry with the same request ID",
                    );
                  const input = rosterPreview.parse(b);
                  value = roster.previewRows(
                    b.exam,
                    preparedRows,
                    hash(input.text),
                    actor,
                  );
                  break;
                }
                case "students.import-confirm":
                  value = roster.confirm(
                    b.exam,
                    z.string().uuid().parse(b.id),
                    actor,
                  );
                  break;
                case "students.export":
                  value = { format: "csv", text: roster.export(b.exam) };
                  break;
                case "students.example":
                  value = { format: "csv", text: roster.example(b.exam) };
                  break;
                default:
                  throw Error("Unsupported management operation");
              }
              return { ok: true, status: 200, result: value };
            }
          })();
        } catch (error) {
          result = refusal(
            (error instanceof RosterUsernameError
              ? error.safeMessage()
              : (error as Error).message
            ).slice(0, 1500),
            (error as Error & { statusCode?: number }).statusCode || 400,
          );
        }
        store.audit(
          actor,
          "management-" + r.operation,
          r.request,
          JSON.stringify({
            confirmed: result.ok,
            operation: r.operation,
            target:
              r.operation === "exams.show"
                ? examShowRequest.safeParse(r.body).data?.id
                : "exams",
          }),
        );
        store.db
          .prepare("INSERT INTO agent_management_requests VALUES(?,?,?,?,?)")
          .run(
            r.agent,
            r.request,
            fingerprint,
            observed,
            JSON.stringify(result),
          );
        return result;
      })();
      // Sign after the durable transaction. A lost HTTP/signing reply is recovered
      // with the same request ID, not by executing an intent twice.
      return agent.signTiming({
        version: 1,
        purpose: managementPurpose,
        audience: r.agent,
        request: r.request,
        nonce: r.nonce,
        operation: r.operation,
        at: now(),
        ...outcome,
      });
    },
  );
}
