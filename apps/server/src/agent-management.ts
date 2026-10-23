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
import { AttemptGrants } from "./attempt-grants.js";
import {
  parseRosterAsync,
  RosterUsernameError,
  type RosterRow,
} from "./roster.js";
import { z } from "zod";
import { ClockControl } from "./clock-control.js";
import {
  ClockManagement,
  assertClockCapabilities,
} from "./clock-management.js";
import { AttemptManagement } from "./attempt-management.js";
import { InterruptionManagement } from "./interruption-management.js";
import { MonitoringManagement } from "./monitoring-management.js";
import { TemplateCatalog } from "./template-catalog.js";
import { Monitoring } from "./monitoring.js";
import { monitoringExportFailure } from "./monitoring-export.js";
import { monitoringExportContentType } from "../../../packages/protocol/monitoring-export.js";
import {
  attemptShow,
  clockBatch,
  clockSingle,
} from "../../../packages/protocol/clock-management.js";
import {
  AlertManagement,
  alertPage,
  alertShow,
  alertTest,
} from "./alert-management.js";
import {
  AdministratorManagement,
  AdministratorManagementError,
  administratorUnavailable,
  readAdministratorCreationOutcome,
  type PreparedAdministrator,
} from "./administrator-management.js";
import {
  administratorShow,
  administratorUsername,
} from "../../../packages/protocol/administrator-management.js";

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
  clocks?: ClockControl,
  monitoring?: MonitoringManagement,
  administrators?: AdministratorManagement,
) {
  const definitions = new ExamDefinitions(store, config.agent.id);
  const templates = new TemplateCatalog(store, config.agent.id);
  const roster = new RosterManagement(store, describe, config.agent.id);
  const grants = new AttemptGrants(store, config.agent.id);
  const alerts = new AlertManagement(store, () => !!config.smtp);
  const interruptions = new InterruptionManagement(store);
  const administratorManagement =
    administrators ?? new AdministratorManagement(store);
  const monitoringReads =
    monitoring ??
    new MonitoringManagement(
      store,
      new Monitoring(store, config.terminalRecordingLimitMiB),
    );
  const attempts = clocks
    ? new AttemptManagement(store, clocks, describe)
    : null;
  const clockManagement =
    clocks && attempts ? new ClockManagement(store, clocks, attempts) : null;
  app.addContentTypeParser(
    "application/vnd.ssh-exam-management",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.post(
    "/api/agent/management",
    { bodyLimit: 12 * 1024 * 1024 },
    async (req, reply) => {
      const payload = req.body;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw signed management request required");
      let decoded: unknown;
      try {
        agent.verifyCallback(
          payload,
          String(req.headers["x-exam-signature"] || ""),
        );
        try {
          decoded = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(payload),
          );
        } catch {
          throw Object.assign(
            Error("Malformed management JSON; no operation confirmed"),
            { statusCode: 400 },
          );
        }
      } finally {
        payload.fill(0);
        req.body = undefined;
      }
      const parsedRequest = managementRequest.safeParse(decoded);
      if (!parsedRequest.success) {
        const body = (decoded as { body?: unknown } | null)?.body;
        if (body && typeof body === "object" && "password" in body)
          (body as { password: unknown }).password = "";
        throw Object.assign(
          Error("Invalid management request schema; no operation confirmed"),
          { statusCode: 400 },
        );
      }
      const r = parsedRequest.data;
      decoded = undefined;
      try {
        if (
          r.operation !== "administrators.create" &&
          r.body &&
          typeof r.body === "object" &&
          "password" in r.body
        )
          throw Object.assign(
            Error(
              "Credential fields are supported only by the named administrator creation workflow; no operation confirmed",
            ),
            { statusCode: 400 },
          );
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
        const credentialCreation = r.operation === "administrators.create";
        let preparedAdministrator: PreparedAdministrator | undefined;
        let credentialPreparationError:
          | AdministratorManagementError
          | undefined;
        if (
          credentialCreation &&
          !config.loginOnly &&
          config.agent.managementOperations?.includes(r.operation) &&
          !store.db
            .prepare(
              "SELECT 1 FROM agent_management_nonces WHERE agent=? AND nonce=?",
            )
            .get(r.agent, r.nonce)
        ) {
          try {
            const prior = store.db
              .prepare(
                "SELECT fingerprint FROM agent_management_requests WHERE agent=? AND request=?",
              )
              .get(r.agent, r.request) as { fingerprint: string } | undefined;
            preparedAdministrator = await administratorManagement.prepare(
              r.body,
              prior?.fingerprint,
            );
          } catch (error) {
            credentialPreparationError =
              error instanceof AdministratorManagementError
                ? error
                : new AdministratorManagementError(
                    "Administrator credential preparation unavailable; no creation confirmed. Inspect current administrators and retry the same intent.",
                    503,
                  );
          }
        }
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
          if (
            !(config.agent.managementOperations || []).includes(r.operation)
          ) {
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
          if (
            credentialCreation &&
            (!preparedAdministrator || credentialPreparationError)
          ) {
            store.audit(
              actor,
              "management-administrators.create-refused",
              r.request,
              "credential-preparation-unconfirmed",
            );
            return refusal(
              credentialPreparationError?.message ??
                "Administrator credential preparation unavailable; retry the same intent with a fresh nonce",
              credentialPreparationError?.statusCode ?? 503,
            );
          }
          // NEVER use the generic fast body hash for credential operations.
          const fingerprint = credentialCreation
            ? preparedAdministrator!.fingerprint
            : hash(JSON.stringify({ operation: r.operation, body: r.body }));
          const prior = store.db
            .prepare(
              "SELECT fingerprint,outcome FROM agent_management_requests WHERE agent=? AND request=?",
            )
            .get(r.agent, r.request) as
            | { fingerprint: string; outcome: string }
            | undefined;
          if (prior) {
            if (credentialCreation) {
              try {
                administratorManagement.assertReceipt(
                  preparedAdministrator!,
                  prior.fingerprint,
                );
                const original = readAdministratorCreationOutcome(
                  prior.outcome,
                  preparedAdministrator!.username,
                );
                store.audit(actor, "management-retry", r.request, r.operation);
                return original;
              } catch (error) {
                return refusal((error as Error).message, 409);
              }
            }
            store.audit(actor, "management-retry", r.request, r.operation);
            return prior.fingerprint === fingerprint
              ? JSON.parse(prior.outcome)
              : refusal(
                  "Request ID conflicts with different operation/arguments; inspect the original result and use a new request ID for a different intent",
                );
          }
          if (credentialCreation) {
            try {
              administratorManagement.assertReceipt(preparedAdministrator!);
            } catch (error) {
              return refusal((error as Error).message, 409);
            }
          }
          let result: Outcome;
          try {
            // Future mutation services must roll back their own failure, while the
            // outer transaction can still retain the authenticated failed outcome.
            result = store.db.transaction((): Outcome => {
              if (r.operation === "administrators.list") {
                return {
                  ok: true,
                  status: 200,
                  result: administratorManagement.page(r.body),
                };
              } else if (r.operation === "administrators.show") {
                return {
                  ok: true,
                  status: 200,
                  result: administratorManagement.show(
                    administratorShow.parse(r.body).username,
                  ),
                };
              } else if (r.operation === "administrators.create") {
                return {
                  ok: true,
                  status: 200,
                  result: administratorManagement.create(
                    preparedAdministrator!,
                    actor,
                  ),
                };
              } else if (r.operation === "exams.list") {
                const b = examListRequest.parse(r.body);
                return {
                  ok: true,
                  status: 200,
                  result: definitions.page(b.after || "", b.limit),
                };
              } else if (r.operation === "exams.show") {
                const b = examShowRequest.parse(r.body);
                return {
                  ok: true,
                  status: 200,
                  result: definitions.show(b.id),
                };
              } else if (r.operation === "exams.create") {
                const b = examCreateRequest.parse(r.body);
                if (
                  "template_version" in b.exam &&
                  b.source_selection !== "template-version/v1"
                )
                  throw Error(
                    "Exact-source writes require the source-selection protocol marker; update examctl and inspect current definitions before retrying",
                  );
                return {
                  ok: true,
                  status: 200,
                  result: definitions.create(b.exam, actor, b.reason),
                };
              } else if (r.operation === "exams.update") {
                const b = examUpdateRequest.parse(r.body);
                if (
                  "template_version" in b.changes &&
                  b.source_selection !== "template-version/v1"
                )
                  throw Error(
                    "Exact-source writes require the source-selection protocol marker; update examctl and inspect current definitions before retrying",
                  );
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
              } else if (r.operation.startsWith("grants.")) {
                const raw = z.record(z.string(), z.unknown()).parse(r.body);
                let value: unknown;
                switch (r.operation) {
                  case "grants.list":
                    value = grants.list(raw);
                    break;
                  case "grants.show":
                    value = grants.show(raw);
                    break;
                  case "grants.revise": {
                    const { id, ...b } = raw;
                    value = grants.revise(
                      z.string().uuid().parse(id),
                      b,
                      actor,
                    );
                    break;
                  }
                  case "grants.revoke": {
                    const { id, ...b } = raw;
                    value = grants.revoke(
                      z.string().uuid().parse(id),
                      b,
                      actor,
                    );
                    break;
                  }
                  default:
                    throw Error("Unsupported grant management operation");
                }
                return { ok: true, status: 200, result: value };
              } else if (r.operation.startsWith("templates.")) {
                let value: unknown;
                switch (r.operation) {
                  case "templates.list":
                    value = templates.page(r.body);
                    break;
                  case "templates.show":
                    value = templates.show(r.body);
                    break;
                  case "templates.sync":
                    value = templates.sync(r.body, {
                      agent: r.agent,
                      actor,
                      request: r.request,
                      issued: r.issued,
                      observed,
                    });
                    break;
                  default:
                    throw Error("Unsupported template catalog operation");
                }
                return { ok: true, status: 200, result: value };
              } else if (
                r.operation === "monitoring.purges" ||
                r.operation === "monitoring.purge"
              ) {
                return {
                  ok: true,
                  status: 200,
                  result:
                    r.operation === "monitoring.purges"
                      ? monitoringReads.purges(r.body, actor)
                      : monitoringReads.purge(r.body, actor),
                };
              } else if (r.operation === "monitoring.delete") {
                return {
                  ok: true,
                  status: 200,
                  result: monitoringReads.delete(r.body, actor),
                };
              } else if (r.operation.startsWith("monitoring.")) {
                return {
                  ok: true,
                  status: 200,
                  result: monitoringReads.receipt(r.operation, r.body),
                };
              } else if (r.operation.startsWith("interruptions.")) {
                let value: unknown;
                switch (r.operation) {
                  case "interruptions.show":
                    value = interruptions.show(r.body);
                    break;
                  case "interruptions.review":
                    value = interruptions.receipt(r.body);
                    break;
                  case "interruptions.authorize":
                    value = interruptions.authorize(r.body, actor);
                    break;
                  default:
                    throw Error(
                      "Unsupported interruption management operation",
                    );
                }
                return { ok: true, status: 200, result: value };
              } else if (
                r.operation.startsWith("attempts.") ||
                r.operation.startsWith("clocks.")
              ) {
                if (!attempts || !clockManagement)
                  throw Error(
                    "Clock management is unavailable; inspect gateway configuration",
                  );
                let value: unknown;
                switch (r.operation) {
                  case "attempts.list":
                    value = attempts.page(r.body);
                    break;
                  case "attempts.show":
                    value = attempts.show(attemptShow.parse(r.body).id);
                    break;
                  case "clocks.show":
                    value = clockManagement.show(r.body);
                    break;
                  case "clocks.preview":
                    value = clockManagement.preview(r.body);
                    break;
                  case "clocks.reset":
                  case "clocks.extend": {
                    const b = clockSingle.parse(r.body);
                    const extend = r.operation === "clocks.extend";
                    assertClockCapabilities(
                      agent.configurationHealth(),
                      extend,
                    );
                    value = clockManagement.single(b, actor, extend);
                    break;
                  }
                  case "clocks.batch": {
                    const b = clockBatch.parse(r.body);
                    assertClockCapabilities(
                      agent.configurationHealth(),
                      b.action === "extend",
                    );
                    value = clockManagement.batch(b, actor);
                    break;
                  }
                  default:
                    throw Error(
                      "Unsupported attempt/clock management operation",
                    );
                }
                return { ok: true, status: 200, result: value };
              } else if (r.operation.startsWith("alerts.")) {
                let value: unknown;
                switch (r.operation) {
                  case "alerts.list":
                    value = alerts.page(alertPage.parse(r.body));
                    break;
                  case "alerts.show":
                    value = alerts.show(alertShow.parse(r.body).id);
                    break;
                  case "alerts.test":
                    alertTest.parse(r.body);
                    value = alerts.test(actor);
                    break;
                  case "alerts.remind":
                    value = alerts.remind(r.body, actor);
                    break;
                  default:
                    throw Error("Unsupported alert management operation");
                }
                return { ok: true, status: 200, result: value };
              } else {
                const b = studentManagement.parse(r.body);
                let value: unknown;
                switch (r.operation) {
                  case "students.list": {
                    const page = studentListRequest.parse(r.body);
                    value = roster.page(
                      page.exam,
                      page.after || "",
                      page.limit,
                    );
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
              (r.operation.startsWith("administrators.") &&
              !(error instanceof AdministratorManagementError)
                ? administratorUnavailable
                : error instanceof RosterUsernameError
                  ? error.safeMessage()
                  : (error as Error).message
              ).slice(0, 1500),
              (error as Error & { statusCode?: number }).statusCode ||
                (credentialCreation ? 503 : 400),
            );
          }
          store.audit(
            actor,
            "management-" + r.operation,
            r.request,
            JSON.stringify({
              confirmed: result.ok,
              operation: r.operation,
              target: r.operation.startsWith("administrators.")
                ? (administratorUsername.safeParse(
                    (r.body as { username?: unknown } | null)?.username,
                  ).data ?? "administrators")
                : r.operation.startsWith("templates.")
                  ? "template-catalog"
                  : r.operation === "monitoring.purges"
                    ? "monitoring-purges"
                    : r.operation.startsWith("attempts.") ||
                        r.operation.startsWith("clocks.") ||
                        r.operation.startsWith("interruptions.") ||
                        r.operation.startsWith("monitoring.")
                      ? attemptShow.safeParse({
                          id: (r.body as { id?: unknown } | null)?.id,
                        }).data?.id ||
                        studentManagement.safeParse(r.body).data?.exam ||
                        "clocks"
                      : r.operation.startsWith("alerts.")
                        ? z
                            .string()
                            .uuid()
                            .safeParse((r.body as { id?: unknown } | null)?.id)
                            .data || "notifications"
                        : r.operation === "exams.show"
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
        let response = outcome;
        if (outcome.ok && r.operation === "monitoring.export") {
          const abort = new AbortController();
          const canceled = () => abort.abort();
          const timer = setTimeout(canceled, 30 * 60 * 1000);
          timer.unref();
          req.raw.once("aborted", canceled);
          reply.raw.once("close", canceled);
          const detach = () => {
            clearTimeout(timer);
            req.raw.removeListener("aborted", canceled);
            reply.raw.removeListener("close", canceled);
          };
          try {
            const stream = await monitoringReads.exports.open(
              r.body,
              outcome.result,
              actor,
              { agent: r.agent, request: r.request, nonce: r.nonce },
              () => agent.exportSigner(),
              abort.signal,
            );
            stream.once("close", detach);
            return reply.type(monitoringExportContentType).send(stream);
          } catch (error) {
            detach();
            const failure = monitoringExportFailure(error);
            response = {
              ok: false,
              status: failure.status,
              error: failure.message,
            };
          }
        }
        if (
          outcome.ok &&
          r.operation.startsWith("monitoring.") &&
          ![
            "monitoring.delete",
            "monitoring.purges",
            "monitoring.purge",
            "monitoring.export",
          ].includes(r.operation)
        ) {
          try {
            response = {
              ...outcome,
              result:
                r.operation === "monitoring.image"
                  ? await monitoringReads.image(r.body, outcome.result, actor)
                  : monitoringReads.read(
                      r.operation,
                      r.body,
                      outcome.result,
                      actor,
                    ),
            };
          } catch (error) {
            response = {
              ok: false,
              status: (error as any).statusCode || 409,
              error: (error as Error).message.slice(0, 1500),
            };
          }
        }
        if (outcome.ok && r.operation === "interruptions.review") {
          try {
            response = {
              ...outcome,
              result: interruptions.review(
                r.body,
                outcome.result as { generation: number; revision: number },
                actor,
              ),
            };
          } catch (error) {
            response = {
              ok: false,
              status: (error as any).statusCode || 409,
              error: (error as Error).message.slice(0, 1500),
            };
          }
        }
        // Sign after the durable transaction. A lost HTTP/signing reply is recovered
        // with the same request ID, not by executing an intent twice.
        if (response.ok && r.operation === "monitoring.image") {
          try {
            monitoringReads.assertImageRetained(r.body);
          } catch (error) {
            response = {
              ok: false,
              status: (error as any).statusCode || 503,
              error: (error as Error).message.slice(0, 1500),
            };
          }
        }
        return agent.signTiming({
          version: 1,
          purpose: managementPurpose,
          audience: r.agent,
          request: r.request,
          nonce: r.nonce,
          operation: r.operation,
          at: now(),
          ...response,
        });
      } finally {
        if (r.body && typeof r.body === "object" && "password" in r.body)
          (r.body as { password: unknown }).password = "";
      }
    },
  );
}
