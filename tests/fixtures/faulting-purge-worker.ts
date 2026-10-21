// Faults are only in this disposable test entry, never production worker code.
process.stdin.once("data", (chunk) => {
  const r = JSON.parse(chunk.toString());
  switch (r.id) {
    case "panic":
      throw Error("PRIVATE-PURGE-EXCEPTION");
    case "hang":
      while (true) {
        /* Verify external supervisor timeout. */
      }
    case "heap": {
      const allocations: object[][] = [];
      while (true)
        allocations.push(
          Array.from({ length: 10000 }, () => ({ value: Math.random() })),
        );
    }
    case "kill":
      process.kill(process.pid, "SIGKILL");
      break;
    case "overflow":
      process.stdout.write("PRIVATE".repeat(4000));
      break;
    case "wrong":
      process.stdout.write(
        JSON.stringify({
          ...r,
          nonce: "0".repeat(64),
          status: "removed",
          removed: 1,
        }),
      );
      process.exitCode = 0;
      break;
    case "extra":
      process.stdout.write(
        JSON.stringify({
          version: 1,
          id: r.id,
          nonce: r.nonce,
          status: "removed",
          removed: 1,
          private: "PRIVATE-EXTRA-FIELD",
        }),
      );
      process.exitCode = 0;
      break;
    case "forged":
      process.stdout.write(
        JSON.stringify({
          version: 1,
          id: r.id,
          nonce: r.nonce,
          status: "removed",
          removed: 1,
        }),
      );
      process.exitCode = 0;
      break;
    case "exit-after-reply":
      process.stdout.write(
        JSON.stringify({ ...r, status: "removed", removed: 1 }),
      );
      process.exitCode = 1;
      break;
  }
  process.stdin.destroy();
});
