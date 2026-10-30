import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { fixture, begin, gate } from "./transition-fixture.js";

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
