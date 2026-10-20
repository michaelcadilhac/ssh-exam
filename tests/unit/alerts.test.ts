import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Alerts } from "../../apps/server/src/alerts.js";

it("persists episodes across delivery, SMTP retry, failed delivery and restart; separates causes, generations, students and recurrence", () => {
  const dir = mkdtempSync(tmpdir() + "/alert-episodes-");
  let store = new Store(dir);
  try {
    let alerts = new Alerts(store);
    const key = {
      attempt: "first",
      event: "collection",
      generation: 2,
      cause: "freeze",
    };
    const id = alerts.enqueue("Same subject", "first failure", key);
    for (const status of ["pending", "sent", "failed"]) {
      store.db
        .prepare("UPDATE outbox SET status=?,tries=4,next=1 WHERE id=?")
        .run(status, id);
      expect(
        alerts.enqueue(
          "Same subject",
          "context changes do not create an episode",
          key,
        ),
      ).toBe(id);
    }
    store.close();
    store = new Store(dir);
    alerts = new Alerts(store);
    expect(alerts.enqueue("Same subject", "restarted", key)).toBe(id);
    const other = alerts.enqueue(
      "Same subject",
      "other student " + "x".repeat(15000),
      { ...key, attempt: "second" },
    );
    expect(other).not.toBe(id);
    expect(
      (store.db.prepare("SELECT body FROM outbox WHERE id=?").get(other) as any)
        .body,
    ).toHaveLength(15014);
    const changed = alerts.enqueue("Same subject", "new cause", {
      ...key,
      cause: "disk",
    });
    expect(changed).not.toBe(id);
    alerts.resolve("first", "collection");
    expect(
      store.db.prepare("SELECT status FROM outbox WHERE id=?").get(changed),
    ).toEqual({ status: "cancelled" });
    const recurrence = alerts.enqueue("Same subject", "new episode", {
      ...key,
      cause: "disk",
    });
    expect(recurrence).not.toBe(changed);
    const generation = alerts.enqueue("Same subject", "new interruption", {
      ...key,
      generation: 3,
    });
    expect(generation).not.toBe(recurrence);
    expect(
      store.db
        .prepare(
          "SELECT count(*) AS n FROM alert_episodes WHERE resolved IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
