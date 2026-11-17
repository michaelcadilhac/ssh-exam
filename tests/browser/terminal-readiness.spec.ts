import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { recoverRefusedStressPane } from "../fixtures/stress-navigation.js";
import {
  fixture,
  begin,
  gate,
  readyTerminal,
  selectVerifiedTerminal,
} from "./transition-fixture.js";

test("manual stress records a refused pane and exercises one ordinary public retry", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  await readyTerminal(page, 1, 0);
  let refused = false,
    recorded = false;
  f.model.onOpen = async (socket, message) => {
    if (!refused) {
      refused = true;
      socket.send(
        JSON.stringify({
          type: "error",
          pane: message.pane,
          error:
            "This terminal could not open. Try again. If it still fails, contact your instructor.",
        }),
      );
    } else {
      expect(recorded).toBe(true);
      socket.send(JSON.stringify({ type: "opened", pane: message.pane }));
    }
  };
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Terminal error", exact: true }),
  ).toBeVisible();
  await recoverRefusedStressPane({
    // This UI fixture intercepts browser fetch, not Playwright APIRequestContext.
    // Read the same public projection through that declared fixture transport.
    page: {
      getByRole: page.getByRole.bind(page),
      request: {
        get: async () => {
          const value = await page.evaluate(async () => {
            const response = await fetch("/api/student/exam");
            return { ok: response.ok, data: await response.json() };
          });
          return { ok: () => value.ok, json: async () => value.data };
        },
      },
    },
    attempt: f.model.attempt.id,
    opened: () => 1,
    expected: 2,
    record: async () => {
      recorded = true;
    },
  });
  await readyTerminal(page, 2, 1);
  expect(
    f.model.messages.filter((message) => message.type === "open"),
  ).toHaveLength(3);
  expect(
    f.model.messages.filter((message) => message.type === "incident"),
  ).toEqual([]);
});

for (const framed of [false, true]) {
  test(`${framed ? "framed" : "legacy"} terminal blocks early keys and preserves the first key after its actual open acknowledgement`, async ({
    page,
  }) => {
    test.setTimeout(30000);
    const f = await fixture(page),
      reply = gate();
    let requested = false;
    const epoch = "a".repeat(64);
    f.model.onOpen = async (socket, message) => {
      requested = true;
      await reply.promise;
      socket.send(
        JSON.stringify({
          type: "opened",
          pane: message.pane,
          ...(framed ? { input: { protocol: "v1", epoch } } : {}),
        }),
      );
    };
    const inputs = () =>
      f.model.messages.filter((message) => message.type === "input");
    try {
      await begin(page, f);
      await expect.poll(() => requested).toBe(true);
      const input = page.locator(".xterm-helper-textarea");
      await expect(input).toHaveCount(1);
      await expect(input).toBeDisabled();
      await expect(
        page.getByRole("status").filter({ hasText: "Opening terminal" }),
      ).toBeVisible();
      await input.focus();
      await page.keyboard.type("early");
      expect(inputs()).toEqual([]);
      reply.release();
      await expect(input).toBeEnabled();
      await expect(page.locator('.terminal[aria-busy="false"]')).toHaveCount(1);
      await page.locator(".xterm-screen").click();
      await expect(input).toBeFocused();
      await page.keyboard.type("printf", { delay: 20 });
      await expect
        .poll(() =>
          inputs()
            .map((message) => message.data)
            .join(""),
        )
        .toBe("printf");
      expect(inputs()[0].data).toBe("p");
      if (framed) {
        expect(
          inputs().every((message) => message.input?.epoch === epoch),
        ).toBe(true);
        expect(inputs().every((message) => message.input.sequence > 0)).toBe(
          true,
        );
      }
    } finally {
      reply.release();
    }
  });
}

for (const input of [
  { protocol: "v2", epoch: "a".repeat(64) },
  { protocol: "v1", epoch: "invalid" },
]) {
  test(`terminal refuses an unsupported open agreement (${input.protocol}/${input.epoch.length})`, async ({
    page,
  }) => {
    const f = await fixture(page);
    let pane = "";
    f.model.onOpen = async (socket, message) => {
      pane = message.pane;
      socket.send(JSON.stringify({ type: "opened", pane, input }));
    };
    await begin(page, f);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Terminal input unavailable" }),
    ).toBeVisible();
    const textarea = page.locator(".xterm-helper-textarea");
    await expect(textarea).toBeDisabled();
    await textarea.focus();
    await page.keyboard.type("must-not-send");
    expect(f.model.messages.filter((m) => m.type === "input")).toEqual([]);
    // A later valid acknowledgement can enable the pane; rejected early keys
    // must never be replayed into the new input context.
    f.model.socket!.send(
      JSON.stringify({
        type: "opened",
        pane,
        input: { protocol: "v1", epoch: "b".repeat(64) },
      }),
    );
    await expect(textarea).toBeEnabled();
    expect(f.model.messages.filter((m) => m.type === "input")).toEqual([]);
  });
}

