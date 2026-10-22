import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  administratorCreate,
  administratorCreatedResult,
  administratorCredentials,
  administratorList,
  administratorUsername,
} from "../../../packages/protocol/administrator-management.js";
import { now, type Store } from "./db.js";

export class AdministratorManagementError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}
const failure = (message: string, statusCode: number): never => {
  throw new AdministratorManagementError(message, statusCode);
};
export const administratorAlreadyExists =
  "An administrator with that username already exists; inspect administrators before choosing another username. Creation never replaces credentials.";
export const administratorUnavailable =
  "Administrator operation unavailable or invalid; inspect current administrators and examctl web administrators help. No creation confirmed.";
const recordedCreationOutcome = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal(200),
      result: administratorCreatedResult,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.number().int().min(400).max(599),
      error: z.enum([administratorAlreadyExists, administratorUnavailable]),
    })
    .strict(),
]);
export function readAdministratorCreationOutcome(
  text: string,
  username: string,
) {
  try {
    const parsed = recordedCreationOutcome.parse(JSON.parse(text));
    if (parsed.ok && parsed.result.username !== username) throw Error();
    return parsed;
  } catch {
    return failure(
      "Administrator creation receipt result is invalid or changed; preserve it, inspect current administrators and retry only after operator diagnosis. No creation confirmed.",
      409,
    );
  }
}
// The identical slow verifier is used for authentication and this intent. There
// is NO fast password/body fingerprint. Enforce parameters before verification
// so damaged metadata cannot request unbounded Argon2 resources.
const verifier = z
  .string()
  .regex(
    /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
  );
const credentialIntent = z
  .object({
    purpose: z.literal("ssh-exam-administrator-intent/v1"),
    username: administratorUsername,
    verifier,
  })
  .strict();
export type PreparedAdministrator = {
  username: string;
  digest: string;
  fingerprint: string;
  priorFingerprint?: string;
};
const browserInput = administratorCredentials.extend({
  request: z.string().uuid().optional(),
});
const inputError =
  "Use a username of 1–64 letters, numbers, underscores or hyphens and a password of 12–1024 characters; an optional creation request must be a UUID.";
const conflict =
  "Administrator creation intent conflicts with different arguments or damaged receipt; inspect current administrators and use the original username/password for a retry, or a new intent for a different account.";

// One instance shared by browser and root-agent routes. Expensive work never
// holds SQLite and has two no-wait slots, not an unbounded promise/job queue.
export class AdministratorManagement {
  private working = 0;
  constructor(private store: Store) {}

  async prepare(
    input: unknown,
    priorFingerprint?: string,
  ): Promise<PreparedAdministrator> {
    const parsed = administratorCreate.safeParse(input);
    if (!parsed.success) return failure(inputError, 400);
    const credentials = parsed.data;
    const bytes = Buffer.from(credentials.password, "utf8");
    credentials.password = "";
    try {
      if (this.working >= 2)
        return failure(
          "Administrator credential work is busy; no intent was executed. Retry the same creation request and original password after other credential work finishes.",
          429,
        );
      let prior: z.infer<typeof credentialIntent> | undefined;
      if (priorFingerprint !== undefined) {
        if (priorFingerprint.length > 1024) return failure(conflict, 409);
        try {
          prior = credentialIntent.parse(JSON.parse(priorFingerprint));
        } catch {
          return failure(conflict, 409);
        }
        if (prior.username !== credentials.username)
          return failure(conflict, 409);
      }
      this.working++;
      try {
        let digest: string;
        try {
          if (prior) {
            if (!(await argon2.verify(prior.verifier, bytes)))
              return failure(conflict, 409);
            digest = prior.verifier;
          } else {
            digest = await argon2.hash(bytes, {
              type: argon2.argon2id,
              memoryCost: 65536,
              timeCost: 3,
              parallelism: 1,
              hashLength: 32,
              salt: randomBytes(16),
            });
          }
        } catch (error) {
          if (error instanceof AdministratorManagementError) throw error;
          return failure(
            "Administrator credential preparation unavailable; no creation confirmed. Retry the same request and original password after operator diagnosis.",
            503,
          );
        }
        if (!verifier.safeParse(digest).success)
          return failure(
            "Administrator credential verifier unavailable; no creation confirmed.",
            503,
          );
        return {
          username: credentials.username,
          digest,
          fingerprint:
            priorFingerprint ??
            JSON.stringify({
              purpose: "ssh-exam-administrator-intent/v1",
              username: credentials.username,
              verifier: digest,
            }),
          priorFingerprint,
        };
      } finally {
        this.working--;
      }
    } finally {
      bytes.fill(0);
    }
  }

