import { OPERATION_TIMEOUT_MS } from "../../../packages/protocol/timeouts.js";
import type { FastifyInstance } from "fastify";
import { isDeepStrictEqual } from "node:util";
import { examConfiguration } from "../../../packages/protocol/index.js";
import {
  collectionExecutionPolicy,
  examExecutionPolicy,
  examExecutionPolicyCapability,
  examExecutionPolicyReply,
  examExecutionPolicyRequest,
  executionPolicySupport,
  type ExamExecutionPolicy,
} from "../../../packages/protocol/exam-execution-policy.js";
import { z } from "zod";
import { now, type Store } from "./db.js";
import type { Agent } from "./agent.js";

const executionValues = examConfiguration.pick({
  terminals: true,
  collection_file_mib: true,
  collection_total_mib: true,
});
export class ExamExecutionPolicyError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 503,
  ) {
    super(message);
    this.name = "ExamExecutionPolicyError";
  }
}
const unavailable = (message: string, statusCode = 503): never => {
  throw new ExamExecutionPolicyError(message, statusCode);
};
const fresh = (at: unknown, observed: number) =>
  Number.isSafeInteger(at) &&
  observed - (at as number) >= -1000 &&
  observed - (at as number) < 120000;

const protectedFile = z.object({
  path: z.string().min(1).max(4096),
  size: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

// Native ReadProtected owns archive-byte verification. This validates the signed
// receipt's policy/owner binding without interpreting history using live caps.
export function validateCollectionPolicy(
  manifest: any,
  agent: string,
  exam: string,
) {
  if (manifest.collection_policy === undefined) {
    if (manifest.attempt?.collection_policy != null)
      throw Error("Protected collection policy has no manifest binding");
    return; // Legacy protected receipts retain their original verification path.
  }
  const { job, policy } = collectionExecutionPolicy.parse(
    manifest.collection_policy,
  );
  if (
    policy.agent !== agent ||
    policy.exam !== exam ||
    job !== manifest.attempt?.collection_job ||
    manifest.attempt?.collection_policy != null
  )
    throw Error("Protected collection policy owner or job differs");
  if (
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.omissions) ||
    manifest.files.length + manifest.omissions.length > 10000
  )
    throw Error("Protected collection metadata exceeds its entry bound");
  let total = 0;
  for (const raw of manifest.files) {
    const file = protectedFile.parse(raw);
    total += file.size;
    if (
      file.size > policy.collection_file_mib * 1048576 ||
      total > policy.collection_total_mib * 1048576
    )
      throw Error("Protected collection exceeds its recorded policy bounds");
  }
}

export class ExamExecutionPolicies {
  constructor(
    private store: Store,
    private agent?: string,
  ) {}

  current(exam: string): ExamExecutionPolicy {
    const row = this.store.db
      .prepare(
        "SELECT e.config,m.instance,m.version FROM exams e JOIN exam_lifecycle m ON m.exam=e.id WHERE e.id=? AND m.deleted=0",
      )
      .get(exam) as
      | { config: string; instance: string; version: number }
      | undefined;
    if (!row)
      return unavailable(
        "Exam settings are unavailable. Ask the instructor to check this exam.",
        404,
      );
    if (!this.agent)
      return unavailable(
        "The class-server identity is not configured; preserve the current attempt and check the installation.",
      );
    return examExecutionPolicy.parse({
      schema: 1,
      agent: this.agent,
      exam,
      instance: row.instance,
      revision: row.version,
      ...executionValues.parse(JSON.parse(row.config)),
    });
  }

  status(exam: string): {
    executionPolicy: ExamExecutionPolicy | null;
    executionPolicyUnavailable?: true;
  } {
    try {
      return { executionPolicy: this.current(exam) };
    } catch {
      return { executionPolicy: null, executionPolicyUnavailable: true };
    }
  }

  requireSupported() {
    const row = this.store.db
      .prepare("SELECT payload FROM agent_snapshot WHERE agent=?")
      .get(this.agent ?? "") as { payload: string } | undefined;
    let supported = false;
    try {
      const health = row && JSON.parse(row.payload).health,
        support = executionPolicySupport.safeParse(
          health?.execution_policy_support,
        ),
        at = now();
      supported = !!(
        support.success &&
        support.data.supported &&
        fresh(support.data.observed, at) &&
        health?.native_roles?.complete === true &&
        fresh(health.native_roles.observed, at) &&
        health.capabilities?.includes(examExecutionPolicyCapability)
      );
    } catch {
      /* Missing/invalid signed configuration never proves a cohort. */
    }
    if (!supported)
      return unavailable(
        "Live exam settings need matching class-server agent, watchdog and saved-work worker versions. Check examctl health and repair the matched services during authorized maintenance. No settings changed.",
      );
  }

  guardLiveChange(exam: string, before: unknown, after: unknown) {
    if (
      isDeepStrictEqual(
        executionValues.parse(before),
        executionValues.parse(after),
      )
    )
      return;
    const live = this.store.db
      .prepare(
        `SELECT 1 FROM attempt_grants WHERE exam=? AND status IN ('AVAILABLE','PENDING_NATIVE')
       UNION ALL SELECT 1 FROM attempts WHERE exam=? AND state NOT IN ('COMPLETED','CANCELLED_BEFORE_START') LIMIT 1`,
      )
      .get(exam, exam);
    // Offline editing of an empty/history-only exam does not claim a live apply.
    // Existing permissions and unfinished collection/runtime need matched roles.
    if (live) this.requireSupported();
  }
}

// Root class-server observations reuse the existing callback key and gateway
// signature. This is a bounded read, never a grant, clock or workload permission.
export function registerExamExecutionPolicy(
  app: FastifyInstance,
  store: Store,
  agent: Agent,
) {
  const policies = new ExamExecutionPolicies(store, agent.id);
  app.post(
    "/api/agent/exam-execution-policy",
    { config: { rateLimit: false } },
    async (req) => {
      const payload = req.body;
      if (!Buffer.isBuffer(payload))
        return unavailable("Raw signed exam settings request required", 400);
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      const request = examExecutionPolicyRequest.parse(
        JSON.parse(payload.toString()),
      );
      if (request.agent !== agent.id)
        return unavailable("Exam settings agent scope rejected", 403);
      if (Math.abs(now() - request.at) > OPERATION_TIMEOUT_MS)
        return unavailable(
          "Exam settings request expired; request a fresh observation",
          409,
        );
      const reply = examExecutionPolicyReply.parse({
        type: "exam-execution-policy",
        audience: agent.id,
        nonce: request.nonce,
        expires: now() + OPERATION_TIMEOUT_MS,
        policy: policies.current(request.exam),
      });
      try {
        return agent.signTiming(reply);
      } catch {
        return unavailable(
          "Exam settings signer unavailable; preserve the attempt and retry after the gateway is repaired",
        );
      }
    },
  );
}
