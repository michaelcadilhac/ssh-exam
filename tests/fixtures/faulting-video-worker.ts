// Disposable fault entry only. Production workers have no fault controls.
process.stdin.once("data", (chunk) => {
  const request = JSON.parse(chunk.toString());
  switch (request.input.attempt) {
    case "kill":
      process.kill(process.pid, "SIGKILL");
      break;
    case "hang":
      setInterval(() => {}, 1000);
      break;
    case "panic":
      throw Error("PRIVATE-VIDEO-FAILURE");
    case "overflow":
      process.stdout.write("PRIVATE".repeat(400000));
      process.stdin.destroy();
      break;
    case "forged": {
      const input = request.input;
      process.stdout.write(
        JSON.stringify({
          version: 1,
          nonce: request.nonce,
          status: "complete",
          result: {
            version: 1,
            attempt: input.attempt,
            segment: input.segment,
            source: input.source,
            file: input.segment + ".webm",
            sha256: "0".repeat(64),
            bytes: 1,
            width: 320,
            height: 240,
            duration_ms: input.frames.length * 5000,
            frames: input.frames.map((frame: any, index: number) => ({
              id: frame.id,
              original_hash: frame.hash,
              captured: frame.captured,
              index,
              presentation_ms: index * 5000,
              decoded_sha256: "0".repeat(64),
            })),
          },
        }),
      );
      process.stdin.destroy();
      break;
    }
  }
});