test("Enter while a new terminal is opening cannot activate New terminal again", async ({
  page,
}, info) => {
  const f = await fixture(page),
    reply = gate();
  const opened: string[] = [];
  f.model.onOpen = async (socket, message) => {
    opened.push(message.pane);
    await reply.promise;
    socket.send(JSON.stringify({ type: "opened", pane: message.pane }));
  };
  try {
    await begin(page, f);
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect(page.locator(".winbox")).toHaveCount(2);
    await expect.poll(() => opened.length).toBe(2);
    const input = page
      .locator(".winbox")
      .last()
      .locator(".xterm-helper-textarea");
    await expect(input).toBeDisabled();
    await input.focus();
    const focusReceipt = JSON.stringify(
      await page.evaluate(() => ({
        focusedTag: document.activeElement?.tagName,
        focusedText: document.activeElement?.textContent?.slice(0, 120),
        panes: [...document.querySelectorAll(".winbox")].map((box) => ({
          id: box.id,
          busy: box.querySelector(".terminal")?.getAttribute("aria-busy"),
          inputDisabled: box.querySelector<HTMLTextAreaElement>(
            ".xterm-helper-textarea",
          )?.disabled,
          terminalInert: (box.querySelector(".terminal") as HTMLElement)?.inert,
        })),
      })),
    );
    await writeFile(info.outputPath("opening-focus.json"), focusReceipt + "\n");
    await page.keyboard.type("early");
    await page.keyboard.press("Enter");
    await expect(page.locator(".winbox")).toHaveCount(2);
    expect(f.model.messages.filter((m) => m.type === "input")).toEqual([]);
    reply.release();
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await page.keyboard.type("p");
    const inputs = () => f.model.messages.filter((m) => m.type === "input");
    await expect
      .poll(() =>
        inputs()
          .map((m) => m.data)
          .join(""),
      )
      .toBe("p");
    expect(inputs().every((m) => m.pane === opened[1])).toBe(true);
    await expect(page.locator(".winbox")).toHaveCount(2);
  } finally {
    reply.release();
  }
});

test("terminal selection reaches an earlier pane while another window covers it", async ({
  page,
}, info) => {
  const f = await fixture(page);
  await begin(page, f);
  await readyTerminal(page, 1);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator('.terminal[aria-busy="false"]')).toHaveCount(2);
  const ids = await page
    .locator(".winbox")
    .evaluateAll((elements) => elements.map((element) => element.id));
  const coveredBy = await page
    .locator(`.winbox[id="${ids[0]}"] .xterm-screen`)
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return document
        .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        ?.closest(".winbox")?.id;
    });
  expect(coveredBy).toBe(ids[1]);
  await page.screenshot({ path: info.outputPath("overlapping-terminals.png") });
  const opened = f.model.messages.filter((message) => message.type === "open");
  expect(opened).toHaveLength(2);
  for (const [index, text] of [
    [0, "first-only"],
    [1, "second-only"],
    [0, "first-again"],
  ] as const) {
    const before = f.model.messages.filter(
      (message) => message.type === "input",
    ).length;
    await selectVerifiedTerminal(
      page,
      page.locator(`.winbox[id="${ids[index]}"]`),
    );
    await page.keyboard.type(text);
    await expect
      .poll(() =>
        f.model.messages
          .filter((message) => message.type === "input")
          .slice(before)
          .map((message) => message.data)
          .join(""),
      )
      .toBe(text);
    expect(
      f.model.messages
        .filter((message) => message.type === "input")
        .slice(before)
        .every((message) => message.pane === opened[index].pane),
    ).toBe(true);
  }
  await page.screenshot({
    path: info.outputPath("selected-earlier-terminal.png"),
  });
  await expect(page.locator(".winbox")).toHaveCount(2);
});

