import { EventEmitter } from "node:events";
import { randomUUID, sign, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WebSocket } from "ws";
import { Connection, type Dialogue } from "./ssh.js";
import { AgentCommandDisconnectedError, type Agent } from "./agent.js";
import type { Config } from "../../../packages/config/index.js";

class BrowserPane extends EventEmitter {
  writableLength = 0;
  private disposed = false;
  private closing?: Promise<void>;
  constructor(
    public pane: string,
    private attempt: string,
    private owner: BrowserConnection,
  ) {
    super();
  }
  write(data: string) {
    this.owner.notify("input", { pane: this.pane, data });
    return true;
  }
  setWindow(rows: number, cols: number) {
    this.owner.notify("resize", { pane: this.pane, rows, cols });
  }
  pause() {}
  resume() {}
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.owner.panes.get(this.pane) === (this as any))
      this.owner.panes.delete(this.pane);
    this.emit("close");
  }
  close(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.closing) return this.closing;
    this.closing = this.closeRemote();
    return this.closing;
  }
  private async closeRemote() {
    try {
      if (this.owner.alive) {
        await this.owner.command("close-pane", {
          id: this.attempt,
          pane: this.pane,
        });
        if (this.owner.alive) await this.owner.detachPane(this.pane);
      }
    } finally {
      this.dispose();
    }
  }
}

