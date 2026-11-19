import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import {
  simulatedMedia,
  ready,
  readyTerminal,
  selectVerifiedTerminal,
} from "./transition-fixture.js";
import { observeWasmBootstrap } from "../fixtures/wasm-bootstrap-diagnostics.js";
import {
  openUnauthenticatedStressWelcome,
  waitForStressStartResponse,
  waitForStressExamSummary,
  waitForStressPasswordPrompt,
  prepareStressPages,
  watchStressNavigation,
  recoverRefusedStressPane,
} from "../fixtures/stress-navigation.js";
import { MONITORING_EVIDENCE_WINDOW_MS } from "../../packages/protocol/monitoring-evidence.js";
import { OPERATION_TIMEOUT_MS } from "../../packages/protocol/timeouts.js";
import { readRemoteStressHeadroom } from "../fixtures/stress-generator-status.js";

const origin = "https://127.0.0.1:9444";
const stressRun = process.env.EXAM_STRESS_RUN;
const fleetCount = stressRun
  ? Number(process.env.EXAM_BROWSER_NATIVE_STUDENTS)
  : 16;
if (stressRun && ![35, 70].includes(fleetCount))
  throw Error(
    "Manual endurance requires the explicit 35- or 70-student cohort",
  );
async function generatorHeadroom() {
  const memory = await readFile("/proc/meminfo", "utf8");
  const available = Number(/MemAvailable:\s+(\d+)/.exec(memory)?.[1]) * 1024;
  if (!Number.isFinite(available) || available < 768 * 1024 * 1024)
    throw Error(
      "Load-generator memory headroom is below768MiB; abort only the owned synthetic test before affecting other applications",
    );
  const scratch = process.env.EXAM_STRESS_LOCAL_SCRATCH;
  if (!scratch)
    throw Error(
      "The endurance run requires its private workspace scratch; use the manual stress runner",
    );
  const filesystem = await statfs(scratch);
  if (Number(filesystem.bavail) * Number(filesystem.bsize) < 8 * 1024 ** 3)
    throw Error(
      "Local stress scratch has less than8GiB headroom; stop only the owned synthetic test before recording writes fail",
    );
  const remote = process.env.EXAM_STRESS_GENERATOR_STATUS;
  if (remote) return readRemoteStressHeadroom(remote);
  return available;
}
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
      errors: z
        .array(z.string())
        .nullable()
        .transform((errors) => errors ?? []),
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

