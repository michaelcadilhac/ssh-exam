// Browser fixtures only; this file is excluded from the production server build.
import { PREFLIGHT_TIMEOUT_MS } from "../../packages/protocol/preflight.js";
import { smtpFixture } from "../fixtures/smtp.js";
import type { IsolatedConnection } from "../../apps/server/src/connection-process.js";
import { createApp } from "../../apps/server/src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import { hosts } from "../fixtures/hosts.js";
import { randomUUID, sign } from "node:crypto";
import { verify } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import net from "node:net";
import { hash } from "../../apps/server/src/db.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";
import { browserGatewayProcess } from "../fixtures/browser-gateway-process.js";
const h = await hosts({
  classCertificates: process.env.EXAM_BROWSER_SSH === "1",
});
const timezoneAccounts = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [`timezone${i + 1}`, 11001 + i]),
);
// Independent identities prevent other specs' unfinished sandbox runs from
// turning cleanup tests' fresh sign-in into an unrelated recovery flow.
const cleanupAccounts = { cleanup01: 10013, cleanup02: 10014 };
// Fault-isolation intentionally leaves paused accounts held. Never reuse those
// identities in another spec's fresh sandbox preflight.
const isolationAccounts = { isolation01: 10015, isolation02: 10016 };
const closureAccounts = { closure01: 10017, closure02: 10018 };
const monitoringAccounts = { monitoring01: 10019 };
const receiptAccounts = { receipt01: 10029 };
const framedAccounts = { framed01: 10030 };
const retainedAccounts = {
  retained01: 10031,
  retained02: 10032,
  retained03: 10033,
};
const retainedLossAccounts = {
  retained04: 10034,
  retained05: 10035,
  retained06: 10036,
};
const retainedRestartAccounts = {
  retained07: 10037,
  retained08: 10038,
  retained09: 10039,
  retained10: 10040,
  retained11: 10041,
};
const retainedExams = new Set([
  "retained-control",
  "retained-loss",
  "retained-restart",
]);
const approvalAccounts = { approval01: 10020 };
// The sandbox repeat test deliberately leaves a reserved new preflight; expiry
// qualification must own another account instead of bypassing that reservation.
const preflightAccounts = { preflight01: 10027 };
const versionAccounts = {
  version01: 10021,
  grant01: 10022,
  legacy01: 10023,
  legacy02: 10024,
  extra01: 10025,
  extra02: 10028,
  practice01: 10026,
};
const browserMode = process.env.EXAM_BROWSER_SSH === "1";
const relay = browserMode
  ? new WebSocketServer({ port: 3101, host: "127.0.0.1" })
  : null;
if (relay) {
  relay.on("connection", (ws, req) => {
    if (req.headers.origin !== "http://localhost:3100") {
      ws.close(1008);
      return;
    }
    ws.once("message", (data) => {
      const f = JSON.parse(data.toString()),
        b = Buffer.from(f.payload, "base64"),
        t = JSON.parse(b.toString());
      if (
        t.audience !== "fixture-relay" ||
        t.expires <= Date.now() ||
        !verify(
          null,
          b,
          readFileSync(h.agentConfig.signingKey),
          Buffer.from(f.signature, "base64"),
        )
      ) {
        ws.close(1008);
        return;
      }
      const upstream = net.connect(h.jump.port, h.jump.host, () =>
        ws.send('{"ready":true}'),
      );
      ws.on("message", (bytes, binary) => {
        if (!binary) {
          ws.close(1008);
          return;
        }
        upstream.write(bytes as Buffer);
      });
      upstream.on("data", (bytes) => ws.send(bytes, { binary: true }));
      upstream.on("error", () => ws.close());
      ws.on("close", () => upstream.destroy());
      upstream.on("close", () => ws.close());
    });
  });
}
const attempts = new Map<string, any>();
const nativeBeginRequests: string[] = [];
const archive = Buffer.from("TEST-FIXTURE-ARCHIVE");
const retainedRegistrations: {
  exam: string;
  username: string;
  retained_monitoring: string;
}[] = [];
let retainedInspectionFault:
  | { username: string; mode: string; armedPID: number | undefined }
  | undefined;
const retainedInspections: {
  attempt: string;
  transport: string;
  mode: string;
  gatewayPID: number | undefined;
}[] = [];
const retainedContinuations = new Map<
  string,
  { generation: number; owner: any; input_epochs: Record<string, string> }
