import { readFileSync } from "node:fs";
import { randomUUID, sign, verify } from "node:crypto";
import type { Config } from "../../../packages/config/index.js";
import type { Store } from "./db.js";
// Losing the student command transport is not evidence of a class-agent outage.
export class AgentCommandDisconnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCommandDisconnectedError";
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
  sign(op: string, username: string, transport: string, body: object) {
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
}