test(
  stressRun
    ? `${fleetCount} native students sustain ${fleetCount * 4} terminals and submit together`
    : "sixteen actual native students keep sixty-four monitored SSH terminals and secure independent submissions",
  async ({ browser, request }) => {
    test.skip(
      !process.env.EXAM_BROWSER_NATIVE_BUNDLE ||
        process.env.EXAM_BROWSER_NATIVE_STUDENTS !== String(fleetCount),
      "Requires the exact selected guarded native capacity fixture",
    );
    const large = process.env.EXAM_BROWSER_NATIVE_LARGE === "1";
    const recovery = process.env.EXAM_BROWSER_NATIVE_CAPACITY_RECOVERY === "1";
    expect(large && recovery).toBe(false);
    test.setTimeout(
      stressRun ? 14100000 : large ? 780000 : recovery ? 660000 : 480000,
    );
    if (stressRun) expect(large || recovery).toBe(false);
    const metadata = await (
      await request.get("/api/fixture/native-ready")
    ).json();
    expect(metadata.privateGuest).toBe(true);
    expect(metadata.large).toBe(large);
    expect(metadata.capacityRecovery).toBe(recovery);
    expect(metadata.compiledConnectionWorkers).toBe(true);
    expect(metadata.candidateConnectionWorkers).toBe(
      metadata.coLocation ? 40 : stressRun ? 96 : 32,
    );
    const students = z
      .array(
        z.object({ username: z.string(), uid: z.number().int().min(1000) }),
      )
      .length(fleetCount)
      .parse(metadata.students);
    expect(new Set(students.map((student) => student.uid)).size).toBe(
      fleetCount,
    );
    const login = await request.post("/api/admin/login", {
      headers: { origin },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const headers = { origin, "x-csrf-token": (await login.json()).csrf };
    let measuring = false;
    let recovering = false;
    let bootstrap = async (): Promise<unknown> => null;
    const contexts: BrowserContext[] = [];
    const lateNavigations: { username: string; path: string }[] = [];
    const paneRefusals: {
      username: string;
      expected: number;
      diagnostics: unknown;
    }[] = [];
    let signInEvents: { event: string; path: string; type?: string }[] = [];
    let setupStudent = "";
    let setupPage: Page | undefined;
    const transportFailures = {
      total: 0,
      events: [] as {
        username: string;
        path: string;
        event: string;
        elapsed_ms: number;
        status?: number;
        error?: string;
      }[],
    };
    let setupNetwork: {
      event: string;
      path: string;
      elapsed_ms: number;
      status?: number;
    }[] = [];
    let lastCommand: {
      student: string;
      window: string;
      pane: number;
      marker: string;
      stage: string;
    } | null = null;
    const fleet: {
      context: BrowserContext;
      page: Page;
      id: string;
      username: string;
      panes: string[];
      opened: Set<string>;
      unexpectedLocks: unknown[];
      recoveryReplies: unknown[];
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
        timeout: stressRun ? 190000 : 30000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      const value = await response.json();
      return {
        ...value,
        snapshots: z.array(snapshot).length(fleetCount).parse(value.snapshots),
      };
    };
    const collection = async (action: "observe" | "kill" | "retry-verify") => {
      const response = await request.post("/api/fixture/native-collection", {
        headers,
        data: { attempts: fleet.slice(0, 2).map((entry) => entry.id), action },
        timeout: 15000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      const value = await response.json();
      expect(
        value,
        `Native collection fixture refused ${action}`,
      ).not.toHaveProperty("bridge_error");
      return value;
    };
    const command = async (
      entry: (typeof fleet)[number],
      pane: number,
      text: string,
      marker: string,
      timeout = 10000,
    ) => {
      const id = entry.panes[pane];
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
      lastCommand = {
        student: entry.username,
        window: id,
        pane,
        marker,
        stage: "selecting",
      };
      const selectionStarted = performance.now();
      const terminal = await selectVerifiedTerminal(
        entry.page,
        entry.page.locator(`.winbox[id="${id}"]`),
      );
      const selectionMs = Math.round(performance.now() - selectionStarted);
      if (stressRun && selectionMs > 1000)
        console.log(
          JSON.stringify({
            phase: "terminal-selection-wait",
            student: entry.username,
            pane,
            elapsed_ms: selectionMs,
          }),
        );
      // Paste a normal command through the real terminal input path. Artificial
      // per-character delays make fleet ramp time measure the generator instead.
      lastCommand.stage = "typing";
      await entry.page.keyboard.insertText(text);
      await entry.page.keyboard.press("Enter");
      lastCommand.stage = "waiting-output";
      await expect(terminal.locator(".xterm-rows")).toContainText(marker, {
        timeout,
      });
      await expect(
        entry.page.getByText(/Recent terminal input was not sent/),
      ).toHaveCount(0);
      lastCommand.stage = "verified";
    };
    try {
      const prepared = stressRun
        ? await prepareStressPages({
            browser,
            origin,
            students: students.map((student) => student.username),
            contexts,
            initialize: async (page, username) => {
              await generatorHeadroom();
              setupStudent = username;
              setupPage = page;
              bootstrap = await observeWasmBootstrap(page);
              await simulatedMedia(page, true);
              return bootstrap;
            },
            note: console.log,
          })
        : [];
      if (stressRun) {
        expect(prepared).toHaveLength(fleetCount);
        const unstarted = await request.get("/api/admin/attempts", {
          params: { q: "examq" },
        });
        expect(unstarted.ok(), await unstarted.text()).toBe(true);
        expect((await unstarted.json()).attempts).toEqual([]);
        console.log(
          JSON.stringify({
            phase: "welcome-cohort-ready",
            students: prepared.length,
            web_attempts: 0,
          }),
        );
      }
      for (const student of students) {
        if (stressRun) await generatorHeadroom();
        const preloaded = prepared.find(
          (entry) => entry.username === student.username,
        );
        if (stressRun) expect(preloaded?.username).toBe(student.username);
        const context =
          preloaded?.context ??
          (await browser.newContext({ ignoreHTTPSErrors: true }));
        if (!preloaded) contexts.push(context);
        const page = preloaded?.page ?? (await context.newPage()),
          opened = new Set<string>(),
          unexpectedLocks: unknown[] = [],
          recoveryReplies: unknown[] = [],
          confirmations = new Map<string, number>(),
          timing = { contacts: 0, states: 0, maxContactMs: 0, maxStateMs: 0 };
        page.setDefaultTimeout(10000);
        bootstrap = preloaded?.data ?? (await observeWasmBootstrap(page));
        if (!preloaded) await simulatedMedia(page, !!stressRun);
        if (stressRun)
          await page.evaluate(() => {
            const evidence = {
              transitions: 0,
              events: [] as { at_ms: number; inert: boolean; status: string }[],
            };
            (window as any).__stressInputGates = evidence;
            let previous: boolean | undefined;
            new MutationObserver(() => {
              const header =
                document.querySelector<HTMLElement>(".exam-toolbar");
              if (!header || previous === header.inert) return;
              previous = header.inert;
              evidence.transitions++;
              if (evidence.events.length < 1024)
                evidence.events.push({
                  at_ms: Math.round(performance.now()),
                  inert: header.inert,
                  status: header.innerText.slice(0, 500),
                });
            }).observe(document, {
              subtree: true,
              attributes: true,
              childList: true,
              characterData: true,
            });
          });
        page.on("response", async (response) => {
          if (!recovering) return;
          const path = new URL(response.url()).pathname;
          if (!/\/attempts\/[^/]+\/(status|continue)$/.test(path)) return;
          try {
            const value = await response.json();
            if (recoveryReplies.length >= 64) recoveryReplies.shift();
            recoveryReplies.push({
              path,
              status: response.status(),
              state: value.attempt?.state,
              generation: value.attempt?.generation,
              automaticTechnical: value.automaticTechnical,
              error:
                typeof value.error === "string"
                  ? value.error.slice(0, 1200)
                  : undefined,
            });
          } catch {}
        });
        const events: typeof signInEvents = [];
        signInEvents = events;
        const setupEvents: typeof setupNetwork = [];
        setupNetwork = setupEvents;
        setupStudent = student.username;
        setupPage = page;
        const setupStarted = performance.now();
        let observingSetup = true;
        let acknowledgedAuthentication = false;
        page.on("response", (response) => {
          if (
            new URL(response.url()).pathname === "/api/auth/complete" &&
            response.ok()
          )
            acknowledgedAuthentication = true;
        });
        if (stressRun) {
          const failure = (
            event: string,
            url: string,
            status?: number,
            error?: string,
          ) => {
            const parsed = new URL(url);
            if (
              parsed.origin !== origin ||
              !parsed.pathname.startsWith("/api/")
            )
              return;
            transportFailures.total++;
            if (transportFailures.events.length >= 512)
              transportFailures.events.shift();
            const value = {
              username: student.username,
              path: parsed.pathname,
              event,
              elapsed_ms: Math.round(performance.now() - setupStarted),
              status,
              error,
            };
            transportFailures.events.push(value);
            return value;
          };
          page.on("requestfailed", (request) =>
            failure(
              "failed",
              request.url(),
              undefined,
              request.failure()?.errorText,
            ),
          );
          page.on("response", async (response) => {
            if (response.status() < 400) return;
            const value = failure(
              "response",
              response.url(),
              response.status(),
            );
            if (!value) return;
            try {
              const body = await response.json();
              if (typeof body.error === "string")
                value.error = body.error.slice(0, 400);
            } catch {}
          });
          const record = (event: string, url: string, status?: number) => {
            const path = new URL(url).pathname;
            if (
              !observingSetup ||
              !/^\/api\/student\/attempts\/[^/]+\/(?:frames(?:\/(?:binary|challenged))?|capture-challenges|monitoring-readiness|begin)$/.test(
                path,
              )
            )
              return;
            if (setupEvents.length >= 64) setupEvents.shift();
            setupEvents.push({
              event,
              path,
              elapsed_ms: Math.round(performance.now() - setupStarted),
              ...(status === undefined ? {} : { status }),
            });
          };
          page.on("request", (request) => record("requested", request.url()));
          page.on("response", (response) =>
            record("response", response.url(), response.status()),
          );
          page.on("requestfailed", (request) =>
            record("failed", request.url()),
          );
        }
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
              if (
                !recovering &&
                message.type === "state" &&
                message.attempt?.state === "LOCKED"
              )
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
        if (stressRun)
          watchStressNavigation(
            page,
            () => fleet.length > 0,
            (path) =>
              lateNavigations.push({ username: student.username, path }),
          );
        if (preloaded) {
          await page
            .getByLabel("Username", { exact: true })
            .waitFor({ state: "visible", timeout: OPERATION_TIMEOUT_MS });
        } else if (stressRun && process.env.EXAM_STRESS_GENERATOR_STATUS)
          await openUnauthenticatedStressWelcome(page, origin, console.log);
        else await page.goto(origin);
        await page
          .getByLabel("Exam ID", { exact: true })
          .fill("native-browser");
        await page.getByLabel("Username").fill(student.username);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        if (stressRun) await waitForStressPasswordPrompt(page, console.log);
        await page
          .getByLabel("Password", { exact: true })
          .fill("shared-password");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        if (stressRun)
          await waitForStressExamSummary(
            page,
            { username: student.username, exam: "native-browser" },
            () => acknowledgedAuthentication,
            console.log,
          );
        for (let retry = 0; retry < 3; retry++) {
          const result = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/student/preflight" &&
              response.request().method() === "POST",
            { timeout: 30000 },
          );
          await page
            .getByRole("button", {
              name: "Check setup and practice",
              exact: true,
            })
            .click();
          const response = await result;
          if (response.ok()) break;
          const body = await response.json();
          expect(response.status()).toBe(409);
          expect(body.code).toBe("EXAM_SETUP_BUSY");
          const current = (
            await (await page.request.get("/api/student/exam")).json()
          ).attempt;
          expect(
            current ?? null,
            "Health refused before creating or reserving setup",
          ).toBeNull();
          expect(
            retry,
            "Readiness busy did not settle within bounded setup retries",
          ).toBeLessThan(2);
          await page.waitForTimeout(250);
        }
        await ready(page, !!stressRun);
        for (let retry = 0; retry < 3; retry++) {
          const result = stressRun
            ? waitForStressStartResponse(page, console.log)
            : page.waitForResponse(
                (response) =>
                  new URL(response.url()).pathname.endsWith("/begin") &&
                  response.request().method() === "POST",
                { timeout: 30000 },
              );
          const [response] = await Promise.all([
            result,
            (async () => {
              if (retry === 0)
                await page
                  .getByRole("button", { name: "Start exam", exact: true })
                  .click();
              await page
                .getByRole("dialog")
                .getByRole("button", { name: "Start exam", exact: true })
                .click();
            })(),
          ]);
          if (response.ok()) break;
          expect(response.status(), await response.text()).toBe(409);
          expect((await response.json()).code).toBe("EXAM_SETUP_BUSY");
          const current = (
            await (await page.request.get("/api/student/exam")).json()
          ).attempt;
          const inspected = await request.get(
            `/api/fixture/native-state?attempt=${encodeURIComponent(current.id)}`,
            { headers },
          );
          expect(inspected.ok(), await inspected.text()).toBe(true);
          const view = await inspected.json();
          // A no-wait health observation can overlap its own background probe.
          // Only its positively unstarted, unconsumed refusal may be retried.
          expect(view.gateway_start).toMatchObject({
            state: "PREPARING",
            start: null,
            deadline: null,
            permission_status: "AVAILABLE",
            begin_intent: null,
            retry_reason: "native-readiness-busy",
          });
          expect(view.attempt.state).toBe("PREPARING");
          expect(view.attempt.start).toBe(0);
          expect(
            retry,
            "Readiness busy did not settle within the bounded fresh-Start workflow",
          ).toBeLessThan(2);
          await expect(
            page
              .getByRole("dialog", { name: "Start your exam?" })
              .getByRole("alert"),
          ).toHaveText(
            "The server is checking exam setup. Wait a moment, then try again.",
          );
          // The next actual Start performs fresh capture/native verification.
          await page.waitForTimeout(250);
        }
        observingSetup = false;
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/api/student/exam")).json())
                .attempt?.state,
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
          panes: [] as string[],
          opened,
          unexpectedLocks,
          recoveryReplies,
          timing,
        };
        fleet.push(entry);
        await expect.poll(() => opened.size, { timeout: 15000 }).toBe(1);
        for (let pane = 1; pane < 4; pane++) {
          await page
            .getByRole("button", { name: "New terminal", exact: true })
            .click();
          if (stressRun) {
            const notice = page.getByRole("alert", {
              name: "Terminal notice",
              exact: true,
            });
            await expect
              .poll(
                async () =>
                  opened.size === pane + 1 || (await notice.isVisible()),
                {
                  timeout: OPERATION_TIMEOUT_MS,
                },
              )
              .toBe(true);
            if (opened.size !== pane + 1)
              await recoverRefusedStressPane({
                page,
                attempt: entry.id,
                opened: () => opened.size,
                expected: pane + 1,
                record: async () => {
                  const refusal = {
                    username: entry.username,
                    expected: pane + 1,
                    diagnostics: await bootstrap(),
                  };
                  paneRefusals.push(refusal);
                  await mkdir(test.info().outputDir, { recursive: true });
                  const nativePath = test
                    .info()
                    .outputPath(
                      `pane-refusal-${paneRefusals.length}-native.json`,
                    );
                  try {
                    const native = await request.get(
                      "/api/fixture/native-state",
                      {
                        params: { attempt: entry.id },
                        timeout: 15000,
                      },
                    );
                    await writeFile(nativePath, await native.text(), {
                      mode: 0o600,
                    });
                  } catch (error) {
                    await writeFile(
                      nativePath,
                      JSON.stringify({
                        unavailable: String(error).slice(0, 256),
                      }),
                      { mode: 0o600 },
                    );
                  }
                  await writeFile(
                    test.info().outputPath("pane-refusals.json"),
                    JSON.stringify(paneRefusals, null, 2),
                    { mode: 0o600 },
                  );
                  console.log(
                    JSON.stringify({
                      phase: "terminal-refusal-recovery",
                      ...refusal,
                    }),
                  );
                  // Stop before spending the90-minute peak on a candidate
                  // already known to fail clean acceptance. Teardown retains
                  // private native logs for focused diagnosis; no blind ramp.
                  throw Error(
                    "Confirmed terminal refusal recorded; stop this cohort for native diagnosis before endurance",
                  );
                },
              });
          }
          await expect
            .poll(() => opened.size, {
              timeout: stressRun ? OPERATION_TIMEOUT_MS : 15000,
            })
            .toBe(pane + 1);
        }
        await expect(page.locator(".xterm-helper-textarea")).toHaveCount(4);
        await page
          .getByRole("button", { name: "Arrange terminals", exact: true })
          .click();
        await readyTerminal(page, 4, 0);
        entry.panes = await page
          .locator(".winbox")
          .evaluateAll((windows) => windows.map((window) => window.id));
        for (let pane = 0; pane < 4; pane++) {
          await command(
            entry,
            pane,
            `capacity_buffer='${student.username}-${pane}'; printf 'CAPACITY-%s-END\\n' "$capacity_buffer"${stressRun ? `; (while sleep 5; do printf 'WORK-%s\\n' "$capacity_buffer" | tee -a /work/pane-${pane}.txt; done) &` : ""}`,
            `CAPACITY-${student.username}-${pane}-END`,
          );
        }
        if (stressRun) {
          await command(
            entry,
            0,
            `printf 'int main(){return 0;}\\n' > /work/stress.c; gcc -g /work/stress.c -o /work/stress-bin && gdb -nx -q -batch -ex run /work/stress-bin && printf 'BUILD-%s-OK\\n' '${entry.username}'`,
            `BUILD-${entry.username}-OK`,
            30000,
          );
          await command(
            entry,
            1,
            "gdb -nx -q -ex 'break main' -ex run /work/stress-bin",
            "Breakpoint 1, main",
            30000,
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
        expect(lateNavigations).toEqual([]);
        console.log(
          JSON.stringify({
            phase: "ramp-progress",
            students: fleet.length,
            terminals: fleet.length * 4,
            gcc_gdb_verified: !!stressRun,
          }),
        );
      }
      let before = await inspect();
      measuring = true;
      expect(
        new Set(
          before.snapshots.map(
            (entry: z.infer<typeof snapshot>) => entry.supervisor?.pid,
          ),
        ).size,
      ).toBe(fleetCount);
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
      if (recovery) {
        const evidence = async (entry: (typeof fleet)[number]) => {
          const response = await request.get("/api/fixture/native-evidence", {
            params: { attempt: entry.id },
            timeout: 5000,
          });
          expect(response.ok(), await response.text()).toBe(true);
          return z
            .object({
              state: z.literal("fresh"),
              coverageEpoch: z.string().regex(/^[a-f0-9]{64}$/),
              sequence: z.number().int().positive(),
              gaps: z.literal(0),
              remainingMS: z.number().positive(),
            })
            .parse(await response.json());
        };
        const original = before;
        const coverage = await Promise.all(fleet.map(evidence));
        const fault = async (action: "start" | "status") => {
          const response = await request.post("/api/fixture/native-fleet", {
            headers,
            data: {
              attempts: fleet.map((entry) => entry.id),
              recovery: action,
            },
            timeout: 30000,
          });
          expect(response.ok(), await response.text()).toBe(true);
          return response.json();
        };
        recovering = true;
        const started = await fault("start");
        expect(started.error).toBeNull();
        // Positively observe all64 populated kernel scopes held before restoring
        // proof transport. A browser overlay alone is not a freeze oracle.
        await expect
          .poll(
            async () => {
              const held = await inspect();
              return held.snapshots.filter(
                (entry: z.infer<typeof snapshot>) =>
                  entry.attempt.state === "LOCKED" &&
                  entry.attempt.monitoring_hold_kind === "technical" &&
                  entry.attempt.retained_hold === "held" &&
                  entry.supervisor?.ssh_peer === "pinned-live" &&
                  entry.kernel.length === 4 &&
                  entry.kernel.every(
                    (unit) => unit.frozen === "1" && unit.populated === "1",
                  ),
              ).length;
            },
            { timeout: MONITORING_EVIDENCE_WINDOW_MS + 10000 },
          )
          .toBe(16);
        expect((await fault("status")).phase).toBe("offline");
        const heldCoverage = await Promise.all(fleet.map(evidence));
        for (let i = 0; i < fleet.length; i++) {
          expect(heldCoverage[i].coverageEpoch).toBe(coverage[i].coverageEpoch);
          expect(heldCoverage[i].sequence).toBeGreaterThan(
            coverage[i].sequence,
          );
        }
        await expect
          .poll(async () => (await fault("status")).phase, {
            timeout: 40000,
          })
          .toBe("restored");
        const restored = await fault("status");
        expect(restored.error).toBeNull();
        expect(restored.after).toBe(started.before);
        expect(restored.watchdog_after).toBe(started.watchdog);
        await expect
          .poll(
            async () => {
              const active = await inspect();
              return active.snapshots.filter(
                (entry: z.infer<typeof snapshot>) =>
                  entry.attempt.state === "ACTIVE" &&
                  entry.attempt.monitoring_resume_kind === "technical" &&
                  entry.supervisor?.ssh_peer === "pinned-live" &&
                  entry.kernel.length === 4 &&
                  entry.kernel.every(
                    (unit) => unit.frozen === "0" && unit.populated === "1",
                  ),
              ).length;
            },
            { timeout: 30000 },
          )
          .toBe(16);
        before = await inspect();
        for (const old of original.snapshots) {
          const current = before.snapshots.find(
            (entry: z.infer<typeof snapshot>) =>
              entry.attempt.id === old.attempt.id,
          )!;
          expect(current.attempt).toMatchObject({
            start: old.attempt.start,
            deadline: old.attempt.deadline,
            original_deadline: old.attempt.original_deadline,
            transport: old.attempt.transport,
            grant: old.attempt.grant,
            generation: old.attempt.generation + 1,
            access_state: "HELD",
          });
          expect(current.supervisor).toMatchObject({
            pid: old.supervisor!.pid,
            attached_panes: 4,
          });
        }
        // Exercise browser epoch agreement and every original shell's memory,
        // rather than treating native ACTIVE metadata as proof of usable input.
        for (const entry of fleet) {
          // Native ACTIVE precedes the browser's verified epoch handoff. Wait
          // for the actual student input barrier, never click Resume to bypass it.
          await expect(entry.page.locator(".lock-overlay")).toHaveCount(0, {
            timeout: OPERATION_TIMEOUT_MS,
          });
          await readyTerminal(entry.page, 4, 0);
          for (let pane = 0; pane < 4; pane++) {
            await command(
              entry,
              pane,
              `printf 'RECOVERED-%s-END\\n' "$capacity_buffer"`,
              `RECOVERED-${entry.username}-${pane}-END`,
            );
          }
        }
        const usable = await inspect();
        for (const old of before.snapshots) {
          const current: z.infer<typeof snapshot> = usable.snapshots.find(
            (entry: z.infer<typeof snapshot>) =>
              entry.attempt.id === old.attempt.id,
          )!;
          expect(current.attempt).toMatchObject({
            state: "ACTIVE",
            generation: old.attempt.generation,
            deadline: old.attempt.deadline,
            original_deadline: old.attempt.original_deadline,
          });
          expect(
            current.kernel.every(
              (unit) => unit.frozen === "0" && unit.populated === "1",
            ),
          ).toBe(true);
        }
        recovering = false;
      }
      if (large) {
        for (const entry of fleet.slice(0, 2)) {
          expect(
            before.snapshots.find(
              (value: z.infer<typeof snapshot>) =>
                value.attempt.id === entry.id,
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
      if (stressRun) {
        const seconds = Number(process.env.EXAM_STRESS_SECONDS || "5400");
        if (
          ![30, 5400].includes(seconds) &&
          !(seconds === 600 && metadata.coLocation === true)
        )
          throw Error(
            "Use the30s rehearsal,90-minute endurance, or explicit ten-minute co-location qualification",
          );
        const started = performance.now();
        expect(
          Math.min(
            ...before.snapshots.map(
              (entry: z.infer<typeof snapshot>) => entry.attempt.deadline,
            ),
          ) - Date.now(),
        ).toBeGreaterThan(seconds * 1000 + 120000);
        const samples: unknown[] = [];
        const output = test.info().outputPath("endurance-progress.json");
        await mkdir(test.info().outputDir, { recursive: true });
        console.log(
          JSON.stringify({
            phase: "peak-start",
            students: fleet.length,
            terminals: fleet.length * 4,
            seconds,
          }),
        );
        while (performance.now() - started < seconds * 1000) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(30000, seconds * 1000 - (performance.now() - started)),
            ),
          );
          const generatorAvailable = await generatorHeadroom();
          const current = await inspect();
          for (let i = 0; i < fleet.length; i++) {
            const entry: z.infer<typeof snapshot> = current.snapshots.find(
              (value: z.infer<typeof snapshot>) =>
                value.attempt.id === fleet[i].id,
            )!;
            const old = before.snapshots.find(
              (value: z.infer<typeof snapshot>) =>
                value.attempt.id === fleet[i].id,
            )!;
            expect(entry.attempt).toMatchObject({
              state: "ACTIVE",
              generation: 0,
              start: old.attempt.start,
              deadline: old.attempt.deadline,
              original_deadline: old.attempt.original_deadline,
            });
            expect(entry.supervisor).toMatchObject({
              pid: old.supervisor!.pid,
              ssh_peer: "pinned-live",
              attached_panes: 4,
            });
            expect(entry.kernel).toHaveLength(4);
            expect(
              entry.kernel.every(
                (unit) => unit.populated === "1" && unit.frozen === "0",
              ),
            ).toBe(true);
          }
          expect(fleet.flatMap((entry) => entry.unexpectedLocks)).toEqual([]);
          expect(lateNavigations).toEqual([]);
          const sample = {
            elapsed_seconds: (performance.now() - started) / 1000,
            students: fleet.length,
            terminals: fleet.length * 4,
            guest_resources: current.resources,
            generator_available_bytes: generatorAvailable,
            test_runner_rss: process.memoryUsage().rss,
            timing: fleet.map((entry) => ({
              username: entry.username,
              ...entry.timing,
            })),
          };
          samples.push(sample);
          await writeFile(output, JSON.stringify({ run: stressRun, samples }), {
            mode: 0o600,
          });
          console.log(
            JSON.stringify({
              phase: "peak-progress",
              elapsed_seconds: sample.elapsed_seconds,
              students: fleet.length,
            }),
          );
        }
        const peakSeconds = (performance.now() - started) / 1000;
        for (const entry of fleet) {
          await command(entry, 1, "print 2 + 2", "$1 = 4");
          await command(
            entry,
            3,
            `printf 'ENDURANCE-%s-END\\n' "$capacity_buffer"`,
            `ENDURANCE-${entry.username}-3-END`,
          );
        }
        const submissionStarted = performance.now();
        await Promise.all(fleet.map(finish));
        await expect
          .poll(
            async () => {
              const response = await request.get("/api/admin/attempts", {
                params: { q: "examq" },
              });
              return (await response.json()).attempts.filter(
                (entry: any) =>
                  fleet.some((owned) => owned.id === entry.id) &&
                  entry.state === "COMPLETED" &&
                  entry.protected,
              ).length;
            },
            { timeout: 120000 },
          )
          .toBe(fleetCount);
        const completed = await inspect(true);
        expect(completed.preservation).toBe("FULL");
        expect(Object.keys(completed.verified).length).toBe(fleetCount);
        expect(
          completed.snapshots.every(
            (entry: z.infer<typeof snapshot>) =>
              entry.attempt.protected &&
              entry.attempt.access_state === "HELD" &&
              entry.attempt.checksum.length > 0,
          ),
        ).toBe(true);
        expect(fleet.flatMap((entry) => entry.unexpectedLocks)).toEqual([]);
        await writeFile(
          test.info().outputPath("endurance-result.json"),
          JSON.stringify(
            {
              run: stressRun,
              students: fleet.length,
              terminals: fleet.length * 4,
              requested_seconds: seconds,
              peak_seconds: peakSeconds,
              measured_seconds: (performance.now() - started) / 1000,
              submission_seconds:
                (performance.now() - submissionStarted) / 1000,
              preservation: completed.preservation,
              protected: completed.snapshots.length,
              simulated_media: true,
              institutional_mfa: false,
              prepared_welcome_pages: prepared.length,
              late_navigations: lateNavigations,
              transport_failures: transportFailures,
              pane_refusals: paneRefusals,
              input_gates: await Promise.all(
                fleet.map(async (entry) => ({
                  username: entry.username,
                  evidence: await entry.page.evaluate(
                    () => (window as any).__stressInputGates,
                  ),
                })),
              ),
              timing: fleet.map((entry) => ({
                username: entry.username,
                ...entry.timing,
              })),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        expect(
          paneRefusals,
          "Recovered pane refusals remain clean-run failures",
        ).toEqual([]);
        return;
      }
      await Promise.all(fleet.slice(0, 2).map(finish));
      if (large) {
        const workerFailurePrefix =
          "collection worker exited or exceeded its resource/time bound:";
        const collectionBefore = snapshot.parse(before.snapshots[0]).attempt;
        expect(
          collectionBefore.errors.some((error) =>
            error.startsWith(workerFailurePrefix),
          ),
        ).toBe(false);
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
        const killedWorkers = z.array(worker).length(2).parse(killed.workers);
        expect(killedWorkers.every((entry) => entry.writing)).toBe(true);
        const target = killedWorkers.find(
          (entry) => entry.attempt === fleet[0].id,
        )!;
        expect(killed.death).toMatchObject({
          unit: target.unit,
          pid: target.pid,
          exit_code: "killed",
          exit_status: "9",
        });
        await expect
          .poll(
            async () => {
              const status = await request.get("/api/fixture/native-state", {
                params: { attempt: fleet[0].id },
              });
              const value = snapshot.parse(await status.json());
              expect(value.attempt).toMatchObject({
                start: collectionBefore.start,
                deadline: collectionBefore.deadline,
              });
              expect([
                "COLLECTION_FAILED",
                "FINALIZING",
                "COMPLETED",
              ]).toContain(value.attempt.state);
              if (value.attempt.state === "COMPLETED")
                expect(value.attempt.protected).toBe(true);
              else expect(value.attempt.access_state).toBe("HELD");
              // The parent durably records the killed worker's error together
              // with COLLECTION_FAILED. Tick may advance that transient state
              // before a browser poll; the error survives automatic retry.
              return value.attempt.errors.some((error) =>
                error.startsWith(workerFailurePrefix),
              );
            },
            { timeout: 15000 },
          )
          .toBe(true);
        expect(["pending", "complete"]).toContain(
          (await collection("retry-verify")).status,
        );
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
      if (setupPage)
        await setupPage
          .screenshot({
            path: test.info().outputPath("setup-page.png"),
            timeout: 5000,
          })
          .catch(() => {});
      const failedEntry = fleet.find(
        (entry) => entry.username === lastCommand?.student,
      );
      if (failedEntry)
        await failedEntry.page
          .screenshot({
            path: test.info().outputPath("last-command-page.png"),
            timeout: 5000,
          })
          .catch(() => {});
      const publicStates = await Promise.all(
        fleet.map(async (entry) => {
          const browser = await entry.page
            .evaluate(() => ({
              focused: document.hasFocus(),
              visible: document.visibilityState,
              fullscreen: !!document.fullscreenElement,
              activeTag: document.activeElement?.tagName,
              activeLabel: document.activeElement?.getAttribute("aria-label"),
              activeWindow: document.activeElement?.closest(".winbox")?.id,
              toolbarInert:
                document.querySelector<HTMLElement>(".exam-toolbar")?.inert,
              inputGates: (window as any).__stressInputGates,
              menuHit: (() => {
                const button = document.querySelector<HTMLButtonElement>(
                  ".terminal-switcher button",
                );
                if (!button) return null;
                const r = button.getBoundingClientRect();
                return {
                  rect: r.toJSON(),
                  inertAncestor: button.closest("[inert]")?.className,
                  hits: document
                    .elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                    .slice(0, 6)
                    .map((element) => ({
                      tag: element.tagName,
                      className: element.className,
                    })),
                };
              })(),
              feedback: [
                ...document.querySelectorAll<HTMLElement>('[role="status"]'),
              ]
                .filter((element) => element.getClientRects().length)
                .map((element) => element.innerText.slice(0, 400)),
              overlays: [
                ...document.querySelectorAll<HTMLElement>(".lock-overlay"),
              ].map((element) => element.innerText.slice(0, 1600)),
              panes: [
                ...document.querySelectorAll<HTMLElement>(".terminal"),
              ].map((element) => ({
                busy: element.getAttribute("aria-busy"),
                inert: !!element.closest("[inert]"),
                window: element.closest(".winbox")?.id,
                inputDisabled: element.querySelector<HTMLTextAreaElement>(
                  ".xterm-helper-textarea",
                )?.disabled,
                outputTail: element
                  .querySelector(".xterm-rows")
                  ?.textContent?.slice(-1200),
              })),
            }))
            .catch(() => ({ unavailable: true }));
          try {
            const response = await entry.page.request.get("/api/student/exam", {
              timeout: 3000,
            });
            const value = (await response.json()).attempt;
            return {
              username: entry.username,
              state: value?.state,
              generation: value?.generation,
              browser,
            };
          } catch {
            return { username: entry.username, unavailable: true, browser };
          }
        }),
      );
      await writeFile(
        failure,
        JSON.stringify({
          error: String(error).slice(0, 1200),
          signInEvents,
          setupDiagnostics: { username: setupStudent, requests: setupNetwork },
          lastCommand,
          lateNavigations,
          transportFailures,
          paneRefusals,
          wasmBootstrap: await bootstrap(),
          publicStates,
          recoveryReplies: fleet.map((entry) => ({
            username: entry.username,
            replies: entry.recoveryReplies,
          })),
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
          await writeFile(path, JSON.stringify(await inspect()), {
            mode: 0o600,
          });
          await test.info().attach("native-fleet-failure", {
            path,
            contentType: "application/json",
          });
        } catch {}
      }
      throw error;
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
);