>();
const fixtureCall = async function (op: string, b: any = {}): Promise<any> {
  const monitored = op === "activate-monitored-grant-attempt";
  if (monitored) {
    if (!retainedExams.has(attempts.get(b.id)?.exam))
      throw Error(
        "Monitored fixture Begin requires its separate synthetic exam",
      );
    op = "activate-grant-attempt";
  }
  if (
    [
      "issue-owner-channel-admission",
      "issue-framed-owner-channel-admission",
      "renew-owner-execution-lease",
      "consume-owner-continuation",
    ].includes(op)
  ) {
    const owner = attempts.get(b.id)?.registered_owner;
    if (
      !owner ||
      !/^[a-f0-9]{64}$/.test(b.page_epoch ?? "") ||
      (op !== "consume-owner-continuation" && owner.page_epoch !== b.page_epoch)
    )
      throw Error("Registered fixture owner mismatch");
    if (
      op === "issue-owner-channel-admission" ||
      op === "issue-framed-owner-channel-admission"
    )
      return h.agent.call("issue-channel-admission", {
        ...b,
        registered_owner: owner,
        ...(op === "issue-framed-owner-channel-admission"
          ? { input_epoch: hash(randomUUID()) }
          : {}),
      });
    op =
      op === "renew-owner-execution-lease"
        ? "renew-execution-lease"
        : "consume-continuation";
  }
  if (op === "register") {
    if (!b.exam) throw Error("Exam-scoped registration required");
    for (const a of attempts.values())
      if (
        a.exam === "temporary-access" &&
        a.policy_state === "READY" &&
        !a.start
      ) {
        a.policy_transport = b.transport;
        a.transport = b.transport;
      }
    if (b.continuation) {
      const a = attempts.get(b.continuation.id);
      if (!a || a.state === "COMPLETED") throw Error("Attempt cannot resume");
      if (a.state === "ACTIVE") {
        a.state = "LOCKED";
        a.generation++;
      }
      if (a.generation !== b.continuation.generation)
        throw Error("Stale continuation");
      a.authorization = b.continuation.expires;
    }
    return {};
  }
  if (op === "issue-ssh-handoff") return h.issueHandoff(b.public_key);
  if (op.startsWith("issue-")) return h.agent.call(op, b);
  if (op === "close-pane") return { closed: true };
  if (op === "health")
    return {
      ready: true,
      fixture: true,
      capabilities: [
        "private-workspace-staging",
        "immutable-template-versions-v1",
        "exact-template-begin-v1",
        "unified-initial-grants-v1",
        "verified-preflight-cancellation-v1",
        "unified-sandbox-grants-v1",
        "sandbox-begin-window-v1",
        "ordered-template-grants-v1",
        "independent-workspace-grants-v1",
        "reviewed-initial-grants-v1",
      ],
    };
  if (op === "resolve-course-accounts") {
    const users: Record<string, number> = {
      ...timezoneAccounts,
      ...cleanupAccounts,
      ...isolationAccounts,
      ...closureAccounts,
      ...monitoringAccounts,
      ...receiptAccounts,
      ...framedAccounts,
      ...retainedAccounts,
      ...retainedLossAccounts,
      ...retainedRestartAccounts,
      ...approvalAccounts,
      ...preflightAccounts,
      ...versionAccounts,
      policytest01: 12001,
      student01: 10001,
      student02: 10002,
      student03: 10003,
      student04: 10004,
      student06: 10006,
      student07: 10007,
      student08: 10008,
      student09: 10009,
      student10: 10010,
      student11: 10011,
      student12: 10012,
    };
    if (b.usernames.some((u: string) => !users[u]))
      throw Error("Unknown fixture account");
    return Object.fromEntries(b.usernames.map((u: string) => [u, users[u]]));
  }
  if (op === "prepare-attempt" && b.exam === "temporary-access") {
    const existing = attempts.get(b.id);
    if (existing) {
      existing.transport = b.transport;
      return existing;
    }
    const a = {
      ...b,
      state: "PREPARING",
      generation: 0,
      start: 0,
      account_policy_required: true,
      policy_state: "",
      policy_transport: "",
    };
    attempts.set(b.id, a);
    return a;
  }
  if (
    op === "prepare-attempt" ||
    op === "prepare-grant-attempt" ||
    op === "prepare-additional-grant-attempt" ||
    op === "prepare-practice-grant-attempt"
  ) {
    if (
      b.grant &&
      b.grant.kind !==
        (op === "prepare-practice-grant-attempt"
          ? "PRACTICE"
          : op === "prepare-additional-grant-attempt"
            ? "ADDITIONAL"
            : undefined)
    )
      throw Error("Fixture grant authority type/purpose mismatch");
    const existing = attempts.get(b.id);
    if (existing) {
      if (existing.state === "PREPARING" && !existing.start) {
        if (
          existing.exam !== b.exam ||
          existing.username !== b.username ||
          existing.uid !== b.uid ||
          JSON.stringify(existing.grant) !== JSON.stringify(b.grant) ||
          JSON.stringify(existing.settings) !== JSON.stringify(b.settings)
        )
          throw Error("Fixture preparation retry differs from saved authority");
        existing.transport = b.transport;
        existing.browser_ssh = b.browser_ssh;
      }
      return existing;
    }
    const prepared = { ...b, state: "PREPARING", generation: 0 };
    attempts.set(b.id, prepared);
    return prepared;
  }
  const a = attempts.get(b.id);
  if (!a) throw Error("Unknown fixture attempt");
  switch (op) {
    case "prepare-workspace":
      if (a.state !== "PREPARING" || a.start)
        throw Error("Workspace requires unstarted preparation");
      a.workspace ??= {
        version: 1,
        attempt: a.id,
        ...(a.grant ? { grant: a.grant } : {}),
        source:
          a.grant?.work?.kind === "empty"
            ? { kind: "empty" }
            : {
                kind: "template",
                template: a.grant?.work?.name ?? a.settings.template,
                version: a.grant?.work?.hash ?? a.settings.template_version,
              },
      };
      break;
    case "prepare-account-policy":
      a.policy_state = "READY";
      a.policy_expires = Date.now() + 300000;
      break;
    case "submission-status":
      break;
    case "submission-manifest":
      return {
        attempt: { ...a },
        files: [],
        omissions: [],
        collected: a.collected_at,
        secured: a.secured_at,
        checksum: a.checksum,
      };
    case "cancel-attempt":
      if (a.start) throw Error("Cannot cancel started attempt");
      a.state = "CANCELLED_BEFORE_START";
      a.cancellation_cleanup_complete = true;
      a.policy_state = "NORMAL";
      break;
    case "activate-versioned-attempt":
    case "activate-grant-attempt":
    case "activate-additional-grant-attempt":
    case "activate-practice-grant-attempt":
    case "activate-attempt":
      nativeBeginRequests.push(b.id);
      let initialOwner: any;
      if (
        a.settings.template_version &&
        (![
          "activate-versioned-attempt",
          "activate-grant-attempt",
          "activate-additional-grant-attempt",
          "activate-practice-grant-attempt",
        ].includes(op) ||
          JSON.stringify(b.settings) !== JSON.stringify(a.settings))
      )
        throw Error(
          "Exact browser source requires the distinct purpose and complete saved settings",
        );
      if (a.start) break;
      if (a.grant) {
        if (
          (op !== "activate-grant-attempt" &&
            op !== "activate-additional-grant-attempt" &&
            op !== "activate-practice-grant-attempt") ||
          a.grant.kind !==
            (op === "activate-practice-grant-attempt"
              ? "PRACTICE"
              : op === "activate-additional-grant-attempt"
                ? "ADDITIONAL"
                : undefined) ||
          JSON.stringify(a.grant) !== JSON.stringify(b.grant)
        )
          throw Error("Grant-aware Begin and exact binding required");
        const nonce = hash(randomUUID()),
          boot = "77777777-1234-4234-8234-123456789abc";
        if (monitored)
          initialOwner = {
            attempt: a.id,
            exam: a.exam,
            username: a.username,
            uid: a.uid,
            transport_hash: a.transport,
            boot,
            page_epoch: b.page_epoch,
            input_epoch: hash(randomUUID()),
            generation: a.generation,
            clock_revision: a.clock_revision || 0,
          };
        const payload = Buffer.from(
          JSON.stringify({
            type: monitored ? "grant-begin/v3" : "grant-begin/v2",
            agent: "class",
            nonce,
            at: Date.now(),
            attempt: a.id,
            exam: a.exam,
            username: a.username,
            uid: a.uid,
            grant: a.grant,
            intent: b.grant_begin_intent,
            transport: a.transport,
            boot,
            settings: a.settings,
            ...(b.page_epoch ? { page_epoch: b.page_epoch } : {}),
            ...(initialOwner ? { initial_owner: initialOwner } : {}),
          }),
        );
        const response = await app.inject({
          method: "POST",
          url: "/api/agent/grant-begin",
          headers: {
            "content-type": "application/vnd.ssh-exam-event",
            "x-exam-signature": sign(null, payload, h.callbackKey).toString(
              "base64",
            ),
          },
          payload,
        });
        if (response.statusCode !== 200) {
          const web = store.attempt(a.id),
            intent = store.db
              .prepare("SELECT * FROM grant_begin_intents WHERE id=?")
              .get(b.grant_begin_intent) as any;
          throw Error(
            "Fresh browser-fixture native verification refused: " +
              response.statusCode +
              JSON.stringify({
                nativeUid: a.uid,
                webUid: web.uid,
                state: web.state,
                pageSent: b.page_epoch,
                pageCurrent: web.page_hash,
                pageIntent: intent?.owner_page,
                transportMatches: intent?.transport === a.transport,
                intent: intent?.state,
                response: response.body,
              }),
          );
        }
        const frame = response.json(),
          signed = Buffer.from(frame.payload, "base64"),
          reply = JSON.parse(signed.toString());
        if (
          !verify(
            null,
            signed,
            readFileSync(h.agentConfig.signingKey),
            Buffer.from(frame.signature, "base64"),
          ) ||
          reply.type !== (monitored ? "grant-begin/v3" : "grant-begin/v2") ||
          reply.nonce !== nonce ||
          reply.attempt !== a.id ||
          reply.intent !== b.grant_begin_intent ||
          reply.transport !== a.transport ||
          reply.boot !== boot ||
          reply.page_epoch !== b.page_epoch ||
          reply.expires <= Date.now() ||
          !Number.isSafeInteger(reply.capture_valid_for_ms) ||
          reply.capture_valid_for_ms <= 0 ||
          reply.capture_valid_for_ms > 15000 ||
          JSON.stringify(reply.grant) !== JSON.stringify(a.grant)
        )
          throw Error("Bad signed browser-fixture Begin response");
        if (
          monitored &&
          (reply.bootstrap?.type !== "monitoring-bootstrap/v1" ||
            reply.bootstrap.control_retention !== "v1" ||
            !isDeepStrictEqual(reply.bootstrap.owner, initialOwner) ||
            reply.bootstrap.sequence !== 1 ||
            !/^[a-f0-9]{64}$/.test(reply.bootstrap.coverage_epoch || ""))
        )
          throw Error("Bad signed browser-fixture monitoring bootstrap");
        a.grant_begin_intent = b.grant_begin_intent;
      }
      if (!a.workspace) throw Error("Private workspace not staged");
      if (
        a.account_policy_required &&
        (a.policy_state !== "READY" || a.policy_transport !== a.transport)
      )
        throw Error("Fresh protected SSH sign-in required");
      a.state = "ACTIVE";
      a.start = Date.now();
      a.deadline = a.start + a.settings.duration * 1000;
      a.original_deadline = a.deadline;
      a.clock_revision = 0;
      a.clock_resets = [];
      if (monitored) {
        a.monitoring_mode = "v1";
        a.terminal_supervised = true;
        a.boot = initialOwner.boot;
      }
      if (b.page_epoch && a.grant)
        a.registered_owner = initialOwner || {
          attempt: a.id,
          exam: a.exam,
          username: a.username,
          uid: a.uid,
          transport_hash: a.transport,
          boot: "77777777-1234-4234-8234-123456789abc",
          page_epoch: b.page_epoch,
          input_epoch: hash(randomUUID()),
          generation: a.generation,
          clock_revision: a.clock_revision,
        };
      a.work_path = "/work";
      h.attempts.set(a.id, a);
      break;
    case "reset-clock": {
      if (a.clock_resets?.some((r: any) => r.id === b.reset_id)) break;
      if (
        a.state !== "ACTIVE" ||
        a.deadline <= Date.now() ||
        (a.clock_revision || 0) !== b.clock_revision
      )
        throw Error("Clock reset rejected");
      const previous = a.deadline;
      a.original_deadline ||= previous;
      a.deadline = b.extend_seconds
        ? previous + b.extend_seconds * 1000
        : b.requested_at + b.remaining_seconds * 1000;
      a.clock_revision = (a.clock_revision || 0) + 1;
      if (a.registered_owner)
        a.registered_owner = {
          ...a.registered_owner,
          clock_revision: a.clock_revision,
        };
      a.clock_resets ||= [];
      a.clock_resets.push({
        id: b.reset_id,
        actor: b.actor,
        requested_at: b.requested_at,
        applied_at: Date.now(),
        previous_deadline: previous,
        deadline: a.deadline,
        remaining_seconds: b.remaining_seconds,
        ...(b.extend_seconds ? { extend_seconds: b.extend_seconds } : {}),
        revision: a.clock_revision,
      });
      break;
    }
    case "lock-attempt":
      if (a.state === "ACTIVE") {
        a.state = "LOCKED";
        a.generation++;
      }
      a.resumeTransport = undefined;
      break;
    case "finalize-attempt":
      a.state = "COMPLETED";
      a.ended ??= Date.now();
      a.reason ||= b.reason;
      a.completed_at ||= a.ended;
      a.collected_at ||= Date.now();
      a.secured_at ||= a.collected_at;
      a.protected = true;
      if (a.exam === "sandbox") a.access_state = "RELEASED";
      a.checksum = hash(archive);
      break;
    case "authorize-continuation":
      a.authorization = b.expires;
      break;
    case "attach-transport":
      if (a.transport === b.transport) throw Error("Fresh SSH required");
      a.transport = b.transport;
      a.resumeTransport = b.transport;
      break;
    case "consume-monitored-continuation": {
      if (
        !retainedExams.has(a.exam) ||
        a.monitoring_mode !== "v1" ||
        !a.registered_owner ||
        b.generation !== a.generation ||
        b.page_epoch !== a.registered_owner.page_epoch
      )
        throw Error("Retained native fixture owner/generation/page mismatch");
      const cached = retainedContinuations.get(a.id);
      if (
        cached &&
        a.state === "ACTIVE" &&
        cached.generation === b.generation &&
        isDeepStrictEqual(cached.owner, a.registered_owner)
      )
        return { attempt: a, input_epochs: cached.input_epochs };
      if (a.state !== "LOCKED" || a.deadline <= Date.now())
        throw Error("Retained native fixture is not eligible for continuation");
      const previous = a.registered_owner,
        owner = {
          ...previous,
          generation: a.generation,
          input_epoch: hash(randomUUID()),
        },
        nonce = hash(randomUUID());
      const payload = Buffer.from(
        JSON.stringify({
          type: "monitoring-continue/v1",
          agent: "class",
          nonce,
          previous_owner: previous,
          owner,
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/monitoring-continue",
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          "x-exam-signature": sign(null, payload, h.callbackKey).toString(
            "base64",
          ),
        },
        payload,
      });
      if (response.statusCode !== 200)
        throw Error(
          "Fresh browser-fixture continuation refused: " +
            response.statusCode +
            " " +
            response.body,
        );
      const frame = response.json(),
        signed = Buffer.from(frame.payload, "base64"),
        reply = JSON.parse(signed.toString());
      if (
        !verify(
          null,
          signed,
          readFileSync(h.agentConfig.signingKey),
          Buffer.from(frame.signature, "base64"),
        ) ||
        reply.type !== "monitoring-continue/v1" ||
        reply.nonce !== nonce ||
        !isDeepStrictEqual(reply.previous_owner, previous) ||
        !isDeepStrictEqual(reply.owner, owner) ||
        reply.expires <= Date.now() ||
        reply.expires > reply.authorization_expires ||
        reply.bootstrap?.type !== "monitoring-bootstrap/v1" ||
        reply.bootstrap.control_retention !== "v1" ||
        !isDeepStrictEqual(reply.bootstrap.owner, owner) ||
        reply.bootstrap.sequence !== 1 ||
        !/^[a-f0-9]{64}$/.test(reply.bootstrap.coverage_epoch || "") ||
        !Number.isSafeInteger(reply.capture_valid_for_ms) ||
        reply.capture_valid_for_ms <= 0 ||
        reply.capture_valid_for_ms > 15000
      )
        throw Error("Bad signed browser-fixture continuation proof");
      const panes = [...h.activePanes.values()].filter(
          (p) => p.attempt === a.id,
        ),
        input_epochs: Record<string, string> = {};
      if (!panes.length || panes.some((p) => !p.changeInputEpoch))
        throw Error("No retained synthetic native pane to continue");
      for (const pane of panes) input_epochs[pane.pane] = hash(randomUUID());
      for (const pane of panes) pane.changeInputEpoch!(input_epochs[pane.pane]);
      a.registered_owner = owner;
      a.state = "ACTIVE";
      a.retained_hold = undefined;
      a.monitoring_resume_nonce = nonce;
      retainedContinuations.set(a.id, {
        generation: a.generation,
        owner,
        input_epochs,
      });
      return { attempt: a, input_epochs };
    }
    case "consume-continuation":
      if (!a.authorization) throw Error("Not authorized");
      if (!a.resumeTransport) throw Error("Fresh SSH required");
      a.state = "ACTIVE";
      if (a.registered_owner)
        a.registered_owner = {
          ...a.registered_owner,
          transport_hash: a.transport,
          page_epoch: b.page_epoch,
          input_epoch: hash(randomUUID()),
          generation: a.generation,
          clock_revision: a.clock_revision,
        };
      a.authorization = 0;
      break;
  }
  return a;
};
const workers: IsolatedConnection[] = [];
const smtpPath = mkdtempSync(tmpdir() + "/exam-fixture-mail-") + "/smtp.sock";
const mail = await smtpFixture(smtpPath);
const gatewayConfig: Parameters<typeof createApp>[0] = {
  mode: "development",
  origin: "http://localhost:3100",
  data: mkdtempSync(tmpdir() + "/exam-browser-"),
  port: 3100,
  jump: h.jump,
  class: h.class,
  agent: h.agentConfig,
  ...(browserMode
    ? {
        browserSSH: {
          relay: "ws://localhost:3101",
          audience: "fixture-relay",
        },
      }
    : {}),
  smtp: {
    socket: smtpPath,
    from: "exam@example.edu",
    to: ["instructor@example.edu"],
  },
  maintenance: false,
  preflightIdleMs: 5000,
};
const connectionWorkerEntry = new URL(
  "../fixtures/faulting-connection-worker.ts",
  import.meta.url,
);
const gateway =
  process.env.EXAM_BROWSER_GATEWAY_PROCESS === "1"
    ? browserGatewayProcess(gatewayConfig, connectionWorkerEntry)
    : undefined;
