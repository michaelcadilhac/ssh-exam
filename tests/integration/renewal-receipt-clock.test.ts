import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Connection } from "../../apps/server/src/ssh.js";
import { Agent } from "../../apps/server/src/agent.js";
import * as clock from "../../apps/server/src/monitoring-clock.js";
import { hosts } from "../fixtures/hosts.js";

async function connected() {
  const h = await hosts({ mfaDelayMs: 10 });
  h.control.command = async (op) => {
    if (op === "register") return { execution_renewal_receipts: "v1" };
    throw Error("Unexpected command");
  };
  const c = new Connection(
    "student",
    { jump: h.jump, class: h.class, agent: h.agentConfig } as any,
    new Agent(h.agentConfig),
  );
  try {
    await c.connect(
      async (_host, _instruction, prompts) =>
        prompts.map(() => "shared-password"),
      { exam: "e" },
    );
  } catch (error) {
    c.close();
    await h.close();
    throw error;
  }
  return {
    h,
    c,
    close: async () => {
      c.close();
      await h.close();
    },
  };
}

it("keeps the original legacy workflow when the optional checked recovery clock is unavailable", async () => {
  const f = await connected();
  const operations: string[] = [];
  f.h.control.command = async (op) => {
    operations.push(op);
    return { id: "synthetic", state: "ACTIVE" };
  };
  const failedClock = vi
    .spyOn(clock, "monitoringBootTimeMS")
    .mockImplementation(() => {
      throw new clock.MonitoringBootClockUnavailable();
    });
  try {
    expect(
      await f.c.command("renew-execution-lease", { id: randomUUID() }),
    ).toMatchObject({ state: "ACTIVE" });
    expect(operations).toEqual(["renew-execution-lease"]);
    expect(f.c.alive).toBe(true);
    expect(failedClock).toHaveBeenCalled();
  } finally {
    failedClock.mockRestore();
    await f.close();
  }
});

it("charges a synthetic gateway suspend gap instead of accepting a stale positive recovery observation", async () => {
  const f = await connected();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realClock = clock.monitoringBootTimeMS;
  let gap = 0,
    nonce = "",
    until = 0,
    attempt: any,
    probed = false;
  const observedClock = vi
    .spyOn(clock, "monitoringBootTimeMS")
    .mockImplementation(() => realClock() + gap);
  f.h.control.command = async (op, body, frame) => {
    if (op === "renew-receipted-execution-lease") {
      nonce = frame.nonce;
      until = Date.now() + 15000;
      attempt = {
        id: body.id,
        username: "student",
        transport: frame.transport,
        state: "ACTIVE",
      };
      await pending;
      return attempt;
    }
    if (op === "execution-renewal-receipt") {
      probed = true;
      gap = 20000; // Only this injected loader observation; never suspend/change a host.
      return { version: 1, nonce, until, remaining_ms: 15000, attempt };
    }
    throw Error("Unexpected command");
  };
  let settled = false;
  try {
    const result = f.c
      .command("renew-execution-lease", { id: randomUUID() })
      .then((value) => {
        settled = true;
        return value;
      });
    await vi.waitFor(() => expect(probed).toBe(true), { timeout: 4000 });
    await vi.waitFor(() =>
      expect(
        observedClock.mock.results.filter(
          (r) => r.type === "return" && r.value >= realClock() + 19000,
        ).length,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(() => expect(f.h.control.active).toBe(1));
    expect(settled).toBe(false);
    expect(f.c.alive).toBe(true);
    release();
    expect(await result).toMatchObject({ state: "ACTIVE" });
  } finally {
    release();
    observedClock.mockRestore();
    await f.close();
  }
}, 12000);
