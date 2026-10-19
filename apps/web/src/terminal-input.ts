// Keep each paste below the server's input-message limit without splitting
// UTF-16 surrogate pairs (each JSON message is decoded independently).
// 8,000 code units also stay below the WASM SSH worker’s 32 KiB UTF-8 cap.
export function* terminalInputChunks(data: string): Generator<string> {
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + 8000, data.length);
    if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
    yield data.slice(start, end);
    start = end;
  }
}
