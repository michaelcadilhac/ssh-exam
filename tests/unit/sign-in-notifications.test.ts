import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import {
  SignInNotifications,
  SIGN_IN_NOTICE_GRACE_MS,
} from "../../apps/server/src/sign-in-notifications.js";
import { AlertManagement } from "../../apps/server/src/alert-management.js";

it("keeps one non-sliding notice across restart, resolves recovery, and ignores an older connection failure", () => {
  const dir = mkdtempSync(tmpdir() + "/sign-in-notice-");
  vi.useFakeTimers({ toFake: ["Date"] });
  let store = new Store(dir);
  try {
    let notices = new SignInNotifications(store, "class");
    const at = Date.now(),
      old = { id: "old", created: at };
    const id = notices.failed("synthetic", "exam", old)!;
    const mail = () =>
      store.db.prepare("SELECT * FROM outbox WHERE id=?").get(id) as any;
    expect(mail()).toMatchObject({
      status: "pending",
      next: at + SIGN_IN_NOTICE_GRACE_MS,
    });
    vi.setSystemTime(at + 1000);
    expect(
      notices.failed("synthetic", "exam", { id: "retry", created: Date.now() }),
    ).toBe(id);
    expect(mail().next).toBe(at + SIGN_IN_NOTICE_GRACE_MS);
    store.close();
    store = new Store(dir);
    notices = new SignInNotifications(store, "class");
    vi.setSystemTime(at + SIGN_IN_NOTICE_GRACE_MS + 1);
    expect(notices.prepareForDelivery(id)).toBe(true);
    store.db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(id);
    expect(
      notices.failed("synthetic", "exam", {
        id: "retry2",
        created: Date.now(),
      }),
    ).toBe(id);
    const manager = new AlertManagement(store, () => true);
    const shown = manager.show(id);
    expect(shown.remindable).toBe(true);
    const reminder = manager.remind(
      {
        id: shown.episode!.id,
        revision: shown.episode!.revision,
        reason: "Please follow up with this student",
      },
      "instructor",
    );
    expect(
      (
        store.db
          .prepare("SELECT body FROM outbox WHERE id=?")
          .get(reminder.outbox) as any
      ).body,
    ).toContain("Student: synthetic\nExam: exam");
    notices.recovered("synthetic", "exam", "retry2");
    expect(manager.show(id).remindable).toBe(false);
    expect(manager.show(reminder.outbox).status).toBe("cancelled");
    expect(notices.failed("synthetic", "exam", old)).toBeUndefined();
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 0,
    });
    // A later setup failure on the SAME authenticated connection remains observable.
    expect(
      notices.failed("synthetic", "exam", { id: "retry2", created: at + 1 }),
    ).not.toBe(id);
  } finally {
    vi.useRealTimers();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("suppresses a single abandoned timeout and separates accounts/exams and new incidents after idle expiry", () => {
  const dir = mkdtempSync(tmpdir() + "/sign-in-single-");
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = new Store(dir);
  try {
    const notices = new SignInNotifications(store, "class"),
      at = Date.now();
    const first = notices.failed("one", "exam", { id: "one", created: at })!;
    expect(notices.failed("two", "exam", { id: "two", created: at })).not.toBe(
      first,
    );
    expect(
      notices.failed("one", "other", { id: "other", created: at }),
    ).not.toBe(first);
    vi.setSystemTime(at + SIGN_IN_NOTICE_GRACE_MS + 1);
    expect(notices.prepareForDelivery(first)).toBe(false);
    expect(
      (
        store.db
          .prepare("SELECT status FROM outbox WHERE id=?")
          .get(first) as any
      ).status,
    ).toBe("cancelled");
    const renewed = notices.failed("one", "exam", {
      id: "new",
      created: Date.now(),
    })!;
    expect(renewed).not.toBe(first);
    vi.setSystemTime(Date.now() + 30 * 60000 + 1);
    expect(
      notices.failed("one", "exam", { id: "later", created: Date.now() }),
    ).not.toBe(renewed);
  } finally {
    vi.useRealTimers();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