await gateway?.initialized;
const { app, store } =
  gateway ??
  (await createApp(gatewayConfig, {
    connectionWorkerEntry,
    onConnection: (connection) => workers.push(connection),
  }));
h.control.command = fixtureCall;
store.db.prepare("INSERT INTO agent_snapshot VALUES(?,?,?)").run(
  "class",
  1,
  JSON.stringify({
    health: { ready: true, fixture: true },
    accounts: {
      ...timezoneAccounts,
      ...cleanupAccounts,
      ...isolationAccounts,
      ...closureAccounts,
      policytest01: 12001,
      ...approvalAccounts,
      ...preflightAccounts,
      ...versionAccounts,
      ...retainedRestartAccounts,
      student01: 10001,
      student02: 10002,
      student03: 10003,
      student04: 10004,
      student06: 10006,
      student07: 10007,
      student08: 10008,
      student09: 10009,
      student10: 10010,
      student11: 10011,
      student12: 10012,
    },
  }),
);
let sequence = 1;
const postStatus = async (a: any) => {
  const manifest = a.protected
    ? await fixtureCall("submission-manifest", { id: a.id })
    : undefined;
  const payload = Buffer.from(
    JSON.stringify({
      agent: "class",
      sequence: ++sequence,
      at: Date.now(),
      attempt: { ...a },
      manifest,
    }),
  );
  const headers = {
    "content-type": "application/vnd.ssh-exam-event",
    "x-exam-signature": sign(null, payload, h.callbackKey).toString("base64"),
  };
  return app.inject({
    method: "POST",
    url: "/api/agent/events",
    headers,
    payload,
  });
};
// Synthetic native OS observation only. The production producer polls its
// pinned SSH lifetime in the existing supervisor; no browser timeout is proof.
let holdSSHExitReports = false;
const pendingSSHExitReports = new Map<string, any>();
const sshExitReports: { transport: string; attempt: string; status: number }[] =
  [];
