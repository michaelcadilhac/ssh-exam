// Codec work has no access to browser input authority, network or credentials.
type EncoderState = {
  encoder: VideoEncoder;
  chain: string;
  previous: string | null;
  count: number;
  width: number;
  height: number;
};
const encoders = new Map<string, EncoderState>();
const busy = new Set<string>();
function reset(source: string) {
  const value = encoders.get(source);
  encoders.delete(source);
  if (value && value.encoder.state !== "closed") value.encoder.close();
}
globalThis.onmessage = (event: MessageEvent) => {
  const m = event.data;
  if (m.type === "reset") {
    reset(m.source);
    return;
  }
  if (m.type !== "encode" || !["screen", "webcam"].includes(m.source)) return;
  if (busy.has(m.source)) {
    m.bitmap?.close();
    globalThis.postMessage({ id: m.id, error: true });
    return;
  }
  busy.add(m.source);
  void (async () => {
    const bitmap = m.bitmap as ImageBitmap;
    let frame: VideoFrame | undefined;
    try {
      let state = encoders.get(m.source);
      if (
        state &&
        (state.width !== bitmap.width || state.height !== bitmap.height)
      ) {
        reset(m.source);
        state = undefined;
      }
      let output: EncodedVideoChunk | undefined,
        failed = false;
      if (!state) {
        const config: VideoEncoderConfig = {
          codec: "vp09.00.10.08",
          width: bitmap.width,
          height: bitmap.height,
          framerate: 0.2,
          bitrate: m.source === "screen" ? 20_000 : 4_000,
          latencyMode: "realtime",
          hardwareAcceleration: "prefer-software",
        };
        if (!(await VideoEncoder.isConfigSupported(config)).supported)
          throw Error();
        // Callbacks are reassigned per request below; each source has one encoder.
        const callbacks = {
          output: (_chunk: EncodedVideoChunk) => {},
          error: () => {},
        };
        const encoder = new VideoEncoder({
          output: (chunk) => callbacks.output(chunk),
          error: () => callbacks.error(),
        });
        encoder.configure(config);
        state = {
          encoder,
          chain: crypto.randomUUID(),
          previous: null,
          count: 0,
          width: bitmap.width,
          height: bitmap.height,
        };
        (state as any).callbacks = callbacks;
        encoders.set(m.source, state);
      }
      const callbacks = (state as any).callbacks;
      callbacks.output = (chunk: EncodedVideoChunk) => {
        if (output) failed = true;
        output = chunk;
      };
      callbacks.error = () => {
        failed = true;
      };
      const key = state.count % 12 === 0;
      if (key) {
        state.chain = crypto.randomUUID();
        state.previous = null;
      }
      frame = new VideoFrame(bitmap, {
        timestamp: m.timestamp,
        duration: 5_000_000,
      });
      state.encoder.encode(frame, { keyFrame: key });
      frame.close();
      frame = undefined;
      await state.encoder.flush();
      if (!output || failed || output.byteLength > 1_500_000) throw Error();
      const chunk = output as EncodedVideoChunk,
        data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const actualKey = chunk.type === "key";
      if (actualKey && !key) {
        state.chain = crypto.randomUUID();
        state.previous = null;
      }
      const video = {
        chain: state.chain,
        previous: state.previous,
        key: actualKey,
        width: state.width,
        height: state.height,
      };
      state.previous = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      state.count++;
      globalThis.postMessage(
        { id: m.id, data, video },
        { transfer: [data.buffer] },
      );
    } catch {
      reset(m.source);
      globalThis.postMessage({ id: m.id, error: true });
    } finally {
      frame?.close();
      bitmap.close();
      busy.delete(m.source);
    }
  })();
};
