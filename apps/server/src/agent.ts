import { readFileSync, constants } from "node:fs";
import { open } from "node:fs/promises";
import { createPrivateKey, randomUUID, sign, verify } from "node:crypto";
import type { Config } from "../../../packages/config/index.js";
import type { Attempt, Store } from "./db.js";
import { monitoringOwner } from "../../../packages/protocol/monitoring-evidence.js";
import { isDeepStrictEqual } from "node:util";
export type RenewalCommandContext = Pick<
  Attempt,
  | "id"
  | "exam"
  | "username"
  | "uid"
  | "start"
  | "deadline"
  | "original_deadline"
  | "generation"
  | "clock_revision"
>;
// Losing the student command transport is not evidence of a class-agent outage.
export class AgentCommandDisconnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCommandDisconnectedError";
  }
}
// Construct only from an authenticated SSH reply (or verified native signature),
// never from the browser's untrusted error string.
export class AgentCommandStateError extends Error {
  constructor(
    message: string,
    public readonly attemptState: any,
  ) {
    super(message);
    this.name = "AgentCommandStateError";
  }
}
export interface AgentSession {
  username: string;
  alive: boolean;
  command(op: string, body?: any): Promise<any>;
}
// Commands have no network route of their own: only an authenticated student SSH session.
export class Agent {
  private sessions = new Map<string, AgentSession>();
  constructor(
    private config: Config["agent"],
    private store?: Store,
  ) {}
  get id() {
    return this.config.id;
  }
  bind(session: AgentSession) {
    this.sessions.set(session.username, session);
  }
  unbind(session: AgentSession) {
    if (this.sessions.get(session.username) === session)
      this.sessions.delete(session.username);
  }
  connected(username: string) {
    return !!this.sessions.get(username)?.alive;
  }
  private findAttempt(id: string) {
    return this.store?.db
      .prepare("SELECT * FROM attempts WHERE id=?")
      .get(id) as Attempt | undefined;
  }
  // Connection workers delegate these database-dependent decisions to their
  // owning HTTP process. Standalone connections use the same local methods.
  async authorize(
    op: string,
    username: string,
    transport: string,
    body: object,
  ) {
    const id = (body as any).id;
    const attempt = typeof id === "string" ? this.findAttempt(id) : undefined;
    if (attempt && attempt.username !== username)
      throw Error("Command attempt belongs to another authenticated account");
    const frame: ReturnType<Agent["sign"]> & {
      recovery_context?: RenewalCommandContext;
    } = this.sign(op, username, transport, body);
    if (
      attempt &&
      ["renew-receipted-execution-lease", "execution-renewal-receipt"].includes(
        op,
      )
    ) {
      frame.recovery_context = {
        id: attempt.id,
        exam: attempt.exam,
        username: attempt.username,
        uid: attempt.uid,
        start: attempt.start,
        deadline: attempt.deadline,
        original_deadline: attempt.original_deadline,
        generation: attempt.generation,
        clock_revision: attempt.clock_revision,
      };
    }
    return frame;
  }
  async confirmRegisteredPaneOwner(
    attempt: string,
    input: unknown,
    username?: string,
  ) {
    if (
      username &&
      this.store &&
      this.findAttempt(attempt)?.username !== username
    )
      throw Error("Pane attempt belongs to another authenticated account");
    this.verifyRegisteredPaneOwner(attempt, input);
  }
  async acceptRegisteredOwnerObservation(remote: any) {
    this.observeExistingRegisteredOwner(remote);
  }
  sign(op: string, username: string, transport: string, body: object) {
    if (this.store && typeof (body as any).id === "string") {
      const attempt = this.findAttempt((body as any).id);
      if (attempt) {
        if (op === "issue-channel-admission" && attempt.registered_owner)
          op = "issue-owner-channel-admission";
        if (op === "renew-execution-lease" && attempt.registered_owner)
          op = "renew-owner-execution-lease";
        if (
          op === "renew-receipted-execution-lease" &&
          attempt.registered_owner
        )
          op = "renew-owner-receipted-execution-lease";
        if (op === "consume-continuation" && attempt.registered_owner)
          op = "consume-owner-continuation";
        const value = { ...body } as Record<string, unknown>;
        delete value.page_epoch;
        if (typeof value.grant_begin_intent === "string") {
          const original = this.store.db
            .prepare(
              "SELECT owner_page FROM grant_begin_intents WHERE id=? AND attempt=?",
            )
            .get(value.grant_begin_intent, attempt.id) as
            | { owner_page: string | null }
            | undefined;
          // Preserve an original legacy/uncertain Begin. Never silently upgrade
          // it to new page authority after a lost reply or gateway migration.
          if (original?.owner_page) value.page_epoch = original.owner_page;
        } else if (attempt.page_hash) value.page_epoch = attempt.page_hash;
        body = value;
      }
    }
    const payload = Buffer.from(
      JSON.stringify({
        audience: this.config.id,
        nonce: randomUUID(),
        expires: Date.now() + 30000,
        op,
        username,
        transport,
        body,
      }),
    );
    return {
      payload: payload.toString("base64"),
      signature: sign(
        null,
        payload,
        readFileSync(this.config.signingKey),
      ).toString("base64"),
    };
  }
  verifyRegisteredPaneOwner(attempt: string, input: unknown) {
    if (!this.store && input === undefined) return; // Legacy standalone signer.
    const a = this.findAttempt(attempt);
    if (!a)
      throw Error(
        "Pane owner context unavailable; inspect the original attempt before retrying",
      );
    if (!a.registered_owner) {
      if (input !== undefined)
        throw Error(
          "Unexpected registered pane owner; inspect matching gateway/native versions and original status",
        );
      return;
    }
    const expected = monitoringOwner.parse(JSON.parse(a.registered_owner));
    const actual = monitoringOwner.parse(input);
    if (
      !isDeepStrictEqual(expected, actual) ||
      actual.page_epoch !== a.page_hash ||
      actual.attempt !== a.id ||
      actual.exam !== a.exam ||
      actual.uid !== a.uid ||
      actual.username !== a.username
    )
      throw Error(
        "Registered pane owner changed or is unverified; inspect the original attempt and restore the authorized page before retrying",
      );
  }
  observeExistingRegisteredOwner(remote: any) {
    if (!remote?.registered_owner || typeof remote.id !== "string") return;
    const a = this.findAttempt(remote.id);
    if (!a?.registered_owner) return; // Initial identity requires accepted Begin.
    const next = monitoringOwner.parse(remote.registered_owner),
      previous = monitoringOwner.parse(JSON.parse(a.registered_owner));
    if (
      next.attempt !== a.id ||
      next.exam !== a.exam ||
      next.username !== a.username ||
      next.uid !== a.uid
    )
      throw Error(
        "Authenticated native owner metadata scope mismatch; preserve original status",
      );
    if (
      next.generation < previous.generation ||
      next.clock_revision < previous.clock_revision ||
      (next.generation === previous.generation &&
        next.clock_revision === previous.clock_revision &&
        !isDeepStrictEqual(next, previous))
    )
      return;
    this.store!.db.prepare(
      "UPDATE attempts SET registered_owner=? WHERE id=?",
    ).run(JSON.stringify(next), a.id);
  }
  signTiming(body: object) {
    const payload = Buffer.from(JSON.stringify(body));
    return {
      payload: payload.toString("base64"),
      signature: sign(
        null,
        payload,
        readFileSync(this.config.signingKey),
      ).toString("base64"),
    };
  }
  // One bounded asynchronous signing-key snapshot per long read operation.
  // Never perform a fresh synchronous key-file read for every export chunk.
  // The configured key path retains its existing link/readability semantics.
  async exportSigner() {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let bytes: Buffer | undefined;
    try {
      file = await open(
        this.config.signingKey,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      const before = await file.stat();
      if (!before.isFile() || before.size < 1 || before.size > 16384)
        throw Error();
      bytes = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const read = await file.read(bytes, count, bytes.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await file.stat();
      if (
        count !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw Error();
      const key = createPrivateKey(bytes.subarray(0, count));
      if (key.asymmetricKeyType !== "ed25519") throw Error();
      return (body: object) => {
        const payload = Buffer.from(JSON.stringify(body));
        return {
          payload: payload.toString("base64"),
          signature: sign(null, payload, key).toString("base64"),
        };
      };
    } catch {
      throw Object.assign(
        Error(
          "Monitoring export signer unavailable; inspect the configured gateway signing key and storage, preserve private partial output and retry with a new destination",
        ),
        { statusCode: 503 },
      );
    } finally {
      bytes?.fill(0);
      if (file) {
        try {
          await file.close();
        } catch {
          throw Object.assign(
            Error(
              "Monitoring export signer cleanup unconfirmed; inspect private gateway storage diagnostics before another export",
            ),
            { statusCode: 503, exportCode: "cleanup" },
          );
        }
      }
    }
  }
  verifyCallback(payload: Buffer, signature: string) {
    if (
      !signature ||
      signature.length > 128 ||
      !verify(
        null,
        payload,
        readFileSync(this.config.callbackPublicKey),
        Buffer.from(signature, "base64"),
      )
    )
      throw Object.assign(Error("Agent signature rejected"), {
        statusCode: 403,
      });
  }
  async call<T = any>(op: string, body: any = {}): Promise<T> {
    const attempt =
      body.id &&
      (this.store?.db
        .prepare("SELECT username FROM attempts WHERE id=?")
        .get(body.id) as any);
    const username = body.username || attempt?.username;
    const session = username ? this.sessions.get(username) : undefined;
    if (session?.alive) return session.command(op, body);
    if (op === "health" || op === "resolve-course-accounts") {
      const row = this.store?.db
        .prepare("SELECT payload FROM agent_snapshot WHERE agent=?")
        .get(this.config.id) as any;
      if (!row) throw Error("Class agent has not reported its configuration");
      const snapshot = JSON.parse(row.payload);
      if (op === "health") return snapshot.health;
      const result: Record<string, number> = {};
      for (const name of body.usernames || []) {
        if (
          snapshot.health?.administrator_sandbox_accounts?.includes(name) &&
          body.exam !== "sandbox"
        )
          throw Error(
            "Administrator account is approved only for sandbox: " + name,
          );
        if (!Number.isSafeInteger(snapshot.accounts?.[name]))
          throw Error("Account not approved by class server: " + name);
        result[name] = snapshot.accounts[name];
      }
      return result as T;
    }
    throw new AgentCommandDisconnectedError(
      "Reconnect student SSH before this operation; deadlines are enforced locally",
    );
  }
  close() {
    this.sessions.clear();
  }
  // Already authenticated callback configuration, not a fresh native probe.
  // Kept synchronous so management never awaits SSH/network inside SQLite.
  configurationHealth() {
    const row = this.store?.db
      .prepare("SELECT payload FROM agent_snapshot WHERE agent=?")
      .get(this.config.id) as { payload: string } | undefined;
    if (!row) throw Error("Class agent has not reported its configuration");
    return JSON.parse(row.payload).health;
  }
}