const deliverSSHExitReports = async () => {
  for (const [transport, a] of pendingSSHExitReports) {
    if (holdSSHExitReports) return;
    if (!h.sshTransports.get(transport)?.closed)
      throw Error("Positive SSH exit required");
    if (a.state === "ACTIVE") a.generation++;
    a.state = "LOCKED";
    a.reason =
      "Monitoring verification unavailable; technical safety hold, not a student violation";
    a.retained_hold = "held";
    a.monitoring_hold_kind = "technical";
    a.ssh_exited_owner = { ...a.registered_owner };
    const result = await postStatus(a);
    sshExitReports.push({
      transport,
      attempt: a.id,
      status: result.statusCode,
    });
    if (result.statusCode !== 200)
      throw Error("Signed native SSH-exit callback refused: " + result.body);
    pendingSSHExitReports.delete(transport);
  }
};
h.control.onSSHTransportClosed = (transport, username) => {
  const a = [...attempts.values()].find(
    (a) =>
      a.username === username &&
      a.monitoring_mode === "v1" &&
      a.registered_owner?.transport_hash === transport &&
      ["ACTIVE", "LOCKED"].includes(a.state),
  );
  if (!a) return;
  pendingSSHExitReports.set(transport, a);
  void deliverSSHExitReports().catch((error) =>
    h.control.failures.push(String(error)),
  );
};
const renewalReceipts = new Map<string, { until: number; attempt: any }>();
let recoveredRenewalReceipts = 0;
h.control.dropReply = (frame) =>
  frame.username === "receipt01" &&
  frame.op.includes("receipted-execution-lease");
