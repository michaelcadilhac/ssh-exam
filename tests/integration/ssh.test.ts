import { describe, it, expect, vi } from "vitest";
import { Connection } from "../../apps/server/src/ssh.js";
import { LoginPassword } from "../../apps/server/src/login-password.js";
import { hosts } from "../fixtures/hosts.js";
const zero = (buffer: Buffer) =>
  expect([...buffer].every((b) => b === 0)).toBe(true);
const scope = (c: Connection) => (c as any).authentication;
function cleared(c: Connection) {
  expect(scope(c)).toBeUndefined();
  for (const client of [c.jump, c.class]) {
    expect((client as any).config.password).toBeUndefined();
    expect((client as any).config.authHandler).toBeUndefined();
    expect(client.listenerCount("keyboard-interactive")).toBe(0);
    expect(client.listenerCount("banner")).toBe(0);
    expect(client.listenerCount("change password")).toBe(0);
  }
}
describe("attempt-scoped shared SSH password", () => {
  it("asks once, preserves phone number and empty rounds, clears before registration, and retains four channels", async () => {
    const h = await hosts({ jumpPasswordPrompt: "Entra Id Password: " });
    let original: Buffer | undefined;
    let c: Connection;
    c = new Connection(
      "student",
      { jump: h.jump, class: h.class } as any,
      {
        ...h.agent,
        sign: (...args: Parameters<typeof h.agent.sign>) => {
          cleared(c);
          zero(original!);
          return h.agent.sign(...args);
        },
      } as any,
    );
    const rounds: any[] = [];
    try {
      await c.connect(async (host, instruction, prompts) => {
        rounds.push({ host, instruction, prompts });
        if (scope(c).password.available) original ??= scope(c).password.value;
        return prompts.map(() => "shared-password");
      });
      for (let i = 0; i < 4; i++) await c.open("attempt", crypto.randomUUID());
      expect(h.counts).toEqual({ jump: 1, class: 1, panes: 4 });
      expect(h.authCalls).toEqual({ jump: 1, class: 1 });
      expect(rounds.filter((r) => r.prompts.length)).toHaveLength(1);
      expect(
        rounds.some(
          (r) => r.prompts.length === 0 && r.instruction.includes("42"),
        ),
      ).toBe(true);
      expect(rounds.some((r) => r.instruction.includes("<script>"))).toBe(true);
      cleared(c);
    } finally {
      c.close();
      await h.close();
    }
  });
  it("reuses only the password in a mixed class password/hidden MFA challenge", async () => {
    const h = await hosts({ classKeyboard: true, mfaDelayMs: 10 });
    const c = new Connection(
      "student",
      { jump: h.jump, class: h.class } as any,
      h.agent as any,
    );
    const promptsSeen: string[] = [];
    try {
      await c.connect(async (_host, _instructions, prompts) =>
        prompts.map((p) => {
          promptsSeen.push(p.prompt);
          return p.prompt === "Password" ? "shared-password" : "123456";
        }),
      );
      expect(promptsSeen).toEqual(["Password", "Verification code"]);
      expect(h.authCalls).toEqual({ jump: 1, class: 1 });
      cleared(c);
    } finally {
      c.close();
      await h.close();
    }
  });
  it.each(["jump", "class"] as const)(
    "verifies %s pins before asking for or sending credentials",
    async (hop) => {
      const h = await hosts({ mfaDelayMs: 10 });
      const config = { jump: h.jump, class: h.class };
      config[hop] = { ...config[hop], pins: ["0".repeat(64)] };
      const c = new Connection("student", config as any, h.agent as any);
      let requests = 0,
        original: Buffer | undefined;
      try {
        await expect(
          c.connect(async (_host, _instructions, prompts) => {
            if (scope(c).password.available)
              original ??= scope(c).password.value;
            requests += prompts.length;
            return prompts.map(() => "shared-password");
          }),
        ).rejects.toThrow("SSH authentication or connection failed");
        expect(requests).toBe(hop === "jump" ? 0 : 1);
        expect(h.authCalls).toEqual({ jump: hop === "jump" ? 0 : 1, class: 0 });
        if (original) zero(original);
        cleared(c);
      } finally {
        c.close();
        await h.close();
      }
    },
  );
  it.each(["jump", "class"] as const)(
    "ends on %s password rejection without retry or retained credentials",
    async (hop) => {
      const h = await hosts({
        rejectJump: hop === "jump",
        rejectClass: hop === "class",
        mfaDelayMs: 10,
      });
      const c = new Connection(
        "student",
        { jump: h.jump, class: h.class } as any,
        h.agent as any,
      );
      let requests = 0,
        original: Buffer | undefined;
      try {
        await expect(
          c.connect(async (_host, _instruction, prompts) => {
            if (scope(c).password.available)
              original ??= scope(c).password.value;
            requests += prompts.length;
            return prompts.map(() => "shared-password");
          }),
        ).rejects.toThrow("SSH authentication or connection failed");
        expect(requests).toBe(1);
        expect(h.authCalls).toEqual({ jump: 1, class: hop === "jump" ? 0 : 1 });
        if (original) zero(original);
        cleared(c);
      } finally {
        c.close();
        await h.close();
      }
    },
  );
  it.each(["cancel", "timeout"])(
    "clears immediately on %s during phone approval",
    async (reason) => {
      const h = await hosts({ mfaDelayMs: 5000 });
      const c = new Connection(
        "student",
        { jump: h.jump, class: h.class } as any,
        h.agent as any,
      );
      let original: Buffer | undefined;
      let number!: () => void;
      const displayed = new Promise<void>((resolve) => (number = resolve));
      const outcome = c
        .connect(
          async (_host, instruction, prompts) => {
            if (scope(c).password.available)
              original ??= scope(c).password.value;
            if (instruction.includes("42")) number();
            return prompts.map(() => "shared-password");
          },
          { timeoutMs: reason === "timeout" ? 1000 : 10000 },
        )
        .then(
          () => "success",
          () => "failed",
        );
      try {
        await displayed;
        if (reason === "cancel") {
          c.close();
          zero(original!);
          expect(scope(c)).toBeUndefined();
        }
        expect(await outcome).toBe("failed");
        zero(original!);
        cleared(c);
        expect(h.authCalls.class).toBe(0);
      } finally {
        c.close();
        await h.close();
      }
    },
  );
  it("does not capture a late browser answer after cancellation", async () => {
    const h = await hosts({ mfaDelayMs: 10 });
    const c = new Connection(
      "student",
      { jump: h.jump, class: h.class } as any,
      h.agent as any,
    );
    let answer!: (answers: string[]) => void, reached!: () => void;
    const requested = new Promise<void>((resolve) => (reached = resolve));
    const outcome = c
      .connect(async (_host, _instruction, prompts) => {
        if (!prompts.length) return [];
        reached();
        return new Promise<string[]>((resolve) => (answer = resolve));
      })
      .then(
        () => "success",
        () => "failed",
      );
    try {
      await requested;
      c.close();
      const late = ["shared-password"];
      answer(late);
      expect(await outcome).toBe("failed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(late).toEqual([""]);
      cleared(c);
      expect(h.authCalls).toEqual({ jump: 0, class: 0 });
    } finally {
      c.close();
      await h.close();
    }
  });
  it("login-only authenticates both hops without agent calls or shells", async () => {
    const h = await hosts({ mfaDelayMs: 10 });
    const c = new Connection(
      "student",
      {
        mode: "development",
        loginOnly: true,
        jump: h.jump,
        class: h.class,
      } as any,
      {
        call: async () => {
          throw Error("Unexpected agent call");
        },
      } as any,
    );
    try {
      await c.connect(async (_host, _instruction, prompts) =>
        prompts.map(() => "shared-password"),
      );
      expect(c.alive).toBe(true);
      cleared(c);
      expect(h.counts).toEqual({ jump: 1, class: 1, panes: 0 });
      await expect(c.open("attempt", crypto.randomUUID())).rejects.toThrow(
        "unavailable during login-only testing",
      );
    } finally {
      c.close();
      await h.close();
    }
  });
});

it("rejects a second recognized hidden password prompt instead of reusing a rejected password", async () => {
  const h = await hosts({ repeatJumpPassword: true });
  const c = new Connection(
    "student",
    { jump: h.jump, class: h.class } as any,
    h.agent as any,
  );
  let requests = 0;
  try {
    await expect(
      c.connect(async (_host, _instruction, prompts) => {
        requests += prompts.length;
        return prompts.map(() => "shared-password");
      }),
    ).rejects.toThrow();
    expect(requests).toBe(1);
    expect(h.authCalls).toEqual({ jump: 1, class: 0 });
    cleared(c);
  } finally {
    c.close();
    await h.close();
  }
});
it("a new login requires fresh input instead of reusing credentials from a closed transport", async () => {
  const h = await hosts({ mfaDelayMs: 10 });
  const connections: Connection[] = [];
  let requests = 0;
  try {
    for (let i = 0; i < 2; i++) {
      const c = new Connection(
        "student",
        {
          mode: "development",
          loginOnly: true,
          jump: h.jump,
          class: h.class,
        } as any,
        h.agent as any,
      );
      connections.push(c);
      await c.connect(async (_host, _instruction, prompts) => {
        requests += prompts.length;
        return prompts.map(() => "shared-password");
      });
      cleared(c);
      c.close();
    }
    expect(requests).toBe(2);
    expect(h.authCalls).toEqual({ jump: 2, class: 2 });
  } finally {
    for (const c of connections) c.close();
    await h.close();
  }
});
it("wipes temporary password copies when cancelled while awaiting a separate hidden MFA response", async () => {
  const h = await hosts({ classKeyboard: true, mfaDelayMs: 10 });
  const c = new Connection(
    "student",
    { jump: h.jump, class: h.class } as any,
    h.agent as any,
  );
  const copies: Buffer[] = [];
  const originalCopy = LoginPassword.prototype.copy;
  const spy = vi
    .spyOn(LoginPassword.prototype, "copy")
    .mockImplementation(function (this: LoginPassword) {
      const copy = originalCopy.call(this);
      copies.push(copy);
      return copy;
    });
  let reached!: () => void, answer!: (values: string[]) => void;
  const manualRequested = new Promise<void>((resolve) => (reached = resolve));
  const outcome = c
    .connect(async (_host, _instruction, prompts) => {
      if (prompts.some((p) => p.prompt === "Verification code")) {
        reached();
        return new Promise<string[]>((resolve) => (answer = resolve));
      }
      return prompts.map(() => "shared-password");
    })
    .then(
      () => "success",
      () => "failed",
    );
  try {
    await manualRequested;
    const original = scope(c).password.value as Buffer;
    expect(copies.at(-1)!.toString()).toBe("shared-password");
    c.close();
    zero(original);
    for (const copy of copies) zero(copy);
    cleared(c);
    const late = ["123456"];
    answer(late);
    expect(await outcome).toBe("failed");
    await new Promise((resolve) => setImmediate(resolve));
    expect(late).toEqual([""]);
    expect(h.authCalls.class).toBe(0);
  } finally {
    spy.mockRestore();
    c.close();
    await h.close();
  }
});
