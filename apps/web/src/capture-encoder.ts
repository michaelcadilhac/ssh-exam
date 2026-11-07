import type { CaptureUploadMetadata } from "../../../packages/protocol/capture-upload.js";
type Encoded = {
  data: Uint8Array<ArrayBuffer>;
  video: NonNullable<CaptureUploadMetadata["video"]>;
};
export class CaptureEncoder {
  private worker?: Worker;
  private next = 0;
  private stopped = false;
  private pending = new Map<
    number,
    { resolve: (value: Encoded) => void; reject: () => void }
  >();
  private ensure() {
    if (
      this.stopped ||
      typeof Worker === "undefined" ||
      typeof createImageBitmap === "undefined"
    )
      throw Error("Video encoding unavailable");
    if (!this.worker) {
      const worker = new Worker(
        new URL("./capture-encoder-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event) => {
        const m = event.data,
          pending = this.pending.get(m.id);
        if (!pending) return;
        this.pending.delete(m.id);
        if (m.error || !(m.data instanceof Uint8Array) || !m.video)
          pending.reject();
        else pending.resolve({ data: m.data, video: m.video });
      };
      worker.onerror = () => {
        for (const value of this.pending.values()) value.reject();
        this.pending.clear();
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
      };
      this.worker = worker;
    }
    return this.worker;
  }
  async encode(
    canvas: HTMLCanvasElement,
    source: string,
    monotonic: number,
  ): Promise<Encoded> {
    const worker = this.ensure(),
      bitmap = await createImageBitmap(canvas);
    if (this.stopped || worker !== this.worker) {
      bitmap.close();
      throw Error("Video encoding stopped");
    }
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.reset(source);
        reject(Error("Video encoding unavailable"));
      }, 5000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: () => {
          clearTimeout(timer);
          reject(Error("Video encoding unavailable"));
        },
      });
      try {
        worker.postMessage(
          {
            type: "encode",
            id,
            source,
            timestamp: Math.round(monotonic * 1000),
            bitmap,
          },
          [bitmap],
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        bitmap.close();
        reject(Error("Video encoding unavailable"));
      }
    });
  }
  reset(source: string) {
    this.worker?.postMessage({ type: "reset", source });
  }
  close() {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = undefined;
    for (const value of this.pending.values()) value.reject();
    this.pending.clear();
  }
}