h.control.command = async (op, b, frame) => {
  if (op === "register") {
    const result = await fixtureCall(op, b);
    if (retainedExams.has(b.exam)) {
      retainedRegistrations.push({
        exam: b.exam,
        username: frame?.username || "",
        retained_monitoring: "v1",
      });
      return { ...result, framed_pane_input: "v1", retained_monitoring: "v1" };
    }
    if (b.exam === "framed-input")
      return { ...result, framed_pane_input: "v1" };
    return b.exam === "monitoring-receipt"
      ? { ...result, execution_renewal_receipts: "v1" }
      : result;
  }
  if (
    op === "renew-receipted-execution-lease" ||
    op === "renew-owner-receipted-execution-lease"
  ) {
    const result = await fixtureCall(
      op === "renew-owner-receipted-execution-lease"
        ? "renew-owner-execution-lease"
        : "renew-execution-lease",
      b,
    );
    const attempt = structuredClone({ ...result, transport: frame.transport });
    renewalReceipts.set(frame.nonce, { until: Date.now() + 15000, attempt });
    return attempt;
  }
  if (op === "execution-renewal-receipt") {
    const original = renewalReceipts.get(b.renewal_nonce);
    const a = attempts.get(b.id);
    if (
      !original ||
      !a ||
      a.state !== "ACTIVE" ||
      a.deadline <= Date.now() ||
      original.until <= Date.now() ||
      original.attempt.id !== b.id ||
      original.attempt.transport !== frame.transport ||
      (a.registered_owner && a.registered_owner.page_epoch !== b.page_epoch)
    )
      throw Error("Exact current fixture renewal unavailable");
    recoveredRenewalReceipts++;
    return {
      version: 1,
      nonce: b.renewal_nonce,
      until: original.until,
      remaining_ms: original.until - Date.now(),
      attempt: original.attempt,
    };
  }
  const result = await fixtureCall(op, b);
  if (
    op === "inspect-attempt" &&
    result?.exam === "retained-restart" &&
    gateway
  ) {
    const fault = retainedInspectionFault;
    const mode =
      fault &&
      fault.username === result.username &&
      fault.armedPID !== gateway.pid
        ? fault.mode
        : "none";
    retainedInspections.push({
      attempt: b.id,
      transport: frame?.transport || "",
      mode,
      gatewayPID: gateway.pid,
    });
    if (retainedInspections.length > 96) retainedInspections.shift();
    if (mode !== "none") {
      const reply = structuredClone(result);
      if (mode === "page") reply.registered_owner.page_epoch = "e".repeat(64);
      else if (mode === "transport")
        reply.registered_owner.transport_hash = "f".repeat(64);
      else if (mode === "clock") reply.registered_owner.clock_revision++;
      return reply;
    }
  }
  if (op === "finalize-attempt") setTimeout(() => void postStatus(result), 50);
  return result;
};
const watchdog = setInterval(() => {
  for (const a of attempts.values())
    if (a.start && a.deadline <= Date.now() && a.state !== "COMPLETED")
      void fixtureCall("finalize-attempt", {
        id: a.id,
        reason: "expiration",
      }).then(postStatus);
}, 100);
app.addHook("onClose", async () => clearInterval(watchdog));
store.db
  .prepare("INSERT INTO admins VALUES(?,?,?)")
  .run("fixture", "instructor", await argon2.hash("fixture-password"));
