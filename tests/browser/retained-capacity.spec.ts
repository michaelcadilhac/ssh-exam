import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import { simulatedMedia, ready } from "./transition-fixture.js";

const origin = "https://127.0.0.1:9444";
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
  test.setTimeout(480000);
  const metadata = await (
    await request.get("/api/fixture/native-ready")
  ).json();
  expect(metadata.privateGuest).toBe(true);
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
  const fleet: {
    context: BrowserContext;
    page: Page;
    id: string;
    username: string;
    opened: Set<string>;
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
  const command = async (
    entry: (typeof fleet)[number],
    pane: number,
    text: string,
    marker: string,
  ) => {
    const input = entry.page.locator(".xterm-helper-textarea").nth(pane);
    await input.focus();
    await expect(input).toBeFocused();
    await entry.page.keyboard.type(text, { delay: 25 });
    await entry.page.keyboard.press("Enter");
    await expect(entry.page.locator(".xterm-rows").nth(pane)).toContainText(
      marker,
      { timeout: 10000 },
    );
    await expect(
      entry.page.getByText(/Recent terminal input was not sent/),
    ).toHaveCount(0);
  };
  try {
    for (const student of students) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true }),
        page = await context.newPage(),
        opened = new Set<string>();
      page.setDefaultTimeout(10000);
      await simulatedMedia(page);
      page.on("websocket", (socket) => {
        if (new URL(socket.url()).pathname !== "/api/student/session") return;
        socket.on("framereceived", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            if (message.type === "opened" && message.input?.protocol === "v1")
              opened.add(message.pane);
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
    }
    const before = await inspect();
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
      });
      if (!fleet.slice(0, 2).some((entry) => entry.id === old.attempt.id))
        expect(current.supervisor).toMatchObject({
          pid: old.supervisor!.pid,
          ssh_peer: "pinned-live",
          attached_panes: 4,
        });
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
    if (fleet.length === 16) {
      try {
        await test
          .info()
          .attach("native-fleet-failure", {
            body: Buffer.from(JSON.stringify(await inspect())),
            contentType: "application/json",
          });
      } catch {}
    }
    throw error;
  } finally {
    await Promise.all(fleet.map((entry) => entry.context.close()));
  }
});
