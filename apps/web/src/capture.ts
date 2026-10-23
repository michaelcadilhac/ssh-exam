import { api } from "./api.js";
export class Capture {
  streams = new Map<string, MediaStream>();
  videos = new Map<string, HTMLVideoElement>();
  seq = new Map<string, number>();
  queues = new Map<string, any[]>();
  timer: ReturnType<typeof setInterval> | undefined;
  stopped = false;
  busy = new Map<string, Promise<void>>();
  private abort = new AbortController();
  constructor(
    private id: string,
    private page: string,
    private incident: (reason: string) => void,
    private readiness: () => Record<string, boolean>,
    private preflight: () => boolean,
  ) {}
  async setup(source: "screen" | "webcam") {
    if (this.streams.has(source) && this.healthy(source))
      return this.streams.get(source);
    this.streams
      .get(source)
      ?.getTracks()
      .forEach((t) => t.stop());
    this.streams.delete(source);
    const stream =
      source === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 2560 }, height: { ideal: 1440 } },
            audio: false,
          })
        : await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
    const track = stream.getVideoTracks()[0];
    if (
      source === "screen" &&
      track.getSettings().displaySurface !== "monitor"
    ) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error("Select an entire display, not a window or tab.");
    }
    track.onended = () => {
      if (!this.stopped) this.incident(`${source} track ended`);
    };
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.streams.set(source, stream);
    this.videos.set(source, video);
    this.queues.set(source, []);
    if (!this.timer)
      this.timer = setInterval(() => {
        for (const s of this.streams.keys())
          void this.sample(s).catch(() => this.incident(`${s} capture failed`));
      }, 5000);
    await this.sample(source);
    return stream;
  }
  healthy(source: string) {
    const t = this.streams.get(source)?.getVideoTracks()[0];
    return !!t && t.readyState === "live" && !t.muted;
  }
  async sample(source: string) {
    if (this.stopped) return;
    const pending = this.busy.get(source);
    if (pending) return pending;
    const task = this.sampleOnce(source);
    this.busy.set(source, task);
    try {
      await task;
    } finally {
      if (this.busy.get(source) === task) this.busy.delete(source);
    }
  }
  private async sampleOnce(source: string) {
    // Obtain the nonce BEFORE sampling. Queued legacy images cannot be
    // relabelled with a fresh nonce or refresh readiness on arrival.
    const challenge = this.preflight()
      ? await api(
          `/student/attempts/${this.id}/capture-challenges`,
          { source },
          this.page,
          this.abort.signal,
        )
      : null;
    if (this.stopped) return;
    const video = this.videos.get(source)!;
    if (!video.videoWidth || !video.videoHeight) throw Error("No video frame");
    const scale = Math.min(
      1,
      2560 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    const seq =
      Math.max(this.seq.get(source) || 0, challenge?.after_sequence ?? 0) + 1;
    this.seq.set(source, seq);
    const frame = {
      source,
      seq,
      captured: Date.now(),
      monotonic: performance.now(),
      data,
    };
    if (challenge) {
      await api(
        `/student/attempts/${this.id}/frames/challenged`,
        {
          ...frame,
          challenge: challenge.challenge,
          readiness: this.readiness(),
        },
        this.page,
        this.abort.signal,
      );
      return;
    }
    const q = this.queues.get(source)!;
    q.push(frame);
    if (q.length > 6 || q.reduce((n, f) => n + f.data.length, 0) > 12000000) {
      this.incident("Capture recovery queue overflow");
      q.splice(0, Math.max(0, q.length - 6));
    }
    while (q.length) {
      try {
        await api(`/student/attempts/${this.id}/frames`, q[0], this.page);
        q.shift();
      } catch (e) {
        break;
      }
    }
  }
  async verifyForBegin(webcam: boolean) {
    const sources = webcam ? ["screen", "webcam"] : ["screen"];
    // A setup/timer sample may predate fullscreen or keyboard lock. Await it,
    // then sample current conditions rather than treating it as Begin evidence.
    await Promise.all(sources.map((source) => this.busy.get(source)));
    if (this.stopped)
      throw Error(
        "Capture stopped; restore preflight before Begin. The exam has not started.",
      );
    await Promise.all(sources.map((source) => this.sample(source)));
    const result = await api(
      `/student/attempts/${this.id}/monitoring-readiness`,
      undefined,
      this.page,
      this.abort.signal,
    );
    if (!result.complete)
      throw Error(
        "Fresh required capture could not be verified. Restore preflight and retry Begin; the exam has not started.",
      );
  }
  stop() {
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.timer);
    for (const s of this.streams.values())
      s.getTracks().forEach((t) => t.stop());
    this.streams.clear();
    this.videos.clear();
    this.queues.clear();
  }
}