test("terminal menu remains clickable across arranged fullscreen workspaces", async ({
  browser,
}, info) => {
  test.setTimeout(90000);
  const contexts = [];
  try {
    for (let student = 0; student < 8; student++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const f = await fixture(page);
      await begin(page, f);
      for (let pane = 1; pane < 4; pane++) {
        await page
          .getByRole("button", { name: "New terminal", exact: true })
          .click();
        await expect(page.locator('.terminal[aria-busy="false"]')).toHaveCount(
          pane + 1,
        );
      }
      await page
        .getByRole("button", { name: "Arrange terminals", exact: true })
        .click();
      const opened = f.model.messages.filter(
        (message) => message.type === "open",
      );
      for (const pane of [0, 0, 1, 2, 3, 0]) {
        const before = f.model.messages.filter(
          (message) => message.type === "input",
        ).length;
        try {
          await selectVerifiedTerminal(page, page.locator(".winbox").nth(pane));
        } catch (error) {
          await page.screenshot({
            path: info.outputPath(`student-${student}-menu.png`),
          });
          const menu = page
            .getByLabel("Open terminals")
            .getByRole("button")
            .first();
          const hit = await menu.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return {
              rect: r.toJSON(),
              fullscreen: document.fullscreenElement?.className,
              hits: document
                .elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                .map((e) => ({
                  tag: e.tagName,
                  className: e.className,
                  inert: (e as HTMLElement).inert,
                  pointerEvents: getComputedStyle(e).pointerEvents,
                })),
              ancestors: [
                element,
                ...(function* () {
                  for (let p = element.parentElement; p; p = p.parentElement)
                    yield p;
                })(),
              ].map((e) => ({
                tag: e.tagName,
                className: e.className,
                inert: (e as HTMLElement).inert,
                zIndex: getComputedStyle(e).zIndex,
                pointerEvents: getComputedStyle(e).pointerEvents,
              })),
            };
          });
          await writeFile(
            info.outputPath(`student-${student}-hit.json`),
            JSON.stringify(hit, null, 2),
          );
          throw error;
        }
        const marker = `student-${student}-pane-${pane}`;
        await page.keyboard.type(marker);
        await expect
          .poll(() =>
            f.model.messages
              .filter((message) => message.type === "input")
              .slice(before)
              .map((message) => message.data)
              .join(""),
          )
          .toBe(marker);
        expect(
          f.model.messages
            .filter((message) => message.type === "input")
            .slice(before)
            .every((message) => message.pane === opened[pane].pane),
        ).toBe(true);
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("terminal selection waits for verified capture recovery without bypassing inert controls", async ({
  page,
}, info) => {
  test.setTimeout(30000);
  const f = await fixture(page);
  const recovered = gate();
  try {
    await begin(page, f);
    for (let pane = 1; pane < 4; pane++) {
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .click();
      await expect(page.locator('.terminal[aria-busy="false"]')).toHaveCount(
        pane + 1,
      );
    }
    await page
      .getByRole("button", { name: "Arrange terminals", exact: true })
      .click();
    Object.assign(f.model.attempt, { monitoring_mode: "v1" });
    f.send();
    let rejected = false;
    await page.route("**/capture-challenges", async (route) => {
      if (!rejected) {
        rejected = true;
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic capture verification unavailable" },
        });
      }
      await recovered.promise;
      return route.fulfill({
        json: {
          challenge: "synthetic-recovered",
          after_sequence: 0,
          valid_for_ms: 15000,
        },
      });
    });
    await expect(
      page.getByText("Monitoring check delayed · input paused", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".exam-toolbar")).toHaveAttribute("inert", "");
    const inputCount = f.model.messages.filter(
      (message) => message.type === "input",
    ).length;
    const selection = selectVerifiedTerminal(
      page,
      page.locator(".winbox").first(),
    ).then(
      () => null,
      (error) => error as Error,
    );
    await page.keyboard.type("must-not-send");
    await page.waitForTimeout(6000);
    expect(
      f.model.messages.filter((message) => message.type === "input"),
    ).toHaveLength(inputCount);
    await page.screenshot({
      path: info.outputPath("capture-gate-blocked.png"),
    });
    recovered.release();
    const error = await selection;
    expect(error?.message).toBeUndefined();
    await expect(page.locator(".exam-toolbar")).not.toHaveAttribute(
      "inert",
      "",
    );
    await page.keyboard.type("verified-recovered-input");
    await expect
      .poll(() =>
        f.model.messages
          .filter((message) => message.type === "input")
          .slice(inputCount)
          .map((message) => message.data)
          .join(""),
      )
      .toBe("verified-recovered-input");
    expect(
      f.model.messages.filter((message) => message.type === "incident"),
    ).toEqual([]);
    expect(f.model.attempt.state).toBe("ACTIVE");
  } finally {
    recovered.release();
  }
});
