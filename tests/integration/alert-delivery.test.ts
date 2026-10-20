import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { smtpFixture } from "../fixtures/smtp.js";

it("retries a contextual failure through real SMTP after restart without enqueuing another episode", async () => {
  const data = mkdtempSync(tmpdir() + "/alert-delivery-");
  const smtp = await smtpFixture(data + "/smtp.sock");
  smtp.reject(true);
  const config: any = {
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
    smtp: {
      socket: data + "/smtp.sock",
      from: "exam@example.edu",
      to: ["teacher@example.edu"],
    },
  };
  const options = {
    logStream: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };
  let fixture = await createApp(config, options);
  const waitFor = async (check: () => boolean) => {
    const end = Date.now() + 8000;
    while (!check() && Date.now() < end) await delay(30);
    expect(check()).toBe(true);
  };
  try {
    fixture.store.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state) VALUES('a','e','alice',1001,'COLLECTION_FAILED','{}',1,100,100,'HELD');",
    );
    const remote = {
      id: "a",
      exam: "e",
      username: "alice",
      uid: 1001,
      state: "COLLECTION_FAILED",
      start: 1,
      deadline: 100,
      original_deadline: 100,
      access_state: "HELD",
      errors: ["disk full"],
    };
    fixture.life.acceptRemote(remote);
    const first = fixture.store.db
      .prepare("SELECT id FROM outbox")
      .get() as any;
    await waitFor(
      () =>
        (
          fixture.store.db
            .prepare("SELECT tries FROM outbox WHERE id=?")
            .get(first.id) as any
        ).tries === 1,
    );
    expect(smtp.messages).toHaveLength(0);
    await fixture.app.close();
    fixture = await createApp(config, options);
    fixture.life.acceptRemote(remote);
    expect(
      fixture.store.db.prepare("SELECT count(*) AS n FROM outbox").get(),
    ).toEqual({ n: 1 });
    fixture.store.db
      .prepare("UPDATE outbox SET next=? WHERE id=?")
      .run(Date.now() - 1, first.id);
    smtp.reject(false);
    await waitFor(
      () =>
        (
          fixture.store.db
            .prepare("SELECT status FROM outbox WHERE id=?")
            .get(first.id) as any
        ).status === "sent",
    );
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toContain(
      `Message-ID: <${first.id}@ssh-exam.local>`,
    );
    expect(smtp.messages[0]).toContain("Student: alice");
    fixture.life.acceptRemote(remote);
    expect(
      fixture.store.db.prepare("SELECT count(*) AS n FROM outbox").get(),
    ).toEqual({ n: 1 });
  } finally {
    await fixture.app.close();
    await smtp.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 25000);
