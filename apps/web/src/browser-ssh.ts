import { terminalInputChunks } from "./terminal-input.js";
import { socket } from "./api.js";

export class BrowserSSH {
  private lifecycle = 0;
  private openingPanes = new Map<string, { closed: boolean }>();
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
  // Capture before queuing; a closed pane's late writes/rejections must not
  // target a replacement using the same UI identifier. Not a native input epoch.
  private paneInputOwners = new Map<string, object>();
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
    this.close();
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
  private sendControl(message: any) {
    const control = this.control;
    if (control?.readyState !== 1) return;
    try {
      control.send(JSON.stringify(message));
    } catch {
      control.close();
    }
  }
  private initialize() {
    this.stopped = false;
    this.worker = new Worker(new URL("./ssh-worker.ts", import.meta.url), {
      type: "module",
    });
    const worker = this.worker;
    const lifecycle = this.lifecycle;
    this.worker.onmessage = ({ data: m }) => {
      if (
        this.worker !== worker ||
        this.lifecycle !== lifecycle ||
        this.stopped
      )
        return;
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
        this.sendControl({
          v: 1,
          type: "browser-host-key-mismatch",
          host: m.host,
          fingerprint: m.fingerprint,
        });
        return;
      }
      if (m.type === "loss" || m.type === "fatal") {
        this.sendControl({ v: 1, type: "browser-loss" });
        this.emit({ type: "loss" });
        this.close();
        return;
      }
      if (m.type === "closed") {
        const opening = this.openingPanes.get(m.pane);
        if (opening) opening.closed = true;
        this.sendControl({ v: 1, type: "browser-pane-closed", pane: m.pane });
        this.readyPanes.delete(m.pane);
        this.earlyInputs.delete(m.pane);
        this.inputChains.delete(m.pane);
        this.paneInputOwners.delete(m.pane);
      }
      this.emit(m);
    };
    this.worker.onerror = () => {
      if (
        this.worker !== worker ||
        this.lifecycle !== lifecycle ||
        this.stopped
      )
        return;
      this.emit({ type: "loss" });
      this.close();
    };
  }
  private request(op: string, args: any): Promise<any> {
    if (!this.worker) return Promise.reject(Error("SSH disconnected"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, op, args });
      } catch {
        this.callbacks.delete(id);
        reject(Error("SSH worker unavailable"));
      }
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
          this.close(true);
          this.browserMode = true;
          this.initialize();
          this.token = m.args.controlToken;
        }
        const lifecycle = this.lifecycle;
        const opening = m.op === "open" ? { closed: false } : undefined;
        if (opening) this.openingPanes.set(m.args.pane, opening);
        promise = this.request(m.op, m.args)
          .then((result) => {
            if (this.lifecycle !== lifecycle || this.stopped) return result;
            if (m.op === "open" && !opening?.closed) {
              this.readyPanes.add(m.args.pane);
              const pending = this.earlyInputs.get(m.args.pane) || [];
              this.earlyInputs.delete(m.args.pane);
              for (const data of pending) this.input(m.args.pane, data);
            }
            return result;
          })
          .finally(() => {
            if (this.openingPanes.get(m.args.pane) === opening)
              this.openingPanes.delete(m.args.pane);
          });
        this.controlReplies.set(m.id, promise);
        if (this.controlReplies.size > 64)
          this.controlReplies.delete(this.controlReplies.keys().next().value!);
      }
      const lifecycle = this.lifecycle;
      void promise.then(
        (result) => {
          if (this.lifecycle !== lifecycle || this.stopped) return;
          if (m.op === "connect") {
            this.authenticated = true;
            this.controlReady = true;
            this.emit({ type: "control", connected: true });
          }
          this.sendControl({ v: 1, type: "browser-result", id: m.id, result });
        },
        () => {
          if (this.lifecycle !== lifecycle || this.stopped) return;
          this.sendControl({
            v: 1,
            type: "browser-result",
            id: m.id,
            error: true,
          });
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
    if (m.type === "close") {
      this.readyPanes.delete(m.pane);
      this.earlyInputs.delete(m.pane);
      this.inputChains.delete(m.pane);
      this.paneInputOwners.delete(m.pane);
      const opening = this.openingPanes.get(m.pane);
      if (opening) opening.closed = true;
      // The server authorizes close and then asks the worker once. Do not race
      // an unsigned direct worker close against that same server operation.
      return false;
    }
    const lifecycle = this.lifecycle;
    const op = m.type;
    void this.request(op, {
      pane: m.pane,
      data: m.data,
      rows: m.rows,
      cols: m.cols,
    }).catch(() => {
      if (this.lifecycle === lifecycle && !this.stopped)
        this.emit({ type: "loss" });
    });
    return m.type === "input";
  }
  private input(pane: string, data: string) {
    if (data.length > 8000) {
      for (const chunk of terminalInputChunks(data)) this.input(pane, chunk);
      return;
    }
    const epoch = this.inputEpoch;
    const lifecycle = this.lifecycle;
    let owner = this.paneInputOwners.get(pane);
    if (!owner) {
      owner = {};
      this.paneInputOwners.set(pane, owner);
    }
    const chain = (this.inputChains.get(pane) || Promise.resolve())
      .then(() => {
        if (
          lifecycle === this.lifecycle &&
          epoch === this.inputEpoch &&
          this.paneInputOwners.get(pane) === owner &&
          this.inputEnabled &&
          this.controlReady &&
          this.readyPanes.has(pane)
        )
          return this.request("input", { pane, data });
      })
      .catch(() => {
        if (
          lifecycle === this.lifecycle &&
          epoch === this.inputEpoch &&
          this.paneInputOwners.get(pane) === owner &&
          !this.stopped
        )
          this.emit({ type: "closed", pane });
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
  close(keepControl = false) {
    ++this.lifecycle;
    this.setInputEnabled(false);
    this.controlReady = false;
    this.stopped = true;
    clearTimeout(this.retry);
    this.worker?.terminate();
    this.worker = undefined;
    this.authenticated = false;
    this.disconnected = 0;
    this.token = "";
    this.buffers.clear();
    this.readyPanes.clear();
    this.earlyInputs.clear();
    this.inputChains.clear();
    this.paneInputOwners.clear();
    for (const p of this.callbacks.values())
      p.reject(Error("SSH connection ended"));
    this.callbacks.clear();
    this.controlReplies.clear();
    this.openingPanes.clear();
    if (!keepControl) {
      const control = this.control;
      this.control = undefined;
      this.authListener = undefined;
      control?.close();
    }
  }
}
export const browserSSH = new BrowserSSH();
