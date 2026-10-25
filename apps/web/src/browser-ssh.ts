import { terminalInputChunks } from "./terminal-input.js";
import { socket } from "./api.js";
import type { CapturedPaneInput } from "../../../packages/protocol/index.js";

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
  private retainedTransport = false;
  private buffers = new Map<string, any[]>();
  private readyPanes = new Set<string>();
  private earlyInputs = new Map<
    string,
    { data: string; input?: CapturedPaneInput }[]
  >();
  private nativeInput = new Map<string, { epoch: string; sequence: number }>();
  private nativeInstances = new Map<string, string>();
  private inputChains = new Map<string, Promise<any>>();
  // Capture before queuing; a closed pane's late writes/rejections must not
  // target a replacement using the same UI identifier. Not a native input epoch.
  private paneInputOwners = new Map<string, object>();
  private framedBudgets = new Map<
    string,
    { owner: object; frames: number; bytes: number; warned: boolean }
  >();
  get active() {
    return !!this.worker && !this.stopped;
  }
  get usingBrowser() {
    return this.browserMode;
  }
  get controlConnected() {
    return !this.browserMode || this.controlReady;
  }
  retainTransport(retained: boolean) {
    this.retainedTransport = retained && this.authenticated && this.active;
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
      // A retired worker's already-posted output/EOF must not affect a later
      // pane using the same UI identifier, including the gap before admission.
      if (
        (m.type === "closed" || m.type === "output") &&
        (m.pane_instance || m.input_epoch) &&
        (m.pane_instance
          ? m.pane_instance !== this.nativeInstances.get(m.pane)
          : m.input_epoch !== this.nativeInput.get(m.pane)?.epoch)
      )
        return;
      if (m.type === "closed") {
        const opening = this.openingPanes.get(m.pane);
        if (opening) opening.closed = true;
        this.sendControl({
          v: 1,
          type: "browser-pane-closed",
          pane: m.pane,
          input_epoch: m.input_epoch,
          pane_instance: m.pane_instance,
        });
        this.readyPanes.delete(m.pane);
        this.earlyInputs.delete(m.pane);
        this.inputChains.delete(m.pane);
        this.paneInputOwners.delete(m.pane);
        this.framedBudgets.delete(m.pane);
        this.nativeInput.delete(m.pane);
        this.nativeInstances.delete(m.pane);
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
        if (opening) {
          this.openingPanes.set(m.args.pane, opening);
          if (m.args.input_epoch) {
            this.nativeInstances.set(m.args.pane, m.args.input_epoch);
            // SSH output can beat the server's verified opened reply. Publish
            // only physical identity now; input still waits for that reply.
            this.emit({
              type: "pane-context",
              pane: m.args.pane,
              instance: m.args.input_epoch,
            });
            this.nativeInput.set(m.args.pane, {
              epoch: m.args.input_epoch,
              sequence: 0,
            });
            // Keys captured before the native context was known have no scoped
            // epoch. Never stamp them later when this open completes.
            this.earlyInputs.delete(m.args.pane);
          } else {
            this.nativeInput.delete(m.args.pane);
            this.nativeInstances.delete(m.args.pane);
          }
        }
        promise = (
          m.op === "change-input-epoch"
            ? this.changeInputEpoch(m.args)
            : this.request(m.op, m.args)
        )
          .then((result) => {
            if (this.lifecycle !== lifecycle || this.stopped) return result;
            if (m.op === "connect")
              return {
                ...result,
                loaded_pane_input: "v1",
                loaded_pane_epoch_change: "v1",
                loaded_control_retention: "v1",
              };
            if (m.op === "open" && !opening?.closed) {
              this.readyPanes.add(m.args.pane);
              const pending = this.earlyInputs.get(m.args.pane) || [];
              this.earlyInputs.delete(m.args.pane);
              for (const value of pending)
                this.input(m.args.pane, value.data, value.input);
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
      } else if (m.op === "input-framed" || m.op === "resize-framed") {
        this.framed(
          m.args.pane,
          { epoch: m.args.epoch, sequence: m.args.sequence },
          m.op,
          m.args,
        );
      } else void this.request(m.op, m.args).catch(() => {});
      return true;
    }
    return false;
  }
  private async changeInputEpoch(args: any) {
    const { pane, previous, next, instance } = args;
    const current = this.nativeInput.get(pane);
    if (
      !current ||
      this.nativeInstances.get(pane) !== instance ||
      !/^[a-f0-9]{64}$/.test(next || "") ||
      previous === next ||
      (current.epoch !== previous && current.epoch !== next)
    )
      throw Error("Stale retained terminal input agreement");
    if (current.epoch === next) return; // Retry preserves the consumed sequence.
    await this.request("change-input-epoch", { pane, previous, next });
    if (
      this.nativeInput.get(pane) !== current ||
      this.nativeInstances.get(pane) !== instance
    )
      throw Error("Terminal changed while agreeing on retained input");
    this.nativeInput.set(pane, { epoch: next, sequence: 0 });
    this.earlyInputs.delete(pane);
    this.paneInputOwners.delete(pane);
    this.framedBudgets.delete(pane);
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
        if (q.reduce((n, s) => n + s.data.length, 0) + m.data.length <= 65536) {
          q.push({ data: m.data, input: m.input ? { ...m.input } : undefined });
          this.earlyInputs.set(m.pane, q);
        }
        return true;
      }
      this.input(m.pane, m.data, m.input);
      return true;
    }
    if (m.type === "close") {
      this.readyPanes.delete(m.pane);
      this.earlyInputs.delete(m.pane);
      this.inputChains.delete(m.pane);
      this.paneInputOwners.delete(m.pane);
      this.framedBudgets.delete(m.pane);
      this.nativeInput.delete(m.pane);
      this.nativeInstances.delete(m.pane);
      const opening = this.openingPanes.get(m.pane);
      if (opening) opening.closed = true;
      // The server authorizes close and then asks the worker once. Do not race
      // an unsigned direct worker close against that same server operation.
      return false;
    }
    // An optimistic viewport event can arrive after local close but before the
    // old worker pane retires, or before replacement admission completes. Do
    // not send a raw worker resize into that incarnation. The authenticated
    // server orders legacy resize after open and drops unscoped framed resize;
    // framed opened publishes a fresh captured viewport separately.
    if (!this.readyPanes.has(m.pane)) return false;
    if (this.nativeInput.has(m.pane)) {
      if (this.inputEnabled && this.controlReady)
        this.framed(m.pane, m.input, "resize-framed", {
          rows: m.rows,
          cols: m.cols,
        });
      return true; // The server must not send a duplicate unscoped SSH resize.
    }
    if (m.input) return true; // No fallback to a legacy resize.
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
  private input(pane: string, data: string, input?: CapturedPaneInput) {
    if (this.nativeInput.has(pane)) {
      if (data.length <= 8000)
        this.framed(pane, input, "input-framed", { data });
      return; // Chunk at key capture, never reuse a sequence while dequeuing.
    }
    if (input) return; // No raw fallback from an unagreed captured context.
    if (data.length > 8000) {
      for (const chunk of terminalInputChunks(data)) this.input(pane, chunk);
      return;
    }
    this.queuePaneInput(pane, "input", { pane, data });
  }
  private framed(
    pane: string,
    input: CapturedPaneInput | undefined,
    op: string,
    value: any,
  ) {
    const context = this.nativeInput.get(pane);
    if (
      !context ||
      input?.epoch !== context.epoch ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= context.sequence ||
      input.sequence > Number.MAX_SAFE_INTEGER
    )
      return;
    context.sequence = input.sequence;
    this.queuePaneInput(
      pane,
      op,
      { ...value, pane, epoch: input.epoch, sequence: input.sequence },
      context.epoch,
    );
  }
  private queuePaneInput(
    pane: string,
    op: string,
    args: any,
    nativeEpoch?: string,
  ) {
    const epoch = this.inputEpoch;
    const lifecycle = this.lifecycle;
    let owner = this.paneInputOwners.get(pane);
    if (!owner) {
      owner = {};
      this.paneInputOwners.set(pane, owner);
    }
    const bytes = nativeEpoch
      ? op === "input-framed"
        ? new TextEncoder().encode(args.data).length
        : 8
      : 0;
    let budget = nativeEpoch ? this.framedBudgets.get(pane) : undefined;
    if (nativeEpoch) {
      if (!budget || budget.owner !== owner) {
        budget = { owner, frames: 0, bytes: 0, warned: false };
        this.framedBudgets.set(pane, budget);
      }
      if (budget.frames >= 64 || budget.bytes + bytes > 65536) {
        if (!budget.warned) {
          budget.warned = true;
          this.emit({ type: "input-backpressure", pane });
        }
        return; // No retained promise/bytes and no replay or authentication loss.
      }
      budget.frames++;
      budget.bytes += bytes;
    }
    const chain = (this.inputChains.get(pane) || Promise.resolve())
      .then(() => {
        if (
          lifecycle === this.lifecycle &&
          epoch === this.inputEpoch &&
          this.paneInputOwners.get(pane) === owner &&
          (!nativeEpoch || this.nativeInput.get(pane)?.epoch === nativeEpoch) &&
          this.inputEnabled &&
          this.controlReady &&
          this.readyPanes.has(pane)
        )
          return this.request(op, args);
      })
      .catch(() => {
        if (
          lifecycle === this.lifecycle &&
          epoch === this.inputEpoch &&
          this.paneInputOwners.get(pane) === owner &&
          (!nativeEpoch || this.nativeInput.get(pane)?.epoch === nativeEpoch) &&
          !this.stopped
        )
          this.emit({ type: "closed", pane });
      })
      .finally(() => {
        if (budget) {
          budget.frames--;
          budget.bytes -= bytes;
          if (!budget.frames) budget.warned = false;
        }
      });
    this.inputChains.set(pane, chain);
  }
  private reconnect() {
    if (this.stopped) return;
    if (
      !this.retainedTransport &&
      performance.now() - this.disconnected > 15000
    ) {
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
        if (
          !this.retainedTransport &&
          performance.now() - this.disconnected > 15000
        ) {
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
    this.retainedTransport = false;
    this.token = "";
    this.buffers.clear();
    this.readyPanes.clear();
    this.nativeInstances.clear();
    this.earlyInputs.clear();
    this.inputChains.clear();
    this.paneInputOwners.clear();
    this.framedBudgets.clear();
    this.nativeInput.clear();
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
