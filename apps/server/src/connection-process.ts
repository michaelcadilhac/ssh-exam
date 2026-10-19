import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import type { Config } from "../../../packages/config/index.js";
import { AgentCommandDisconnectedError, type Agent } from "./agent.js";
import type { Connection, Dialogue } from "./ssh.js";
import type { ClientChannel } from "ssh2";
export type ConnectionHandle = Pick<
  Connection,
  | "username"
  | "panes"
  | "transport"
  | "alive"
  | "onLoss"
  | "onDiagnostic"
  | "supportsAutomaticHandoff"
  | "connect"
  | "secureAccess"
  | "command"
  | "open"
  | "close"
>;

export type ConnectionFailure = {
  cause:
    | "exit"
    | "ipc"
    | "unresponsive"
    | "operation-timeout"
    | "supervisor-callback";
  code: number | null;
  signal: string | null;
};
const running = new Set<IsolatedConnection>();
const MAX_PACKET = 8 * 1024 * 1024;
class RemotePane extends EventEmitter {
  writableLength = 0;
  disposed = false;
  private closing?: Promise<void>;
  constructor(
    public id: string,
    private owner: IsolatedConnection,
  ) {
    super();
  }
  write(data: string) {
    if (this.disposed || this.closing) return false;
    this.owner.post({ kind: "pane", pane: this.id, op: "write", args: [data] });
    return true;
  }
  setWindow(rows: number, cols: number) {
    this.owner.post({
      kind: "pane",
      pane: this.id,
      op: "setWindow",
      args: [rows, cols],
    });
  }
  pause() {
    this.owner.post({ kind: "pane", pane: this.id, op: "pause", args: [] });
  }
  resume() {
    this.owner.post({ kind: "pane", pane: this.id, op: "resume", args: [] });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.owner.panes.get(this.id) === (this as any))
      this.owner.panes.delete(this.id);
    this.emit("close");
  }
  close() {
    return (this.closing ??= this.owner
      .rpc("close-pane", [this.id])
      .then(() => {})
      .finally(() => this.dispose()));
  }
}

