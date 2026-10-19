// Keep each paste below the server's input-message limit without splitting
// UTF-16 surrogate pairs (each JSON message is decoded independently).
export function* terminalInputChunks(data: string): Generator<string> {
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + 16000, data.length);
    if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
    yield data.slice(start, end);
    start = end;
  }
}
