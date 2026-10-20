import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import WebSocket from "ws";
import { createApp } from "../../apps/server/src/app.js";
import { AgentCommandStateError } from "../../apps/server/src/agent.js";
import { hash } from "../../apps/server/src/db.js";
import { hosts } from "../fixtures/hosts.js";

it.each(["deadline", "pause", "finish", "failure"])(
  "heartbeat reconciles an in-flight renewal rejection: %s",
  async (kind) => {
    const h = await hosts({ mfaDelayMs: 10 });
    const data = mkdtempSync(tmpdir() + "/renewal-race-");
    const config: any = {
      mode: "development",
      origin: "http://127.0.0.1",
      data,
      port: 0,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
      maintenance: false,
    };
    let rejectRenewal: ((error: Error) => void) | undefined;
    h.control.command = async (op) => {
      if (op === "resolve-course-accounts") return { student: 1001 };
      if (op === "renew-execution-lease")
        return new Promise((_resolve, reject) => {
          rejectRenewal = reject;
        });
      return {};
    };
    const { app, store } = await createApp(config, {
      logStream: new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
    });
    const sockets: WebSocket[] = [];
    const open = (path: string, cookie: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(config.origin.replace("http:", "ws:") + path, {
          headers: { origin: config.origin, cookie },
        });
        sockets.push(ws);
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
      });
    try {
      config.origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const exam = {
        id: "e",
        name: "Synthetic",
        duration: 5400,
        earliest: 0,
        latest: Date.now() + 86400000,
        template: "sample",
        terminals: 4,
        webcam: false,
      };
      store.db
        .prepare("INSERT INTO exams VALUES('e',?)")
        .run(JSON.stringify(exam));
      store.db.exec(
        "INSERT INTO enrollments VALUES('e','student',0,NULL,NULL,1001)",
      );
      const begun = await app.inject({
        method: "POST",
        url: "/api/auth/start",
        headers: { origin: config.origin },
        payload: {},
      });
      const dialogueCookie = String(begun.headers["set-cookie"]).split(";")[0];
      const auth = await open("/api/auth/dialogue", dialogueCookie);
      await new Promise<void>((resolve, reject) => {
        auth.on("message", (raw) => {
          const m = JSON.parse(raw.toString());
          if (m.type === "challenge" && m.prompts.length)
            auth.send(
              JSON.stringify({
                v: 1,
                type: "answers",
                round: m.round,
                answers: m.prompts.map(() => "shared-password"),
              }),
            );
          if (m.type === "authenticated") resolve();
          if (m.type === "error") reject(Error(m.error));
        });
        auth.send(
          JSON.stringify({
            v: 1,
            type: "start",
            exam: "e",
            username: "student",
          }),
        );
      });
      const completed = await app.inject({
        method: "POST",
        url: "/api/auth/complete",
        headers: { origin: config.origin, cookie: dialogueCookie },
        payload: {},
      });
      expect(completed.statusCode).toBe(200);
      const cookie = String(completed.headers["set-cookie"])
        .split(",")
        .find((c) => c.trim().startsWith("session="))!
        .trim()
        .split(";")[0];
      const id = randomUUID(),
        page = "p".repeat(64),
        start = Date.now() - 60000,
        deadline = Date.now() + 60000;
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,last_contact,page_hash) VALUES(?,'e','student',1001,'ACTIVE',?,?,?,?,?,?)",
        )
        .run(
          id,
          JSON.stringify(exam),
          start,
          deadline,
          deadline,
          Date.now(),
          hash(page),
        );
      store.db
        .prepare(
          "INSERT INTO frames(id,attempt,source,seq,page_hash,captured,monotonic,received,width,height,hash) VALUES('frame',?,'screen',1,?,?,0,?,1,1,'hash')",
        )
        .run(id, hash(page), Date.now(), Date.now());
      store.db
        .prepare(
          "INSERT INTO attempt_interruptions(id,attempt,opened,generation,ended,outcome) VALUES('earlier',?,?,0,?,'resumed')",
        )
        .run(id, start, start + 1000);
      const ws = await open("/api/student/session", cookie);
      const request = (body: any, match: (message: any) => boolean) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.off("message", receive);
            reject(Error("Monitoring reply missing"));
          }, 5000);
          const receive = (raw: any) => {
            const m = JSON.parse(raw.toString());
            if (match(m)) {
              clearTimeout(timer);
              ws.off("message", receive);
              resolve(m);
            }
          };
          ws.on("message", receive);
          ws.send(JSON.stringify({ v: 1, ...body }));
        });
      const binding = randomUUID();
      await request(
        { type: "bind", attempt: id, page, binding },
        (m) => m.binding === binding,
      );
      const confirmation = randomUUID();
      const pending = request(
        {
          type: "heartbeat",
          confirmation,
          ready: {
            fullscreen: true,
            keyboard: true,
            screen: true,
            webcam: false,
            focus: true,
            visible: true,
          },
        },
        (m) => m.confirmation === confirmation,
      );
      await vi.waitFor(() => expect(rejectRenewal).toBeTypeOf("function"));
      if (kind === "deadline") {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(deadline + 200);
        rejectRenewal!(Error("cannot renew locked/ended workload"));
      } else if (kind === "failure")
        rejectRenewal!(Error("real renewal failure"));
      else
        rejectRenewal!(
          new AgentCommandStateError("cannot renew locked/ended workload", {
            id,
            exam: "e",
            username: "student",
            uid: 1001,
            state: kind === "pause" ? "LOCKED" : "COMPLETED",
            start,
            deadline,
            original_deadline: deadline,
            generation: 1,
            protected: kind === "finish",
            reason: `administrator: ${kind}`,
            access_state: "HELD",
          }),
        );
      const reply = await pending;
      expect(reply.attempt.state).toBe(
        kind === "deadline" || kind === "finish" ? "FINALIZING" : "LOCKED",
      );
      expect(store.attempt(id).deadline).toBe(deadline);
      const failures = store.db
        .prepare(
          "SELECT * FROM outbox WHERE body LIKE '%Class-agent lease renewal failed%'",
        )
        .all();
      expect(failures).toHaveLength(kind === "failure" ? 1 : 0);
      if (kind === "deadline") {
        expect(store.attempt(id).generation).toBe(0);
        expect(store.db.prepare("SELECT * FROM incidents").all()).toHaveLength(
          0,
        );
        expect(
          store.db.prepare("SELECT * FROM attempt_interruptions").all(),
        ).toHaveLength(1);
      }
      if (kind === "pause" || kind === "finish")
        expect(store.attempt(id).reason).toBe(`administrator: ${kind}`);
      expect(store.attempt(id).protected).toBe(0); // No success without a verified manifest.
    } finally {
      vi.useRealTimers();
      sockets.forEach((ws) => ws.terminate());
      await app.close();
      await h.close();
      rmSync(data, { recursive: true, force: true });
    }
  },
  20000,
);