// SSH clients, signing and browser-operation lifecycles run in a disposable OS
// process. The HTTP-side proxy owns only bounded IPC and supervision state.
export class IsolatedConnection implements ConnectionHandle {
  panes = new Map<string, ClientChannel>();
  alive = false;
  transport = "";
  onLoss = () => {};
  onDiagnostic = (_host: string, _detail: string) => {};
  onFailure?: (failure: ConnectionFailure) => void;
  private child: ChildProcess;
  private stopped = false;
  private failed = false;
  private sequence = 0;
  private replies = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private sockets = new Map<number, WebSocket>();
  private socketSequence = 0;
  private dialogue?: Dialogue;
  private heartbeat: NodeJS.Timeout;
  private lastPong = performance.now();
  private killTimer?: NodeJS.Timeout;
  private queued = 0;
  readonly controlToken: string;
  get supportsAutomaticHandoff() {
    return this.browser;
  }
  constructor(
    public username: string,
    private exam: string,
    config: Config,
    private authority: Agent,
    readonly browser = false,
    socket?: WebSocket,
    workerEntry?: URL,
  ) {
    if (running.size >= (config.connectionWorkers ?? 32))
      throw Object.assign(
        Error("Connection capacity reached. Please try again shortly."),
        {
          publicMessage:
            "The exam server is at connection capacity. Please try again shortly or contact your instructor.",
        },
      );
    const compiled = new URL("./connection-worker.js", import.meta.url);
    const entry =
      workerEntry ??
      (existsSync(fileURLToPath(compiled))
        ? compiled
        : new URL("./connection-worker.ts", import.meta.url));
    this.controlToken = crypto.randomUUID() + crypto.randomUUID();
    this.child = fork(entry, [], {
      execArgv: [
        "--max-old-space-size=64",
        "--v8-pool-size=1",
        "--unhandled-rejections=strict",
        ...(entry.pathname.endsWith(".ts") ? ["--import", "tsx"] : []),
      ],
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        TZ: process.env.TZ,
        NODE_ENV: process.env.NODE_ENV,
        UV_THREADPOOL_SIZE: "1",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
    });
    running.add(this);
    this.child.on("error", () =>
      this.fail({ cause: "ipc", code: null, signal: null }),
    );
    this.child.on("exit", (code, signal) => {
      clearTimeout(this.killTimer);
      if (!this.stopped) this.fail({ cause: "exit", code, signal });
      running.delete(this);
    });
    this.child.on("close", () => {
      clearTimeout(this.killTimer);
      running.delete(this);
    });
    this.child.on("disconnect", () => {
      setTimeout(() => {
        if (!this.stopped)
          this.fail({ cause: "ipc", code: null, signal: null });
      }, 100).unref();
    });
    this.child.on("message", (m: any) => {
      try {
        this.receiveWorker(m);
      } catch {
        this.fail({ cause: "supervisor-callback", code: null, signal: null });
      }
    });
    this.heartbeat = setInterval(() => {
      if (performance.now() - this.lastPong > 10000)
        this.fail({ cause: "unresponsive", code: null, signal: null });
      else this.post({ kind: "ping" });
    }, 2000);
    const initial = socket ? this.addSocket(socket) : undefined;
    // Do not give workers SMTP configuration, session/database paths or admin secrets.
    const {
      origin,
      jump,
      class: classHost,
      agent,
      browserSSH,
      mode,
      loginOnly,
    } = config;
    this.post({
      kind: "init",
      username,
      exam,
      config: {
        origin,
        jump,
        class: classHost,
        agent,
        browserSSH,
        mode,
        loginOnly,
      },
      browser,
      socket: initial,
      controlToken: this.controlToken,
    });
  }
  private addSocket(socket: WebSocket) {
    const id = ++this.socketSequence;
    this.sockets.set(id, socket);
    socket.on("close", () => {
      this.sockets.delete(id);
      this.post({ kind: "socket-close", socket: id });
    });
    return id;
  }
  async attach(socket: WebSocket) {
    await this.rpc("attach", [this.addSocket(socket)]);
  }
  receive(message: any) {
    if (
      ![
        "browser-host-key-mismatch",
        "browser-loss",
        "browser-pane-closed",
        "browser-result",
      ].includes(message?.type)
    )
      return false;
    this.post({ kind: "browser-message", message });
    return true;
  }
  post(message: any) {
    if (this.stopped || !this.child.connected) return;
    // Includes outgoing queued bytes, not just the number of RPCs. A stalled
    // attempt must not accumulate an unbounded queue in the HTTP process.
    const bytes = Buffer.byteLength(JSON.stringify(message));
    if (bytes > MAX_PACKET || this.queued + bytes > 16 * 1024 * 1024) {
      this.fail({ cause: "ipc", code: null, signal: null });
      return;
    }
    this.queued += bytes;
    try {
      this.child.send(message, (error) => {
        this.queued -= bytes;
        if (error && !this.stopped)
          this.fail({ cause: "ipc", code: null, signal: null });
      });
    } catch {
      this.queued -= bytes;
      this.fail({ cause: "ipc", code: null, signal: null });
    }
  }
  rpc(op: string, args: any[]): Promise<any> {
    if (this.stopped)
      return Promise.reject(
        new AgentCommandDisconnectedError(
          "Attempt connection ended. Reconnect SSH to resume.",
        ),
      );
    if (this.replies.size >= 64)
      return Promise.reject(Error("Too many pending connection operations"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () =>
          this.fail({ cause: "operation-timeout", code: null, signal: null }),
        125000,
      );
      this.replies.set(id, { resolve, reject, timer });
      this.post({ kind: "rpc", id, op, args });
    });
  }
  private receiveWorker(m: any) {
    if (this.stopped || !m || typeof m !== "object") return;
    if (m.kind === "pong") {
      this.lastPong = performance.now();
      return;
    }
    if (m.kind === "reply") {
      this.alive = !!m.alive;
      this.transport = m.transport || "";
      const pending = this.replies.get(m.id);
      if (!pending) return;
      this.replies.delete(m.id);
      clearTimeout(pending.timer);
      if (m.error) {
        const error = m.error.disconnected
          ? new AgentCommandDisconnectedError(m.error.message)
          : Error(m.error.message);
        Object.assign(error, {
          publicMessage: m.error.publicMessage,
          authenticationStage: m.error.authenticationStage,
        });
        pending.reject(error);
      } else pending.resolve(m.result);
      return;
    }
    if (m.kind === "socket-send") {
      const socket = this.sockets.get(m.socket);
      if (socket?.readyState === 1) {
        if (
          socket.bufferedAmount + Buffer.byteLength(m.data) >
          16 * 1024 * 1024
        ) {
          socket.terminate();
          return;
        }
        try {
          socket.send(m.data, (error) => {
            if (error) socket.terminate();
          });
        } catch {
          socket.terminate();
        }
      }
    } else if (m.kind === "socket-end") {
      this.sockets.get(m.socket)?.close(m.code, m.reason);
    } else if (m.kind === "pane-close") {
      (this.panes.get(m.pane) as any)?.dispose();
    } else if (m.kind === "pane-data") {
      this.panes.get(m.pane)?.emit("data", Buffer.from(m.data));
    } else if (m.kind === "diagnostic") {
      this.onDiagnostic(m.host, m.detail);
    } else if (m.kind === "loss") {
      this.close();
      this.onLoss();
    } else if (m.kind === "dialogue") {
      const dialogue = this.dialogue;
      if (!dialogue) {
        this.close();
        return;
      }
      void dialogue(m.host, m.instruction, m.prompts).then(
        (answers) => {
          this.post({ kind: "answers", id: m.id, answers });
          answers.fill("");
        },
        () => this.close(),
      );
    }
  }
  async connect(
    dialogue: Dialogue,
    options: Parameters<Connection["connect"]>[1] = {},
  ) {
    this.dialogue = dialogue;
    try {
      await this.rpc("connect", [options]);
      this.authority.bind(this);
    } finally {
      this.dialogue = undefined;
    }
  }
  async secureAccess(id: string, exam: string) {
    await this.rpc("secureAccess", [id, exam]);
  }
  command(op: string, body: any = {}): Promise<any> {
    return this.rpc("command", [op, body]);
  }
  async open(attempt: string, pane: string, purpose = "exam") {
    if (this.panes.has(pane)) throw Error("Terminal already opening or open");
    const channel = new RemotePane(pane, this);
    this.panes.set(pane, channel as any);
    try {
      await this.rpc("open", [attempt, pane, purpose]);
      return channel as any;
    } catch (error) {
      channel.dispose();
      throw error;
    }
  }
  private fail(failure: ConnectionFailure) {
    if (this.stopped || this.failed) return;
    this.failed = true;
    this.close();
    // No exception text, stdout, stderr, request body or terminal content crosses
    // the failure reporting boundary. Report from the surviving supervisor.
    try {
      if (this.onFailure) this.onFailure(failure);
      else this.onLoss();
    } catch {
      /* The HTTP process must survive even a failed reporting callback. */
    }
  }
  close() {
    if (this.stopped) return;
    this.post({ kind: "shutdown" });
    this.stopped = true;
    this.alive = false;
    clearInterval(this.heartbeat);
    this.authority.unbind(this);
    this.dialogue = undefined;
    for (const pending of this.replies.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new AgentCommandDisconnectedError(
          "Attempt connection ended. Reconnect SSH to resume.",
        ),
      );
    }
    this.replies.clear();
    for (const pane of this.panes.values()) {
      try {
        (pane as any).dispose();
      } catch {
        /* Isolate a teardown listener too. */
      }
    }
    this.panes.clear();
    for (const socket of this.sockets.values()) {
      if (socket.readyState === 1) {
        try {
          socket.send(
            JSON.stringify({
              v: 1,
              type: "browser-notify",
              op: "close",
              args: {},
            }),
            () => {},
          );
        } catch {}
      }
      try {
        socket.close(1000, "Attempt connection ended");
      } catch {
        socket.terminate();
      }
    }
    this.sockets.clear();
    this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    this.killTimer.unref();
  }
}
export class IsolatedBrowserConnection extends IsolatedConnection {
  constructor(
    username: string,
    exam: string,
    config: Config,
    authority: Agent,
    socket: WebSocket,
    workerEntry?: URL,
  ) {
    super(username, exam, config, authority, true, socket, workerEntry);
  }
}
