import { socket } from "./api.js";

export class BrowserSSH {
  private browserMode = false;
  private worker?: Worker;
  private control?: WebSocket;
  private token = "";
  private authenticated = false;
  private controlReady = false;
  private inputEnabled = false;
  private inputEpoch = 0;
  private stopped = false;
  private callbacks = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private controlReplies = new Map<string, Promise<any>>();
  private listeners = new Set<(v: any) => void>();
  private authListener?: (v: any) => void;
  private retry?: ReturnType<typeof setTimeout>;
  private disconnected = 0;
  private buffers = new Map<string, any[]>();
  private readyPanes = new Set<string>();
  private earlyInputs = new Map<string, string[]>();
  private inputChains = new Map<string, Promise<any>>();
  get active() {
    return !!this.worker && !this.stopped;
  }
  get usingBrowser() {
    return this.browserMode;
  }
  get controlConnected() {
    return !this.browserMode || this.controlReady;
  }
  setInputEnabled(enabled: boolean) {
    if (this.inputEnabled === enabled) return;
    this.inputEnabled = enabled;
    if (!enabled) {
      ++this.inputEpoch;
      this.earlyInputs.clear();
    }
  }
  begin(s: WebSocket, auth: (v: any) => void) {
    this.browserMode = false;
    this.attach(s, auth);
  }
  subscribe(fn: (v: any) => void) {
    this.listeners.add(fn);
    for (const entries of this.buffers.values()) for (const e of entries) fn(e);
    this.buffers.clear();
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(v: any) {
    if (v.type === "output" && !this.listeners.size) {
      const q = this.buffers.get(v.pane) || [];
      if (
        q.reduce((n, e) => n + e.data.length, 0) + v.data.length <
        1024 * 1024
      ) {
        q.push(v);
        this.buffers.set(v.pane, q);
      }
      return;
    }
    for (const fn of this.listeners) fn(v);
  }
  private initialize() {
    this.stopped = false;
    this.worker = new Worker(new URL("./ssh-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data: m }) => {
      if (m.type === "rpc-result") {
        const p = this.callbacks.get(m.id);
        this.callbacks.delete(m.id);
        if (p) m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
        return;
      }
      if (m.type === "challenge" || m.type === "notice") {
        this.authListener?.(m);
        return;
      }
      if (m.type === "host-key-mismatch") {
        if (this.control?.readyState === 1)
          this.control.send(
            JSON.stringify({
              v: 1,
              type: "browser-host-key-mismatch",
              host: m.host,
              fingerprint: m.fingerprint,
            }),
          );
        return;
      }
      if (m.type === "loss" || m.type === "fatal") {
        if (this.control?.readyState === 1)
          this.control.send(JSON.stringify({ v: 1, type: "browser-loss" }));
        this.emit({ type: "loss" });
        this.close();
        return;
      }
      if (m.type === "closed") {
        this.readyPanes.delete(m.pane);
        this.earlyInputs.delete(m.pane);
        this.inputChains.delete(m.pane);
      }
      this.emit(m);
    };
    this.worker.onerror = () => {
      this.emit({ type: "loss" });
      this.close();
    };
  }
  private request(op: string, args: any): Promise<any> {
    if (!this.worker) return Promise.reject(Error("SSH disconnected"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.worker!.postMessage({ id, op, args });
    });
  }
  attach(s: WebSocket, auth: (v: any) => void) {
    this.control = s;
    this.authListener = auth;
    s.addEventListener("close", () => {
      if (this.control !== s || this.stopped) return;
      if (!this.authenticated) {
        this.close();
        return;
      }
      this.controlReady = false;
      this.setInputEnabled(false);
      this.emit({ type: "control", connected: false });
      this.disconnected ||= performance.now();
      this.retry = setTimeout(() => this.reconnect(), 500);
    });
  }
  handle(m: any): boolean {
    if (m.type === "browser-request") {
      let promise = this.controlReplies.get(m.id);
      if (!promise) {
        if (m.op === "connect") {
          this.close();
          this.browserMode = true;
          this.initialize();
          this.token = m.args.controlToken;
        }
        promise = this.request(m.op, m.args).then((result) => {
          if (m.op === "open") {
            this.readyPanes.add(m.args.pane);
            const pending = this.earlyInputs.get(m.args.pane) || [];
            this.earlyInputs.delete(m.args.pane);
            for (const data of pending) this.input(m.args.pane, data);
          }
          return result;
        });
        this.controlReplies.set(m.id, promise);
        if (this.controlReplies.size > 64)
          this.controlReplies.delete(this.controlReplies.keys().next().value!);
      }
      void promise.then(
        (result) => {
          if (m.op === "connect") {
            this.authenticated = true;
            this.controlReady = true;
            this.emit({ type: "control", connected: true });
          }
          if (this.control?.readyState === 1)
            this.control.send(
              JSON.stringify({
                v: 1,
                type: "browser-result",
                id: m.id,
                result,
              }),
            );
        },
        () => {
          if (this.control?.readyState === 1)
            this.control.send(
              JSON.stringify({
                v: 1,
                type: "browser-result",
                id: m.id,
                error: true,
              }),
            );
        },
      );
      return true;
    }
    if (m.type === "browser-notify") {
      if (m.op === "close") {
        this.emit({ type: "loss" });
        this.close();
      } else void this.request(m.op, m.args).catch(() => {});
      return true;
    }
    return false;
  }
  answers(round: string, answers: string[]) {
    try {
      this.worker?.postMessage({
        id: crypto.randomUUID(),
        op: "answers",
        args: { round, answers },
      });
    } finally {
      answers.fill("");
    }
  }
  terminal(m: any): boolean {
    if (!this.active || !["input", "resize", "close"].includes(m.type))
      return false;
    if (m.type === "input") {
      if (!this.inputEnabled || !this.controlReady) return true;
      if (!this.readyPanes.has(m.pane)) {
        const q = this.earlyInputs.get(m.pane) || [];
        if (q.reduce((n, s) => n + s.length, 0) + m.data.length <= 65536) {
          q.push(m.data);
          this.earlyInputs.set(m.pane, q);
        }
        return true;
      }
      this.input(m.pane, m.data);
      return true;
    }
    const op = m.type === "close" ? "close-pane" : m.type;
    void this.request(op, {
      pane: m.pane,
      data: m.data,
      rows: m.rows,
      cols: m.cols,
    }).catch(() => this.emit({ type: "loss" }));
    return m.type === "input";
  }
  private input(pane: string, data: string) {
    if (data.length > 16000) {
      for (let start = 0; start < data.length; start += 16000)
        this.input(pane, data.slice(start, start + 16000));
      return;
    }
    const epoch = this.inputEpoch;
    const chain = (this.inputChains.get(pane) || Promise.resolve())
      .then(() => {
        if (epoch === this.inputEpoch && this.inputEnabled && this.controlReady)
          return this.request("input", { pane, data });
      })
      .catch(() => {
        if (epoch === this.inputEpoch) this.emit({ type: "closed", pane });
      });
    this.inputChains.set(pane, chain);
  }
  private reconnect() {
    if (this.stopped) return;
    if (performance.now() - this.disconnected > 15000) {
      this.emit({ type: "loss" });
      this.close();
      return;
    }
    const s = socket("/browser/ssh");
    this.attach(s, this.authListener || (() => {}));
    s.onopen = () =>
      s.send(
        JSON.stringify({
          v: 1,
          type: "browser-bind",
          controlToken: this.token,
        }),
      );
    s.onmessage = ({ data }) => {
      if (this.control !== s || this.stopped) return;
      const m = JSON.parse(data);
      if (m.type === "browser-bound") {
        if (performance.now() - this.disconnected > 15000) {
          this.emit({ type: "loss" });
          this.close();
          return;
        }
        this.disconnected = 0;
        this.controlReady = true;
        this.emit({ type: "control", connected: true });
        return;
      }
      this.handle(m);
    };
  }
  close() {
    this.setInputEnabled(false);
    this.controlReady = false;
    this.stopped = true;
    clearTimeout(this.retry);
    this.worker?.terminate();
    this.worker = undefined;
    this.authenticated = false;
    this.token = "";
    this.buffers.clear();
    this.readyPanes.clear();
    this.earlyInputs.clear();
    this.inputChains.clear();
    for (const p of this.callbacks.values())
      p.reject(Error("SSH connection ended"));
    this.callbacks.clear();
    this.controlReplies.clear();
  }
}
export const browserSSH = new BrowserSSH();
