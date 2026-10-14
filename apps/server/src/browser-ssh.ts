import { EventEmitter } from "node:events";
import { randomUUID, sign, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WebSocket } from "ws";
import { Connection, type Dialogue } from "./ssh.js";
import type { Agent } from "./agent.js";
import type { Config } from "../../../packages/config/index.js";

class BrowserPane extends EventEmitter {
  writableLength = 0;
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
  async close() {
    if (this.owner.alive)
      await this.owner.command("close-pane", {
        id: this.attempt,
        pane: this.pane,
      });
    this.owner.notify("close-pane", { pane: this.pane });
    this.owner.panes.delete(this.pane);
    this.emit("close");
  }
}

// Only authorization and signed acknowledgments cross this control socket.
// Passwords, MFA prompts and PTY bytes stay in the browser/class-server path.
export class BrowserConnection extends Connection {
  readonly browser = true;
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
    this.socket = ws;
    for (const [id, p] of this.pending)
      ws.send(
        JSON.stringify({
          v: 1,
          type: "browser-request",
          id,
          op: p.op,
          args: p.args,
        }),
      );
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
    if (!this.socket || this.socket.readyState !== 1)
      return Promise.reject(
        Error("Browser SSH control connection unavailable"),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Browser SSH operation timed out"));
      }, timeout);
      this.pending.set(id, { op, args, resolve, reject, timer });
      this.socket!.send(
        JSON.stringify({ v: 1, type: "browser-request", id, op, args }),
      );
    });
  }
  notify(op: string, args: any) {
    if (this.socket?.readyState === 1)
      this.socket.send(
        JSON.stringify({ v: 1, type: "browser-notify", op, args }),
      );
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
    try {
      await this.request("connect", {
        url: relay.relay,
        ticket,
        username: this.username,
        jump: this.settings.jump,
        class: this.settings.class,
        controlToken: this.controlToken,
      });
      this.alive = true;
      const result = await this.command("register", {
        continuation: options.continuation,
      });
      this.transport = result.transport;
      this.authority.bind(this);
    } catch (e) {
      this.close();
      throw e;
    }
  }
  override async command(op: string, body: any = {}) {
    if (!this.alive) throw Error("SSH transports unavailable");
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
    this.panes.set(pane, channel as any);
    return channel as any;
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
      p.reject(Error("SSH connection ended"));
    }
    this.pending.clear();
    for (const p of this.panes.values()) p.close();
    this.panes.clear();
    this.socket?.close();
    this.socket = undefined;
  }
}
