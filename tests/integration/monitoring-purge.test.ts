import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { createApp } from "../../apps/server/src/app.js";
import { IsolatedConnection } from "../../apps/server/src/connection-process.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { hosts } from "../fixtures/hosts.js";

it("actual fatal/hung purge jobs leave authenticated HTTP and an existing real SSH PTY, signed renewals and new panes healthy", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const dir = mkdtempSync(tmpdir() + "/monitoring-purge-http-");
  const config = {
    mode: "development" as const,
    origin: "http://127.0.0.1",
    data: dir,
    port: 0,
    jump: h.jump,
    class: h.class,
    agent: h.agentConfig,
    maintenance: false,
  };
  let logs = "";
  const { app, store, life } = await createApp(config, {
    purgeWorkerEntry: new URL(
      "../fixtures/faulting-purge-worker.ts",
      import.meta.url,
    ),
    purgeTimeoutMs: 1500,
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    }),
  });
  const c = new IsolatedConnection("healthy", "e", config, life.agent);
  let timer: ReturnType<typeof setInterval> | undefined;
  const media = new Monitoring(store);
  const recordedPane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const protectedPath = `${dir}/submissions/protected`;
  writeFileSync(protectedPath, "immutable protected bytes");
  let pending: Promise<void> = Promise.resolve(),
    pulses = 0,
    pulseBusy = false;
  const failures: string[] = [];
  try {
    store.db.exec("INSERT INTO exams VALUES('e','{}')");
    const at = Date.now();
    store.db
      .prepare(
        `INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,generation,last_contact,page_hash)
      VALUES('healthy','e','healthy',10001,'ACTIVE','{}',?,?,?,7,?,'private-page')`,
      )
      .run(at, at + 60000, at + 60000, at);
    store.db
      .prepare(
        "UPDATE attempts SET access_state='HELD',access_held_at=? WHERE id='healthy'",
      )
      .run(at);
    const before = store.attempt("healthy");
    await c.connect(async (_host, _instruction, prompts) =>
      prompts.map(() => "shared-password"),
    );
    const pane = await c.open("healthy", "original");
    const data: string[] = [];
    pane.on("data", (chunk: Buffer) => data.push(chunk.toString()));
    pane.resume();
    const transport = c.transport;
    h.control.command = async (op, body) =>
      op === "renew-execution-lease"
        ? { id: "healthy", generation: 7, deadline: before.deadline }
        : h.agent.call(op, body);
    const session = store.session("admin", "teacher", null);
    const headers = {
      cookie: `session=${session.token}`,
      origin: config.origin,
      "x-csrf-token": session.csrf,
    };
    timer = setInterval(() => {
      if (pulseBusy) return;
      pulseBusy = true;
      pending = (async () => {
        const response = await app.inject({ url: "/api/session", headers });
        if (response.statusCode !== 200) throw Error("HTTP unavailable");
        const renewal = await c.command("renew-execution-lease", {
          id: "healthy",
          generation: 7,
        });
        if (renewal.deadline !== before.deadline)
          throw Error("lease scope changed");
        pane.write(`purge-independent-${++pulses}\n`);
      })()
        .catch((error) => {
          failures.push(error.message);
        })
        .finally(() => {
          pulseBusy = false;
        });
    }, 100);
    for (const id of [
      "panic",
      "kill",
      "heap",
      "hang",
      "overflow",
      "wrong",
      "extra",
      "forged",
      "exit-after-reply",
    ]) {
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES(?,'e',?,10002,'COMPLETED','{}',?)",
        )
        .run(id, id, Date.now());
      media.record(id, recordedPane, { note: "PRIVATE-MONITORING-BYTES" });
      const reply = await app.inject({
        method: "POST",
        url: `/api/admin/attempts/${id}/delete-monitoring`,
        headers,
        payload: { confirm: true },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toMatchObject({ ok: true, logicalDeleted: true });
      expect(
        (
          await app.inject({
            url: `/api/admin/attempts/${id}/recordings/${recordedPane}?offset=0`,
            headers,
          })
        ).statusCode,
      ).toBe(410);
      await vi.waitFor(
        () => {
          expect(
            store.db
              .prepare("SELECT status FROM monitoring_purges WHERE attempt=?")
              .get(id),
          ).toEqual({ status: "retry" });
        },
        { timeout: 3000, interval: 20 },
      );
      const shown = (
        await app.inject({
          url: `/api/admin/attempts/${id}/monitoring`,
          headers,
        })
      ).json();
      expect(shown.physicalPurge).toMatchObject({
        status: "retry",
        verified: null,
      });
      expect(JSON.stringify(shown)).not.toContain("PRIVATE-MONITORING");
      expect(
        readFileSync(`${dir}/monitoring/${id}/${recordedPane}.ndjson`, "utf8"),
      ).toContain("PRIVATE-MONITORING");
      expect(c.alive).toBe(true);
      expect(c.transport).toBe(transport);
      expect(c.panes.size).toBe(1);
      expect(store.attempt("healthy")).toEqual(before);
    }
    const extra = await c.open("healthy", "new-after-purge-faults");
    extra.resume();
    clearInterval(timer);
    await pending;
    await vi.waitFor(() =>
      expect(data.join("")).toContain(`Echo: purge-independent-${pulses}`),
    );
    expect(pulses).toBeGreaterThan(5);
    expect(failures).toEqual([]);
    expect(logs).toContain("monitoring-purge-incomplete");
    expect(logs).not.toMatch(/PRIVATE-PURGE|PRIVATE-MONITORING|record\.ndjson/);
    expect(readFileSync(protectedPath, "utf8")).toBe(
      "immutable protected bytes",
    );
  } finally {
    if (timer) clearInterval(timer);
    await pending;
    c.close();
    await app.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
