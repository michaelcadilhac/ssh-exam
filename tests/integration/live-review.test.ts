import { it, expect, vi } from "vitest";
import { createApp } from "../../apps/server/src/app.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
it("serves incremental recordings only to instructors and validates cursor and recording identity", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-live-review-");
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    const id = "11111111-1111-4111-8111-111111111111",
      pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    store.db.prepare("INSERT INTO exams VALUES('exam','{}')").run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,'exam','alice',1001,'ACTIVE','{}')",
      )
      .run(id);
    const m = new Monitoring(store);
    m.record(id, pane, { event: "open" });
    const admin = store.session("admin", "instructor", null),
      student = store.session("student", "alice", "exam");
    const headers = { cookie: `session=${admin.token}` };
    const url = `/api/admin/attempts/${id}/recordings/${pane}`;
    const summary = `/api/admin/attempts/${id}/monitoring`;
    for (const endpoint of [summary, summary + "/entries"]) {
      for (const cookie of [undefined, `session=${student.token}`])
        expect(
          (
            await app.inject({
              url: endpoint,
              headers: cookie ? { cookie } : {},
            })
          ).statusCode,
        ).toBe(401);
      const response = await app.inject({ url: endpoint, headers });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const metadata = (
      await app.inject({
        url: summary + "/entries?section=terminals&limit=1",
        headers,
      })
    ).json();
    expect(metadata.entries[0].pane).toBe(pane);
    expect(metadata.next).toBeNull();
    expect(JSON.stringify(metadata)).not.toContain("page_hash");
    for (const query of [
      "limit=201",
      "limit=-1",
      "after=1",
      "section=unknown",
      "limit=01",
      "extra=bad",
    ])
      expect(
        (await app.inject({ url: summary + "/entries?" + query, headers }))
          .statusCode,
      ).toBe(400);
    for (const cookie of [undefined, `session=${student.token}`])
      expect(
        (
          await app.inject({
            url: url + "?offset=0",
            headers: cookie ? { cookie } : {},
          })
        ).statusCode,
      ).toBe(401);
    const initial = await app.inject({ url: url + "?offset=0", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    const first = initial.json();
    expect(JSON.parse(first.text).event).toBe("open");
    m.record(id, pane, { event: "output", data: "aGVsbG8=" });
    const next = await app.inject({
      url: url + `?offset=${first.nextOffset}`,
      headers,
    });
    expect(next.statusCode).toBe(200);
    expect(JSON.parse(next.json().text).event).toBe("output");
    expect((await app.inject({ url, headers })).body).toBe(
      first.text + next.json().text,
    );
    for (const [offset, status] of [
      ["-1", 400],
      ["0.5", 400],
      ["abc", 400],
      ["01", 400],
      ["9007199254740992", 400],
      ["999999", 409],
      ["1", 409],
    ] as const)
      expect(
        (await app.inject({ url: url + "?offset=" + offset, headers }))
          .statusCode,
      ).toBe(status);
    expect(
      (
        await app.inject({
          url:
            url.replace(id, "22222222-2222-4222-8222-222222222222") +
            "?offset=0",
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const line =
      JSON.stringify({ event: "output", data: "a".repeat(10000) }) + "\n";
    writeFileSync(`${dir}/monitoring/${id}/${pane}.ndjson`, line.repeat(150));
    const legacy = await app.inject({ url, headers });
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json().error).toContain("?offset=0");
    const bounded = (
      await app.inject({ url: url + "?offset=0", headers })
    ).json();
    expect(Buffer.byteLength(bounded.text)).toBeLessThanOrEqual(1024 * 1024);
    expect(bounded.more).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/attempts/${id}/delete-monitoring`,
          headers: { ...headers, origin: "http://localhost:3000" },
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      store.db
        .prepare("SELECT count(*) n FROM recordings WHERE attempt=?")
        .get(id),
    ).toEqual({ n: 1 });
    store.db
      .prepare("UPDATE attempts SET state='COMPLETED',ended=? WHERE id=?")
      .run(Date.now(), id);
    m.delete(id, "instructor");
    expect(
      (await app.inject({ url: url + "?offset=0", headers })).statusCode,
    ).toBe(410);
    expect(
      (await app.inject({ url: summary + "/entries", headers })).statusCode,
    ).toBe(410);
    expect(
      (await app.inject({ url: summary, headers })).json().current
        .monitoringDeleted,
    ).toBeTypeOf("number");
    await vi.waitFor(
      async () => {
        expect(
          (await app.inject({ url: summary, headers })).json().physicalPurge
            .status,
        ).toBe("verified-absent");
      },
      { timeout: 5000, interval: 100 },
    );
    // A backup/failed migration may restore older metadata/bytes while keeping
    // the durable deletion ledger. No legacy review/media endpoint may bypass it.
    const image = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    store.db
      .prepare(
        "INSERT INTO frames VALUES(?,?,'screen',1,'PRIVATE-PAGE',1,1,1,40,30,'old-hash')",
      )
      .run(image, id);
    store.db
      .prepare("INSERT INTO recordings VALUES('orphan',?,?,1)")
      .run(id, pane);
    store.db
      .prepare(
        "INSERT INTO incidents(id,attempt,generation,opened,events,message) VALUES('orphan',?,1,1,'[\"PRIVATE-RESTORED-INCIDENT\"]','PRIVATE-RESTORED-MESSAGE')",
      )
      .run(id);
    mkdirSync(`${dir}/monitoring/${id}`, { mode: 0o700 });
    writeFileSync(
      `${dir}/monitoring/${id}/${image}.jpg`,
      "PRIVATE-RESTORED-IMAGE",
    );
    writeFileSync(
      `${dir}/monitoring/${id}/${image}.thumb.jpg`,
      "PRIVATE-RESTORED-THUMB",
    );
    const manifest = {
      protected: true,
      checksum: "immutable",
      files: ["saved.c"],
    };
    writeFileSync(
      `${dir}/receipts/${id}.manifest.json`,
      JSON.stringify(manifest),
    );
    const protectedFile = `${dir}/submissions/immutable`;
    writeFileSync(protectedFile, "protected bytes");
    for (const suffix of ["", "?thumbnail=1"])
      expect(
        (
          await app.inject({
            url: `/api/admin/media/${image}${suffix}`,
            headers,
          })
        ).statusCode,
      ).toBe(410);
    const retained = await app.inject({
      url: `/api/admin/attempts/${id}/recordings`,
      headers,
    });
    expect(retained.json()).toMatchObject({
      manifest,
      frames: [],
      incidents: [],
      terminals: [],
      monitoringDeleted: true,
    });
    expect(retained.body).not.toContain("PRIVATE-RESTORED");
    expect(readFileSync(protectedFile, "utf8")).toBe("protected bytes");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