const exam = {
  id: "sample",
  name: "Fixture browser exam",
  earliest: Date.now() - 10000,
  latest: Date.now() + 86400000,
  duration: 5400,
  webcam: false,
  terminals: 4,
  template: "sample-exam",
};
const definitions = new ExamDefinitions(store, "class");
const versionHash = "a".repeat(64);
new TemplateCatalog(store, "class").sync(
  {
    version: {
      schema: 1,
      name: exam.template,
      hash: versionHash,
      entries: 4,
      files: 2,
      bytes: 30,
      max_file_bytes: 20,
      created: 1000,
    },
    reason: "Review synthetic browser exact source",
  },
  {
    agent: "class",
    actor: "agent:class:root",
    request: randomUUID(),
    issued: 1000,
    observed: 1001,
  },
);
definitions.create(
  { ...exam, id: "versioned-source", template_version: versionHash },
  "fixture-operator",
);
definitions.create(
  { ...exam, id: "retirement-history", name: "Retirement protected history" },
  "fixture-operator",
);
const retirementHistoryStart = Date.now() - 10800000;
store.db
  .prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  .run(
    "cccccccc-1234-4234-8234-123456789abc",
    "retirement-history",
    "retirehistory",
    10028,
    "COMPLETED",
    JSON.stringify(definitions.show("retirement-history").exam),
    retirementHistoryStart,
    retirementHistoryStart + 5400000,
    retirementHistoryStart + 5400000,
    1,
    "RELEASED",
    "b".repeat(64),
  );
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("versioned-source", "version01", null, null, null, 10021);
definitions.create(
  {
    ...exam,
    id: "initial-grant",
    name: "Initial browser grant",
    template_version: versionHash,
  },
  "fixture-operator",
);
new RosterManagement(store, undefined, "class").add(
  "initial-grant",
  { username: "grant01" },
  "fixture-operator",
);
definitions.create(
  {
    ...exam,
    id: "framed-input",
    name: "Framed input browser grant",
    template_version: versionHash,
  },
  "fixture-operator",
);
new RosterManagement(store, undefined, "class").add(
  "framed-input",
  { username: "framed01" },
  "fixture-operator",
);
definitions.create(
  {
    ...exam,
    id: "retained-control",
    name: "Negotiated retained browser control",
    template_version: versionHash,
  },
  "fixture-operator",
);
for (const username of Object.keys(retainedAccounts))
  new RosterManagement(store, undefined, "class").add(
    "retained-control",
    { username },
    "fixture-operator",
  );
