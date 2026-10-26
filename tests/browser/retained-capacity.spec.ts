import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { simulatedMedia, ready } from "./transition-fixture.js";

const origin = "https://127.0.0.1:9444";
const shellQuote = (value: string) =>
  "'" + value.replaceAll("'", "'\\''") + "'";
const snapshot = z.object({
  attempt: z
    .object({
      id: z.string().uuid(),
      username: z.string(),
      uid: z.number().int(),
      state: z.string(),
      start: z.number(),
      deadline: z.number(),
      original_deadline: z.number(),
      transport: z.string(),
      grant: z.unknown(),
      generation: z.number().int(),
      settings: z
        .object({
          collection_file_mib: z.number(),
          collection_total_mib: z.number(),
        })
        .passthrough(),
      protected: z.boolean(),
      access_state: z.string(),
      checksum: z.string(),
    })
    .passthrough(),
  supervisor: z
    .object({
      pid: z.number().int().positive().optional(),
      ssh_peer: z.string().optional(),
      attached_panes: z.number().int().optional(),
    })
    .passthrough()
    .nullable(),
  kernel: z.array(
    z.object({
      unit: z.string(),
      frozen: z.enum(["0", "1"]),
      populated: z.enum(["0", "1"]),
    }),
  ),
});

test("sixteen actual native students keep sixty-four monitored SSH terminals and secure independent submissions", async ({
  browser,
  request,
}) => {
  test.skip(
    !process.env.EXAM_BROWSER_NATIVE_BUNDLE ||
      process.env.EXAM_BROWSER_NATIVE_STUDENTS !== "16",
    "Requires the exact guarded16-student native capacity fixture",
  );
  const large = process.env.EXAM_BROWSER_NATIVE_LARGE === "1";
  test.setTimeout(large ? 780000 : 480000);
  const metadata = await (
    await request.get("/api/fixture/native-ready")
  ).json();
  expect(metadata.privateGuest).toBe(true);
  expect(metadata.large).toBe(large);
  const students = z
    .array(z.object({ username: z.string(), uid: z.number().int().min(1000) }))
    .length(16)
    .parse(metadata.students);
  expect(new Set(students.map((student) => student.uid)).size).toBe(16);
  const login = await request.post("/api/admin/login", {
    headers: { origin },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const headers = { origin, "x-csrf-token": (await login.json()).csrf };
  let measuring = false;
  let signInEvents: { event: string; path: string; type?: string }[] = [];
  const fleet: {
    context: BrowserContext;
    page: Page;
    id: string;
    username: string;
    opened: Set<string>;
    unexpectedLocks: unknown[];
    timing: {
      contacts: number;
      states: number;
      maxContactMs: number;
      maxStateMs: number;
    };
  }[] = [];
  const inspect = async (finish = false) => {
    const response = await request.post("/api/fixture/native-fleet", {
      headers,
      data: { attempts: fleet.map((entry) => entry.id), finish },
      timeout: 30000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const value = await response.json();
    return {
      ...value,
      snapshots: z.array(snapshot).length(16).parse(value.snapshots),
    };
  };
  const collection = async (action: "observe" | "kill" | "retry-verify") => {
    const response = await request.post("/api/fixture/native-collection", {
      headers,
      data: { attempts: fleet.slice(0, 2).map((entry) => entry.id), action },
      timeout: 15000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const command = async (
    entry: (typeof fleet)[number],
    pane: number,
    text: string,
    marker: string,
    timeout = 10000,
  ) => {
    const input = entry.page.locator(".xterm-helper-textarea").nth(pane);
    await input.focus();
    await expect(input).toBeFocused();
    await entry.page.keyboard.type(text, { delay: 25 });
    await entry.page.keyboard.press("Enter");
    await expect(entry.page.locator(".xterm-rows").nth(pane)).toContainText(
      marker,
      { timeout },
    );
    await expect(
      entry.page.getByText(/Recent terminal input was not sent/),
    ).toHaveCount(0);
  };
  try {
    for (const student of students) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true }),
        page = await context.newPage(),
        opened = new Set<string>(),
        unexpectedLocks: unknown[] = [],
        confirmations = new Map<string, number>(),
        timing = { contacts: 0, states: 0, maxContactMs: 0, maxStateMs: 0 };
      page.setDefaultTimeout(10000);
      await simulatedMedia(page);
      const events: typeof signInEvents = [];
      signInEvents = events;
      page.on("websocket", (socket) => {
        const path = new URL(socket.url()).pathname;
        const note = (event: string, type?: unknown) => {
          if (events.length >= 64) return;
          events.push({
            event,
            path,
            ...(typeof type === "string" && /^[a-z-]{1,40}$/.test(type)
              ? { type }
              : {}),
          });
        };
        note("opened");
        socket.once("close", () => note("closed"));
        socket.once("socketerror", () => note("socket-error"));
        socket.on("framereceived", ({ payload }) => {
          try {
            note("reply", JSON.parse(String(payload)).type);
          } catch {}
        });
        if (path !== "/api/student/session") return;
        socket.on("framesent", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            if (
              measuring &&
              message.type === "heartbeat" &&
              message.confirmation
            ) {
              confirmations.set(message.confirmation, performance.now());
              if (confirmations.size > 32)
                confirmations.delete(confirmations.keys().next().value!);
            }
          } catch {}
        });
        socket.on("framereceived", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            if (message.type === "opened" && message.input?.protocol === "v1")
              opened.add(message.pane);
            if (message.type === "state" && message.attempt?.state === "LOCKED")
              unexpectedLocks.push({
                state: message.attempt.state,
                generation: message.attempt.generation,
              });
            const sent = confirmations.get(message.confirmation);
            if (sent !== undefined && message.type === "monitoring-contact") {
              timing.contacts++;
              timing.maxContactMs = Math.max(
                timing.maxContactMs,
                performance.now() - sent,
              );
            } else if (sent !== undefined && message.type === "state") {
              timing.states++;
              timing.maxStateMs = Math.max(
                timing.maxStateMs,
                performance.now() - sent,
              );
              confirmations.delete(message.confirmation);
            }
          } catch {}
        });
      });
      await page.goto(origin);
      await page.getByLabel("Exam ID", { exact: true }).fill("native-browser");
      await page.getByLabel("Enrolled username").fill(student.username);
      await page
        .getByRole("button", { name: "Start SSH sign-in", exact: true })
        .click();
      await page.getByLabel("Shared SSH password").fill("shared-password");
      await page
        .getByRole("button", { name: "Respond to this host", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open preflight & practice", exact: true })
        .click();
      await ready(page);
      await page
        .getByRole("button", { name: "Begin exam", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Begin exam", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/student/exam")).json()).attempt
              ?.state,
          { timeout: 20000 },
        )
        .toBe("ACTIVE");
      const attempt = (
        await (await page.request.get("/api/student/exam")).json()
      ).attempt;
      const entry = {
        context,
        page,
        id: attempt.id,
        username: student.username,
        opened,
        unexpectedLocks,
        timing,
      };
      fleet.push(entry);
      await expect.poll(() => opened.size, { timeout: 15000 }).toBe(1);
      for (let pane = 1; pane < 4; pane++) {
        await page
          .getByRole("button", { name: "New terminal", exact: true })
          .click();
        await expect.poll(() => opened.size, { timeout: 15000 }).toBe(pane + 1);
      }
      await expect(page.locator(".xterm-helper-textarea")).toHaveCount(4);
      for (let pane = 0; pane < 4; pane++) {
        await command(
          entry,
          pane,
          `printf 'CAPACITY-%s-%s-END\\n' '${student.username}' '${pane}'`,
          `CAPACITY-${student.username}-${pane}-END`,
        );
      }
      // Check each real native boundary while the class grows. A per-student
      // refusal should not be hidden until all sixty-four panes have opened.
      const probe = await request.get("/api/fixture/native-state", {
        params: { attempt: entry.id },
        timeout: 10000,
      });
      expect(probe.ok(), await probe.text()).toBe(true);
      const observed = snapshot.parse(await probe.json());
      expect(observed.attempt).toMatchObject({
        id: entry.id,
        state: "ACTIVE",
        generation: 0,
      });
      expect(observed.supervisor).toMatchObject({
        ssh_peer: "pinned-live",
        attached_panes: 4,
      });
      expect(observed.kernel.length).toBe(4);
      expect(
        observed.kernel.every(
          (unit) => unit.populated === "1" && unit.frozen === "0",
        ),
      ).toBe(true);
    }
    const before = await inspect();
    measuring = true;
    expect(
      new Set(
        before.snapshots.map(
          (entry: z.infer<typeof snapshot>) => entry.supervisor?.pid,
        ),
      ).size,
    ).toBe(16);
    expect(
      before.snapshots.every(
        (entry: z.infer<typeof snapshot>) =>
          entry.attempt.state === "ACTIVE" &&
          entry.supervisor?.ssh_peer === "pinned-live" &&
          entry.supervisor.attached_panes === 4 &&
          entry.kernel.length === 4 &&
          entry.kernel.every(
            (unit) => unit.frozen === "0" && unit.populated === "1",
          ),
      ),
    ).toBe(true);
    for (const entry of fleet) {
      await command(
        entry,
        0,
        `printf 'FLEET-%s-END\\n' '${entry.username}' | tee /work/fleet-proof.txt`,
        `FLEET-${entry.username}-END`,
      );
    }
    if (large) {
      for (const entry of fleet.slice(0, 2)) {
        expect(
          before.snapshots.find(
            (value: z.infer<typeof snapshot>) => value.attempt.id === entry.id,
          )!.attempt.settings,
        ).toMatchObject({
          collection_file_mib: 128,
          collection_total_mib: 512,
        });
        // 508MiB plus the small proof/template files remains below the512MiB
        // snapshot. Repeated1MiB random blocks exceed gzip's match window.
        const program =
          "import os; block=os.urandom(1024*1024); " +
          "[(lambda f: ([f.write(block) for _ in range(127)], f.flush(), os.fsync(f.fileno()), f.close()))(open('/work/large-%d.bin'%n,'xb')) for n in range(4)]; print('LARGE-'+'READY',flush=True)";
        await command(
          entry,
          0,
          "python3 -c " + shellQuote(program),
          "LARGE-READY",
          40000,
        );
      }
    }
    // Finish a pair while the remaining14 must still accept new real input.
    const finish = async (entry: (typeof fleet)[number]) => {
      await entry.page
        .getByRole("button", { name: "Finish exam", exact: true })
        .click();
      await entry.page
        .getByRole("dialog")
        .getByRole("button", { name: "Finish exam", exact: true })
        .click();
    };
    await Promise.all(fleet.slice(0, 2).map(finish));
    if (large) {
      const worker = z.object({
        attempt: z.string().uuid(),
        unit: z.string(),
        pid: z.number().int().positive(),
        writing: z.boolean(),
      });
      await expect
        .poll(
          async () => {
            const observed = await collection("observe");
            return z
              .array(worker)
              .parse(observed.workers)
              .filter((entry) => entry.writing).length;
          },
          { timeout: 15000 },
        )
        .toBe(2);
      const killed = await collection("kill");
      expect(killed.status).toBe("killed");
      expect(
        z
          .array(worker)
          .length(2)
          .parse(killed.workers)
          .every((entry) => entry.writing),
      ).toBe(true);
      await expect
        .poll(
          async () => {
            const status = await request.get("/api/fixture/native-state", {
              params: { attempt: fleet[0].id },
            });
            const value = snapshot.parse(await status.json());
            expect(value.attempt).toMatchObject({
              start: before.snapshots[0].attempt.start,
              deadline: before.snapshots[0].attempt.deadline,
              access_state: "HELD",
            });
            return value.attempt.state;
          },
          { timeout: 15000 },
        )
        .toBe("COLLECTION_FAILED");
      expect((await collection("retry-verify")).status).toBe("pending");
    }
    for (const entry of fleet.slice(2)) {
      await command(
        entry,
        3,
        `printf 'PEER-%s-END\\n' '${entry.username}'`,
        `PEER-${entry.username}-END`,
      );
    }
    const during = await inspect();
    for (const old of before.snapshots) {
      const current = during.snapshots.find(
        (entry: z.infer<typeof snapshot>) =>
          entry.attempt.id === old.attempt.id,
      )!;
      expect(current.attempt).toMatchObject({
        start: old.attempt.start,
        deadline: old.attempt.deadline,
        original_deadline: old.attempt.original_deadline,
        transport: old.attempt.transport,
        grant: old.attempt.grant,
        generation: old.attempt.generation,
      });
      if (!fleet.slice(0, 2).some((entry) => entry.id === old.attempt.id))
        expect(current.supervisor).toMatchObject({
          pid: old.supervisor!.pid,
          ssh_peer: "pinned-live",
          attached_panes: 4,
        });
    }
    if (large) {
      await expect
        .poll(
          async () => {
            const operation = await collection("retry-verify");
            expect(operation.status, JSON.stringify(operation)).not.toBe(
              "failed",
            );
            return operation.status;
          },
          { timeout: 300000 },
        )
        .toBe("complete");
      const operation = await collection("retry-verify");
      expect(Object.keys(operation.verified).sort()).toEqual(
        fleet
          .slice(0, 2)
          .map((entry) => entry.id)
          .sort(),
      );
      expect(
        Object.values(operation.verified).every(
          (files) =>
            JSON.stringify(files) ===
            JSON.stringify([
              "large-0.bin",
              "large-1.bin",
              "large-2.bin",
              "large-3.bin",
            ]),
        ),
      ).toBe(true);
      // Fresh post-retry input proves the14 peers survived the entire fault /
      // large compression/export interval, not merely its first milliseconds.
      for (const entry of fleet.slice(2)) {
        await command(
          entry,
          3,
          `printf 'AFTER-LARGE-%s-END\\n' '${entry.username}'`,
          `AFTER-LARGE-${entry.username}-END`,
        );
      }
    }
    await Promise.all(fleet.slice(2).map(finish));
    await expect
      .poll(
        async () => {
          const result = await request.get("/api/admin/attempts", {
            params: { q: "examq" },
          });
          const attempts = (await result.json()).attempts;
          return attempts.filter(
            (entry: any) =>
              fleet.some((owned) => owned.id === entry.id) &&
              entry.state === "COMPLETED" &&
              !!entry.protected,
          ).length;
        },
        { timeout: 60000 },
      )
      .toBe(16);
    const completed = await inspect(true);
    expect(fleet.flatMap((entry) => entry.unexpectedLocks)).toEqual([]);
    if (large) {
      for (const entry of fleet.slice(2)) {
        expect(entry.timing.contacts).toBeGreaterThanOrEqual(3);
        expect(entry.timing.states).toBeGreaterThanOrEqual(3);
        // Existing privileged workload acceptance uses a5s healthy-control
        // budget. This records BOTH immediate contact and public state replies;
        // neither receipt is independently work permission.
        expect(entry.timing.maxContactMs).toBeLessThan(5000);
        expect(entry.timing.maxStateMs).toBeLessThan(5000);
      }
    }
    await mkdir(test.info().outputDir, { recursive: true });
    const metrics = test.info().outputPath("capacity-metrics.json");
    await writeFile(
      metrics,
      JSON.stringify(
        fleet.map((entry) => ({ username: entry.username, ...entry.timing })),
      ),
      { mode: 0o600 },
    );
    await test.info().attach("capacity-metrics", {
      path: metrics,
      contentType: "application/json",
    });
    expect(completed.preservation).toBe("FULL");
    expect(
      completed.snapshots.every(
        (entry: z.infer<typeof snapshot>) =>
          entry.attempt.protected &&
          entry.attempt.access_state === "HELD" &&
          entry.attempt.checksum.length > 0,
      ),
    ).toBe(true);
  } catch (error) {
    await mkdir(test.info().outputDir, { recursive: true });
    const failure = test.info().outputPath("capacity-failure.json");
    const publicStates = await Promise.all(
      fleet.map(async (entry) => {
        try {
          const response = await entry.page.request.get("/api/student/exam", {
            timeout: 3000,
          });
          const value = (await response.json()).attempt;
          return {
            username: entry.username,
            state: value?.state,
            generation: value?.generation,
          };
        } catch {
          return { username: entry.username, unavailable: true };
        }
      }),
    );
    await writeFile(
      failure,
      JSON.stringify({
        error: String(error).slice(0, 1200),
        signInEvents,
        publicStates,
      }),
      { mode: 0o600 },
    );
    await test.info().attach("capacity-failure", {
      path: failure,
      contentType: "application/json",
    });
    if (fleet.length === 16) {
      try {
        const path = test.info().outputPath("native-fleet-failure.json");
        await writeFile(path, JSON.stringify(await inspect()), { mode: 0o600 });
        await test.info().attach("native-fleet-failure", {
          path,
          contentType: "application/json",
        });
      } catch {}
    }
    throw error;
  } finally {
    await Promise.all(fleet.map((entry) => entry.context.close()));
  }
});
