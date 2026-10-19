import { expect, it } from "vitest";
import { terminalInputChunks } from "../../apps/web/src/terminal-input.js";
it("chunks large clipboard pastes without changing text or splitting emoji", () => {
  const text = "x".repeat(15999) + "🌍" + "λ".repeat(75000);
  const chunks = [...terminalInputChunks(text)];
  expect(chunks.join("")).toBe(text);
  expect(
    chunks.every(
      (chunk) => chunk.length <= 16000 && !/[\uD800-\uDBFF]$/.test(chunk),
    ),
  ).toBe(true);
  expect([...terminalInputChunks("")]).toEqual([]);
});