definitions.create(
  {
    ...exam,
    id: "retained-loss",
    name: "Retained transport loss",
    template_version: versionHash,
  },
  "fixture-operator",
);
for (const username of Object.keys(retainedLossAccounts))
  new RosterManagement(store, undefined, "class").add(
    "retained-loss",
    { username },
    "fixture-operator",
  );
definitions.create(
  {
    ...exam,
    id: "retained-restart",
    name: "Retained gateway process restart",
    template_version: versionHash,
  },
  "fixture-operator",
);
for (const username of Object.keys(retainedRestartAccounts))
  new RosterManagement(store, undefined, "class").add(
    "retained-restart",
    { username },
    "fixture-operator",
  );
definitions.create(
  {
    ...exam,
    id: "legacy-grant",
    name: "Reviewed browser grant",
    webcam: true,
    template_version: versionHash,
  },
  "fixture-operator",
);
store.db
  .prepare(
    "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES('legacy-grant','legacy01',0,NULL,0),('legacy-grant','legacy02',0,4500,1)",
  )
  .run();
definitions.update(
  "initial-grant",
  { duration: 3600, webcam: true },
  definitions.show("initial-grant").revision,
  "fixture-operator",
  "Change defaults after saved initial issuance",
);
const extraHistoryID = "aaaaaaaa-1234-4234-8234-123456789abc",
  extraHistoryStart = Date.now() - 10800000;
const extraDefinition = {
  ...exam,
  id: "additional-template",
  name: "Additional browser attempt",
  webcam: true,
  template_version: versionHash,
  earliest: extraHistoryStart - 60000,
  latest: extraHistoryStart + 60000,
};
definitions.create(extraDefinition, "fixture-operator");
store.db
  .prepare(
    "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('additional-template','extra01',0,0)",
  )
  .run();
store.db
  .prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state,export_status) VALUES(?,'additional-template','extra01',10025,'COMPLETED',?,?,?,?,1,?,'RELEASED','server-only')",
  )
  .run(
    extraHistoryID,
    JSON.stringify(extraDefinition),
    extraHistoryStart,
    extraHistoryStart + 5400000,
    extraHistoryStart + 5400000,
    "b".repeat(64),
  );
attempts.set(extraHistoryID, {
  id: extraHistoryID,
  exam: "additional-template",
  username: "extra01",
  uid: 10025,
  state: "COMPLETED",
  settings: extraDefinition,
  start: extraHistoryStart,
  deadline: extraHistoryStart + 5400000,
  original_deadline: extraHistoryStart + 5400000,
  clock_revision: 0,
  protected: true,
  checksum: "b".repeat(64),
  access_state: "RELEASED",
});
const secondExtraHistoryID = "bbbbbbbb-1234-4234-8234-123456789abc";
store.db
  .prepare(
    "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('additional-template','extra02',0,1)",
  )
  .run();
store.db
  .prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state,export_status) VALUES(?,'additional-template','extra02',10028,'COMPLETED',?,?,?,?,1,?,'RELEASED','server-only')",
  )
  .run(
    secondExtraHistoryID,
    JSON.stringify(extraDefinition),
    extraHistoryStart,
    extraHistoryStart + 5400000,
    extraHistoryStart + 5400000,
    "c".repeat(64),
  );
