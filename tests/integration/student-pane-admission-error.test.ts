import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { liveMonitoring } from "../fixtures/live-monitoring.js";

it("shows a safe retry message for a native pane-policy refusal without pausing work or changing its clock", async () => {
  // Real student HTTP authentication, SSH command transport and page-owned WS;
  // the native policy decision is authored by the isolated synthetic SSH host.
  const f = await liveMonitoring();
  const command = f.h.control.command!;
  const nativeError =
    "fresh exam-wide execution policy unavailable or changed; retry this NEW pane/collection operation after checking the web connection and matching native roles; existing work, deadlines and holds remain unchanged";
  try {
    const existing = randomUUID();
    f.send({ type: "open", pane: existing });
    await vi.waitFor(
      () =>
        expect(
          f.messages.some((m) => m.type === "opened" && m.pane === existing),
        ).toBe(true),
      { timeout: 3000 },
    );
    const before = f.store.attempt(f.id);
    let refused = 0;
    f.h.control.command = async (op, body) => {
      if (op === "issue-channel-admission") {
        refused++;
        throw Error(nativeError);
      }
      return command(op, body);
    };
    // The operator/command boundary retains its actionable diagnostic. Only
    // the student pane-opening response is translated to plain instructions.
    await expect(
      f.connection.command("issue-channel-admission", {
        id: f.id,
        pane: randomUUID(),
        purpose: "exam",
      }),
    ).rejects.toThrow(nativeError);
    const next = randomUUID();
    f.send({ type: "open", pane: next });
    await vi.waitFor(
      () =>
        expect(
          f.messages.some((m) => m.type === "error" && m.pane === next),
        ).toBe(true),
      { timeout: 3000 },
    );
    const reply = f.messages.find((m) => m.type === "error" && m.pane === next);
    expect(reply).toMatchObject({
      type: "error",
      pane: next,
      error:
        "This terminal could not open. Try again. If it still fails, contact your instructor.",
    });
    expect(reply.code).toBeUndefined();
    expect(JSON.stringify(reply)).not.toMatch(
      /execution policy|native roles|NEW pane|holds|collection operation/,
    );
    expect(refused).toBe(2);
    expect(f.connection.alive).toBe(true);
    expect(f.connection.panes.has(existing)).toBe(true);
    expect(f.connection.panes.has(next)).toBe(false);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: before.state,
      start: before.start,
      deadline: before.deadline,
      original_deadline: before.original_deadline,
      generation: before.generation,
      settings: before.settings,
      page_hash: before.page_hash,
      access_state: before.access_state,
    });
    expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
    expect(
      f.messages.some((m) => m.type === "closed" && m.pane === existing),
    ).toBe(false);
    f.h.control.command = command;
    f.send({ type: "open", pane: next });
    await vi.waitFor(
      () =>
        expect(
          f.messages.some((m) => m.type === "opened" && m.pane === next),
        ).toBe(true),
      { timeout: 3000 },
    );
    expect(f.connection.panes.has(existing)).toBe(true);
    expect(f.connection.panes.has(next)).toBe(true);
  } finally {
    f.h.control.command = command;
    await f.close();
  }
}, 15000);
