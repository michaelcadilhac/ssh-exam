// Deliberate faults exist only in this test entry, never the production worker.
import "../../apps/server/src/connection-worker.js";
process.on("message", (m: any) => {
  if (m.kind !== "fixture-fault") return;
  if (m.fault === "exception")
    setTimeout(() => {
      throw Error("synthetic-private-secret: terminal contents");
    }, 5);
  if (m.fault === "rejection")
    void Promise.reject(Error("synthetic-private-secret: password"));
  if (m.fault === "heap") {
    const allocations: object[][] = [];
    while (true)
      allocations.push(
        Array.from({ length: 10000 }, () => ({ value: Math.random() })),
      );
  }
  if (m.fault === "hang")
    while (true) {
      /* Test watchdog against a blocked event loop. */
    }
});
