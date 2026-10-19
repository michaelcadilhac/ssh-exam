import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { AgentCommandDisconnectedError } from "../../apps/server/src/agent.js";

it("logout logs the actual preflight command failure, signs out and sends an accurate contextual alert", async () => {
  const data = mkdtempSync(tmpdir() + "/preflight-cleanup-");
  let logs = "";
  const { app, store, life } = await createApp(
    {
      mode: "development",
      origin: "http://localhost:3000",
      data,
      port: 3000,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
      agent: {
        id: "class",
        signingKey: "/missing",
        callbackPublicKey: "/missing",
      },
      maintenance: false,
    },
    {
      logStream: new Writable({
        write(c, _e, cb) {
          logs += c.toString();
          cb();
        },
      }),
    },
  );
  try {
    const call = vi
      .spyOn(life.agent, "call")
      .mockRejectedValue(
        new AgentCommandDisconnectedError("SSH connection ended"),
      );
    store.db.prepare("INSERT INTO exams VALUES('test','{}')").run();
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,'test','alice',1001,'PREPARING','{}')",
      )
      .run(id);
    const student = store.session("student", "alice", "test");
    const result = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: {
        cookie: `session=${student.token}`,
        origin: "http://localhost:3000",
        "x-csrf-token": student.csrf,
      },
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toContain("session=;");
    expect(store.attempt(id).state).toBe("PREPARING");
    expect(call).toHaveBeenCalledWith("cancel-attempt", { id });
    const diagnostic = logs
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.msg === "Preflight cleanup failed");
    expect(diagnostic).toMatchObject({
      attempt: id,
      username: "alice",
      exam: "test",
      stage: "cancel-attempt",
      cause: "ssh-disconnected",
      reason: "SSH connection ended",
      outcome: "cleanup-pending",
    });
    const email = store.db
      .prepare(
        "SELECT subject,body FROM outbox WHERE subject LIKE 'Preflight cleanup pending:%'",
      )
      .get() as any;
    expect(email.subject).toBe("Preflight cleanup pending: alice (test)");
    expect(email.body).toContain("Reason: SSH connection ended");
    expect(email.body).not.toContain("class agent unavailable");
    expect(logs).not.toContain(student.token);
  } finally {
    await app.close();
    store.close();
    rmSync(data, { recursive: true, force: true });
  }
});