attempts.set(secondExtraHistoryID, {
  ...attempts.get(extraHistoryID)!,
  id: secondExtraHistoryID,
  username: "extra02",
  uid: 10028,
  checksum: "c".repeat(64),
});
definitions.update(
  "sandbox",
  {
    earliest: exam.earliest,
    latest: exam.latest,
    template_version: versionHash,
  },
  definitions.show("sandbox").revision,
  "fixture-operator",
  "Configure finite synthetic practice window",
);
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("sample", JSON.stringify(exam));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("sample", "student01", null, null, null, 10001);
for (const [id, webcam] of [
  ["windows", false],
  ["camera", true],
  ["logout", false],
  ["expiry", false],
  ["recovery", false],
] as const) {
  store.db
    .prepare("INSERT INTO exams VALUES(?,?)")
    .run(id, JSON.stringify({ ...exam, id, webcam }));
  store.db
    .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
    .run(
      id,
      id === "camera" || id === "expiry"
        ? "student02"
        : id === "logout" || id === "recovery"
          ? "student03"
          : "student01",
      null,
      null,
      null,
      id === "camera" || id === "expiry"
        ? 10002
        : id === "logout" || id === "recovery"
          ? 10003
          : 10001,
    );
}
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("reload", JSON.stringify({ ...exam, id: "reload" }));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("reload", "student11", null, null, null, 10011);
for (const [id, username, uid] of [
  ["closure", "closure01", 10017],
  ["reload-opening", "closure02", 10018],
  ["monitoring-liveness", "monitoring01", 10019],
  ["monitoring-receipt", "receipt01", 10029],
  ["approval-feedback", "approval01", 10020],
  ["isolation-a", "isolation01", 10015],
  ["isolation-b", "isolation02", 10016],
  ["preflight-limit", "preflight01", 10027],
] as const) {
  store.db
    .prepare("INSERT INTO exams VALUES(?,?)")
    .run(id, JSON.stringify({ ...exam, id }));
  store.db
    .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
    .run(id, username, null, null, null, uid);
}
// A separate locked account exercises continuation rejection without depending
// on the old active-exam Sign out button.
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("locked", JSON.stringify({ ...exam, id: "locked" }));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("locked", "student05", null, null, null, 10005);
store.db
  .prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,access_state) VALUES(?,?,?,?,?,?,?,?,?)",
  )
  .run(
    "55555555-5555-4555-8555-555555555555",
    "locked",
    "student05",
    10005,
    "LOCKED",
    JSON.stringify({ ...exam, id: "locked" }),
    Date.now(),
    Date.now() + 5400000,
    "HELD",
  );
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("temporary-access", JSON.stringify({ ...exam, id: "temporary-access" }));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("temporary-access", "policytest01", null, null, null, 12001);
// Disposable browser-test instrumentation only; never part of the production app.
app.get("/api/fixture/runtime", async () => ({
  retainedRegistrations,
  nativeBeginRequests,
  sshExitReports,
  pendingSSHExitReports: [...pendingSSHExitReports.keys()],
  framedInput: h.control.framed,
  renewalReceipts: {
    recovered: recoveredRenewalReceipts,
    activeCommands: h.control.active,
    maxActiveCommands: h.control.maxActive,
  },
  authenticationCalls: h.authCalls,
  sshTransports: [...h.sshTransports].map(([transport, state]) => ({
    transport,
    ...state,
  })),
  terminalOpens: h.counts.panes,
  pid: gateway?.pid ?? process.pid,
  fixturePID: process.pid,
  gatewayProcess: !!gateway,
  retainedInspections,
  retainedAttempts: store.db
    .prepare(
      "SELECT id,username,state,start,deadline,original_deadline,generation,clock_revision,grant_id,registered_owner FROM attempts WHERE exam='retained-restart'",
    )
    .all(),
  activationFailure: store.db
    .prepare(
      "SELECT detail FROM audit WHERE action='activation-failed' ORDER BY rowid DESC LIMIT 1",
    )
    .get(),
  commandFailures: h.control.failures,
  // Match the JSON HTTP schema; the private epoch callback is not IPC data.
  panes: [...h.activePanes.values()].map(({ attempt, pane }) => ({
    attempt,
    pane,
  })),
  workers: gateway
    ? await gateway.workers()
    : workers
        .filter((c) => c.alive)
        .map((c: any) => ({ username: c.username, pid: c.child.pid })),
  emails: mail.messages,
  outbox: store.db
    .prepare("SELECT subject,body,status,tries FROM outbox")
    .all(),
}));
// Fault injection is strictly fixture-only; production has no corresponding route.
app.post("/api/fixture/age-preflight", async (req) => {
  const { id } = req.body as { id: string };
  const a = store.attempt(id);
  if (a.state !== "PREPARING" || a.start)
    throw Error("Unstarted preflight required");
  store.db
    .prepare(
      "UPDATE attempts SET preflight_started_at=?,last_contact=? WHERE id=?",
    )
    .run(Date.now() - PREFLIGHT_TIMEOUT_MS - 1, Date.now(), id);
  return {};
});
app.post("/api/fixture/fault", async (req) => {
  const { username, fault } = req.body as any;
  if (gateway) return gateway.fault(username, fault);
  const worker = workers.findLast(
    (c) => c.username === username && c.alive,
  ) as any;
  if (!worker) throw Error("No live fixture worker");
  if (fault === "kill") worker.child.kill("SIGKILL");
  else worker.child.send({ kind: "fixture-fault", fault });
  return { pid: worker.child.pid };
});
if (gateway) {
  let restarting = false;
  app.post("/api/fixture/retained-inspection-fault", async (req) => {
    const { username, mode } = req.body as any;
    if (
      !(username in retainedRestartAccounts) ||
      !["none", "page", "transport", "clock"].includes(mode)
    )
      throw Error("Explicit synthetic retained inspection mode required");
    retainedInspectionFault =
      mode === "none" ? undefined : { username, mode, armedPID: gateway.pid };
    return { mode, armedPID: gateway.pid };
  });
  app.post("/api/fixture/gateway-restart", async () => {
    if (restarting) throw Error("Owned fixture restart already running");
    restarting = true;
    const previous = gateway.pid;
    setTimeout(() => {
      void gateway
        .restart()
        .catch((error) => {
          console.error("Owned fixture gateway restart failed", error);
          void shutdown().finally(() => process.exit(1));
        })
        .finally(() => {
          restarting = false;
        });
    }, 50);
    return { previous };
  });
}
app.post("/api/fixture/ssh-exit-reports", async (req) => {
  holdSSHExitReports = (req.body as any).held === true;
  await deliverSSHExitReports();
  return {
    held: holdSSHExitReports,
    pending: [...pendingSSHExitReports.keys()],
  };
});
app.post("/api/fixture/mail", async (req) => {
  mail.reject(!!(req.body as any).reject);
  store.db.prepare("UPDATE outbox SET next=0 WHERE status='pending'").run();
  return {};
});
await app.listen({ host: "127.0.0.1", port: 3100 });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  h.control.onSSHTransportClosed = undefined;
  for (const client of relay?.clients || []) client.terminate();
  await Promise.all([
    app.close(),
    new Promise<void>((resolve, reject) => {
      if (!relay) return resolve();
      relay.close((error) => (error ? reject(error) : resolve()));
    }),
  ]);
  await h.close();
  await mail.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