// Only authorization and signed acknowledgments cross this control socket.
// Passwords, MFA prompts and PTY bytes stay in the browser/class-server path.
export class BrowserConnection extends Connection {
  readonly browser = true;
  override get supportsAutomaticHandoff() {
    return true;
  }
  override async secureAccess(id: string, exam: string) {
    try {
      const key = await this.request("handoff-key", {});
      const grant = await this.command("issue-ssh-handoff", {
        id,
        public_key: key.public_key,
      });
      await this.request("handoff", { certificate: grant.certificate });
      this.transport = "";
      const result = await this.command("register", {
        exam,
        handoff: grant.id,
      });
      if (!result.transport)
        throw Error("Protected SSH handoff was not registered");
      this.transport = result.transport;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      if (this.alive) await this.request("discard-handoff", {}).catch(() => {});
    }
  }
  readonly controlToken = randomUUID() + randomUUID();
  private socket?: WebSocket;
  private pending = new Map<
    string,
    {
      op: string;
      args: any;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private detachment?: NodeJS.Timeout;
  private closed = false;
  private opening = new Map<string, { closed: boolean }>();
  constructor(
    user: string,
    private exam: string,
    private settings: Config,
    private authority: Agent,
    ws: WebSocket,
  ) {
    super(user, settings, authority);
    this.attach(ws);
  }
  attach(ws: WebSocket) {
    if (this.closed) throw Error("SSH connection ended");
    clearTimeout(this.detachment);
    const previous = this.socket;
    this.socket = ws;
    if (previous && previous !== ws) previous.close(1000, "Control replaced");
    ws.on("close", () => {
      if (this.socket !== ws) return;
      this.socket = undefined;
      if (!this.alive) this.close();
      else
        this.detachment = setTimeout(() => {
          this.alive = false;
          this.onLoss();
          this.close();
        }, 15000);
    });
    // Install close handling before replay: a failed resend must still start
    // the bounded detachment cleanup, rather than orphaning this connection.
    for (const [id, p] of this.pending) {
      const failed = (error?: Error) => {
        if (error && this.socket === ws)
          ws.close(1011, "Control replay failed");
      };
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: "browser-request",
            id,
            op: p.op,
            args: p.args,
          }),
          failed,
        );
      } catch {
        failed(Error("Replay send failed"));
        break;
      }
    }
  }
  receive(m: any) {
    if (m.type === "browser-host-key-mismatch") {
      if (
        [this.settings.jump.host, this.settings.class.host].includes(m.host) &&
        typeof m.fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(m.fingerprint)
      )
        this.onDiagnostic(
          m.host,
          "Browser reported an SSH host-key pin mismatch; SHA256(hex): " +
            m.fingerprint,
        );
      return true;
    }
    if (m.type === "browser-loss") {
      this.alive = false;
      this.onLoss();
      this.close();
      return true;
    }
    if (m.type === "browser-pane-closed") {
      if (typeof m.pane !== "string") return false;
      const pane = this.panes.get(m.pane);
      if (pane instanceof BrowserPane) pane.dispose();
      const opening = this.opening.get(m.pane);
      if (opening) opening.closed = true;
      return true;
    }
    if (m.type !== "browser-result") return false;
    const p = this.pending.get(m.id);
    if (!p) return true;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    m.error
      ? p.reject(Error("Browser SSH operation failed"))
      : p.resolve(m.result);
    return true;
  }
  private request(op: string, args: any, timeout = 120000): Promise<any> {
    if (this.closed || !this.socket || this.socket.readyState !== 1)
      return Promise.reject(
        new AgentCommandDisconnectedError(
          "Browser SSH control connection unavailable",
        ),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Browser SSH operation timed out: ${op}`));
      }, timeout);
      this.pending.set(id, { op, args, resolve, reject, timer });
      const failed = (error?: Error) => {
        if (!error || this.pending.get(id)?.timer !== timer) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(
          new AgentCommandDisconnectedError(
            "Browser SSH request could not be sent",
          ),
        );
      };
      try {
        this.socket!.send(
          JSON.stringify({ v: 1, type: "browser-request", id, op, args }),
          failed,
        );
      } catch {
        failed(Error("Socket send failed"));
      }
    });
  }
  async detachPane(pane: string) {
    await this.request("close-pane", { pane });
  }
  notify(op: string, args: any) {
    if (this.socket?.readyState === 1) {
      try {
        this.socket.send(
          JSON.stringify({ v: 1, type: "browser-notify", op, args }),
          () => {},
        );
      } catch {
        // Best-effort notification: socket close/rebind owns transport recovery.
        // In particular a failed close notification must not interrupt teardown.
      }
    }
  }
  private receipt(proof: any, kind: string, nonce: string, transport?: string) {
    if (
      !proof ||
      typeof proof.payload !== "string" ||
      proof.payload.length > 6 * 1024 * 1024
    )
      throw Error("Signed SSH acknowledgment required");
    const payload = Buffer.from(proof.payload, "base64");
    this.authority.verifyCallback(payload, proof.signature);
    const r = JSON.parse(payload.toString());
    if (
      r.agent !== this.settings.agent.id ||
      r.type !== kind ||
      r.nonce !== nonce ||
      r.username !== this.username ||
      !Number.isSafeInteger(r.expires) ||
      r.expires <= Date.now() ||
      r.expires > Date.now() + 125000 ||
      (transport !== undefined && r.transport !== transport)
    )
      throw Error("SSH acknowledgment scope rejected");
    if (r.error) throw Error(r.error);
    return r;
  }
  override async connect(
    _dialogue: Dialogue,
    options: {
      exam?: string;
      timeoutMs?: number;
      continuation?: { id: string; generation: number; expires: number };
    } = {},
  ) {
    const issued = Date.now(),
      relay = this.settings.browserSSH!;
    const payload = Buffer.from(
      JSON.stringify({
        audience: relay.audience,
        op: "relay-connect",
        nonce: randomUUID(),
        issued,
        expires: issued + 30000,
        origin: this.settings.origin,
        target: "sshjump.depaul.edu:22",
        username: this.username,
        exam: this.exam,
      }),
    );
    const ticket = {
      payload: payload.toString("base64"),
      signature: sign(
        null,
        payload,
        readFileSync(this.settings.agent.signingKey),
      ).toString("base64"),
    };
    let sshAuthenticated = false;
    try {
      await this.request("connect", {
        url: relay.relay,
        ticket,
        username: this.username,
        jump: this.settings.jump,
        class: this.settings.class,
        controlToken: this.controlToken,
      });
      sshAuthenticated = true;
      this.alive = true;
      const result = await this.command("register", {
        exam: this.exam,
        continuation: options.continuation,
      });
      this.transport = result.transport;
      this.authority.bind(this);
    } catch (e) {
      const publicMessage = sshAuthenticated
        ? "SSH sign-in succeeded, but the exam server could not admit this account. Contact your instructor to check the account’s exam-server setup. No new exam was started."
        : "SSH sign-in failed. Check your shared password and challenge approval. If it still fails, contact your instructor to check the server connection.";
      // Closing first discards the error queued by the auth route: the browser
      // only sees a close and silently returns to the sign-in form.
      if (this.socket?.readyState === 1)
        this.socket.send(
          JSON.stringify({ v: 1, type: "error", error: publicMessage }),
        );
      this.close();
      throw Object.assign(e instanceof Error ? e : Error("SSH login failed"), {
        publicMessage,
        authenticationStage: sshAuthenticated
          ? "exam-admission"
          : "ssh-authentication",
      });
    }
  }
  override async command(op: string, body: any = {}) {
    if (!this.alive)
      throw new AgentCommandDisconnectedError("SSH transports unavailable");
    const frame = this.authority.sign(op, this.username, this.transport, {
      ...body,
      browser_ssh: true,
    });
    const nonce = JSON.parse(
      Buffer.from(frame.payload, "base64").toString(),
    ).nonce;
    const response = await this.request("command", frame);
    const receipt = this.receipt(
      response?.proof,
      "ssh-command-receipt",
      nonce,
      op === "register" ? undefined : this.transport,
    );
    if (
      op === "register" &&
      (!receipt.transport || receipt.result?.transport !== receipt.transport)
    )
      throw Error("Invalid SSH registration");
    return receipt.result;
  }
  override async open(attempt: string, pane: string, purpose = "exam") {
    if (this.panes.has(pane) || this.opening.has(pane))
      throw Error("Terminal already opening or open");
    const opening = { closed: false };
    this.opening.set(pane, opening);
    try {
      const admission = await this.command("issue-channel-admission", {
        id: attempt,
        pane,
        transport: this.transport,
        username: this.username,
        purpose,
      });
      const acknowledgment = await this.request(
        "open",
        { pane, token: admission.token },
        15000,
      );
      const receipt = this.receipt(
        acknowledgment?.proof,
        "ssh-pane-receipt",
        createHash("sha256").update(admission.token).digest("hex"),
        this.transport,
      );
      if (receipt.result?.attempt !== attempt || receipt.result?.pane !== pane)
        throw Error("Pane acknowledgment mismatch");
      const channel = new BrowserPane(pane, attempt, this);
      if (!this.alive || this.closed)
        throw new AgentCommandDisconnectedError(
          "SSH connection ended during terminal admission",
        );
      if (opening.closed) channel.dispose();
      else this.panes.set(pane, channel as any);
      return channel as any;
    } finally {
      this.opening.delete(pane);
    }
  }
  override close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.detachment);
    this.notify("close", {});
    this.alive = false;
    this.authority.unbind(this);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new AgentCommandDisconnectedError("SSH connection ended"));
    }
    this.pending.clear();
    this.opening.clear();
    // Whole-transport teardown is local: the close notification already asks
    // the browser to stop SSH. Awaited pane operations were rejected above.
    // Never start new browser RPCs after clearing pending requests: an orphaned
    // close request otherwise rejects two minutes later and crashes the process.
    for (const p of this.panes.values())
      if (p instanceof BrowserPane) p.dispose();
    this.panes.clear();
    this.socket?.close();
    this.socket = undefined;
  }
}
