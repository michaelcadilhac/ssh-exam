import { expect, it } from "vitest";
import { grantStatus } from "../../apps/web/src/grant-options.js";

const pending = {
  revision: 1,
  status: "PENDING_NATIVE",
  settings: { earliest: 50, latest: 200 },
  claims: [],
};

it("distinguishes new saved-work setup from confirmation of revised attempt settings", () => {
  expect(grantStatus(pending, 100)).toBe("Preparing saved work");
  for (const revision of [2, 3, 100])
    expect(grantStatus({ ...pending, revision }, 100)).toBe("Updating attempt");
});

it("never displays Ready based on worker completion without confirmed grant availability", () => {
  expect(
    grantStatus({ ...pending, revision: 2, setup: { status: "READY" } }, 100),
  ).toBe("Updating attempt");
  expect(
    grantStatus({ ...pending, revision: 2, status: "AVAILABLE" }, 100),
  ).toBe("Ready");
});

it("keeps claims, closed windows and final states ahead of pending update labels", () => {
  const revised = { ...pending, revision: 2 };
  expect(
    grantStatus({ ...revised, claims: [{ state: "PREPARING" }] }, 100),
  ).toBe("Setup in progress");
  expect(grantStatus(revised, 201)).toBe("Start window closed");
  expect(grantStatus({ ...revised, status: "REVOKED" }, 100)).toBe("Cancelled");
  expect(grantStatus({ ...revised, status: "CONSUMED" }, 100)).toBe("Started");
});