  assertReceipt(prepared: PreparedAdministrator, current?: string) {
    if (current === undefined && prepared.priorFingerprint === undefined)
      return;
    if (
      current !== undefined &&
      prepared.priorFingerprint === current &&
      prepared.fingerprint === current
    )
      return;
    return failure(
      "Administrator creation receipt changed during credential preparation; inspect current administrators and retry the SAME intent with the original password. Do not assume creation or overwrite an account.",
      409,
    );
  }

  create(prepared: PreparedAdministrator, actor: string) {
    const inserted = this.store.db
      .prepare(
        "INSERT INTO admins(id,username,hash) VALUES(?,?,?) ON CONFLICT(username) DO NOTHING",
      )
      .run(randomUUID(), prepared.username, prepared.digest);
    if (!inserted.changes) return failure(administratorAlreadyExists, 409);
    this.store.audit(actor, "create-admin", prepared.username);
    return { username: prepared.username };
  }

  async browserCreate(input: unknown, actor: string, authorize: () => void) {
    const parsed = browserInput.safeParse(input);
    if (!parsed.success) return failure(inputError, 400);
    const b = parsed.data;
    try {
      const receipt = b.request
        ? (this.store.db
            .prepare(
              "SELECT fingerprint,result FROM administrator_creation_requests WHERE actor=? AND request=?",
            )
            .get(actor, b.request) as
            | { fingerprint: string; result: string }
            | undefined)
        : undefined;
      const prepared = await this.prepare(
        { username: b.username, password: b.password },
        receipt?.fingerprint,
      );
      b.password = "";
      return this.store.db.transaction(() => {
        authorize(); // A logout/revocation while hashing cannot still create.
        const current = b.request
          ? (this.store.db
              .prepare(
                "SELECT fingerprint,result FROM administrator_creation_requests WHERE actor=? AND request=?",
              )
              .get(actor, b.request) as
              | { fingerprint: string; result: string }
              | undefined)
          : undefined;
        this.assertReceipt(prepared, current?.fingerprint);
        if (current) {
          try {
            const result = administratorCreatedResult.parse(
              JSON.parse(current.result),
            );
            if (result.username !== prepared.username) throw Error();
            return result;
          } catch {
            return failure(
              "Administrator creation receipt result is invalid or changed; preserve it and inspect current administrators. No creation confirmed.",
              409,
            );
          }
        }
        const result = this.create(prepared, actor);
        if (b.request)
          this.store.db
            .prepare(
              "INSERT INTO administrator_creation_requests VALUES(?,?,?,?,?)",
            )
            .run(
              actor,
              b.request,
              prepared.fingerprint,
              JSON.stringify(result),
              now(),
            );
        return result;
      })();
    } finally {
      b.password = "";
    }
  }

  page(input: unknown) {
    const b = administratorList.parse(input);
    const rows = this.store.db
      .prepare(
        "SELECT username FROM admins WHERE username>? ORDER BY username LIMIT ?",
      )
      .all(b.after ?? "", b.limit + 1) as { username: string }[];
    const page = rows.slice(0, b.limit);
    return {
      administrators: page,
      next: rows.length > b.limit ? page.at(-1)!.username : null,
    };
  }
  show(username: string) {
    administratorUsername.parse(username);
    const row = this.store.db
      .prepare("SELECT username FROM admins WHERE username=?")
      .get(username) as { username: string } | undefined;
    if (!row)
      return failure(
        "Administrator not found; use examctl web administrators list. No credentials were changed.",
        404,
      );
    return { username: row.username, role: "admin" as const };
  }
}
