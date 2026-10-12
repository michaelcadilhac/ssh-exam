import { api } from "./api.js";
export class Capture {
  streams = new Map<string, MediaStream>();
  videos = new Map<string, HTMLVideoElement>();
  seq = new Map<string, number>();
  queues = new Map<string, any[]>();
  timer: ReturnType<typeof setInterval> | undefined;
  stopped = false;
  busy = new Set<string>();
  constructor(
    private id: string,
    private page: string,
    private incident: (reason: string) => void,
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
    await this.sample(source);
    if (!this.timer)
      this.timer = setInterval(() => {
        for (const s of this.streams.keys())
          void this.sample(s).catch(() => this.incident(`${s} capture failed`));
      }, 5000);
    return stream;
  }
  healthy(source: string) {
    const t = this.streams.get(source)?.getVideoTracks()[0];
    return !!t && t.readyState === "live" && !t.muted;
  }
  async sample(source: string) {
    if (this.stopped || this.busy.has(source)) return;
    this.busy.add(source);
    try {
      const video = this.videos.get(source)!;
      if (!video.videoWidth || !video.videoHeight)
        throw Error("No video frame");
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
      const seq = (this.seq.get(source) || 0) + 1;
      this.seq.set(source, seq);
      const q = this.queues.get(source)!;
      q.push({
        source,
        seq,
        captured: Date.now(),
        monotonic: performance.now(),
        data,
      });
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
    } finally {
      this.busy.delete(source);
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const s of this.streams.values())
      s.getTracks().forEach((t) => t.stop());
    this.streams.clear();
    this.videos.clear();
    this.queues.clear();
  }
}
