import { test, expect } from "@playwright/test";
import type { ExamExecutionPolicy } from "../../packages/protocol/exam-execution-policy.js";
import { begin, fixture, readyTerminal } from "./transition-fixture.js";

test("live terminal limits update without replacing open panes, saved settings or the running clock", async ({
  page,
}) => {
  page.setDefaultTimeout(6000);
  const f = await fixture(page);
  const savedSettings = f.model.attempt.settings;
  let policy: ExamExecutionPolicy = {
    schema: 1,
    agent: "class",
    exam: "sandbox",
    instance: "a".repeat(32),
    revision: 1,
    terminals: 1,
    collection_file_mib: 128,
    collection_total_mib: 512,
  };
  f.model.preflight = async (route) => {
    f.model.state = "PREPARING";
    await route.fulfill({
      json: { ...f.reservation(), executionPolicy: policy },
    });
  };
  f.model.status = (route) =>
    route.fulfill({ json: { ...f.snapshot(), executionPolicy: policy } });
  f.model.onBind = async (socket, binding) => {
    await f.model.bind.promise;
    socket.send(
      JSON.stringify({
        type: "state",
        binding,
        ...f.snapshot(),
        executionPolicy: policy,
      }),
    );
  };
  await begin(page, f);
  const first = await readyTerminal(page, 1);
  const firstId = await first.getAttribute("id"),
    deadline = f.model.attempt.deadline;
  const button = page.getByRole("button", {
    name: "New terminal",
    exact: true,
  });
  await expect(button).toBeDisabled();
  // Output and input are observable pane state, rather than merely counting windows.
  const pane = f.model.messages.find((m) => m.type === "open").pane;
  f.model.socket!.send(
    JSON.stringify({
      type: "output",
      pane,
      data: Buffer.from("UNSAVED EDITOR BUFFER").toString("base64"),
    }),
  );
  await expect(first.locator(".xterm-rows")).toContainText(
    "UNSAVED EDITOR BUFFER",
  );
  const publish = (value: unknown) =>
    f.model.socket!.send(
      JSON.stringify({
        type: "state",
        ...f.snapshot(),
        executionPolicy: value,
      }),
    );

  policy = { ...policy, revision: 2, terminals: 3 };
  publish(policy);
  await expect(button).toBeEnabled();
  await button.click();
  await readyTerminal(page, 2);
  await expect(button).toBeEnabled();
  const ids = await page
    .locator(".winbox")
    .evaluateAll((els) => els.map((e) => e.id));

  policy = { ...policy, revision: 3, terminals: 1 };
  publish(policy);
  await expect(button).toBeDisabled();
  await expect(first).toHaveAttribute("id", firstId!);
  await expect(first.locator(".xterm-rows")).toContainText(
    "UNSAVED EDITOR BUFFER",
  );
  expect(
    await page.locator(".winbox").evaluateAll((els) => els.map((e) => e.id)),
  ).toEqual(ids);
  await page
    .getByRole("button", { name: "Arrange terminals", exact: true })
    .click();
  await readyTerminal(page, 2, 0);
  await page.keyboard.type("still-editing");
  await expect
    .poll(() =>
      f.model.messages
        .filter((m) => m.type === "input" && m.pane === pane)
        .map((m) => m.data)
        .join(""),
    )
    .toContain("still-editing");

  // Delayed, malformed and differently scoped projections cannot raise the limit.
  for (const value of [
    { ...policy, revision: 2, terminals: 4 },
    { ...policy, revision: 4, terminals: 4, exam: "another-exam" },
    { ...policy, revision: 4, terminals: 4, agent: "another-agent" },
    { ...policy, revision: 4, terminals: 4, instance: "b".repeat(32) },
    { ...policy, revision: 4, terminals: 4, unexpected: true },
    null,
  ])
    publish(value);
  f.model.socket!.send(
    JSON.stringify({
      type: "output",
      pane,
      data: Buffer.from("SCOPE CHECKS PROCESSED").toString("base64"),
    }),
  );
  await expect(first.locator(".xterm-rows")).toContainText(
    "SCOPE CHECKS PROCESSED",
  );
  await expect(button).toBeDisabled();
  // A newer authenticated HTTP projection uses an independent policy revision,
  // even if the attempt itself has not otherwise changed.
  policy = { ...policy, revision: 5, terminals: 4 };
  await expect(button).toBeEnabled({ timeout: 10000 });
  expect(f.model.attempt.settings).toBe(savedSettings);
  expect(f.model.attempt.deadline).toBe(deadline);
  expect(f.model.attempt.generation).toBe(0);
  expect(f.model.finishCalls).toBe(0);
  await expect(page.locator(".winbox")).toHaveCount(2);
});
