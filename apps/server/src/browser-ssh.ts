import { EventEmitter } from "node:events";
import { randomUUID, sign, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WebSocket } from "ws";
import { Connection, type Dialogue } from "./ssh.js";
import type { CapturedPaneInput } from "../../../packages/protocol/index.js";
import { monitoringOwner } from "../../../packages/protocol/monitoring-evidence.js";
import { AgentCommandDisconnectedError, type Agent } from "./agent.js";
import type { Config } from "../../../packages/config/index.js";

class BrowserPane extends EventEmitter {
  writableLength = 0;
  private disposed = false;
  private closing?: Promise<void>;
  readonly outputEpoch?: string;
  constructor(
    public pane: string,
    readonly attempt: string,
    private owner: BrowserConnection,
    public inputEpoch?: string,
    outputEpoch = inputEpoch,
  ) {
    super();
    this.outputEpoch = outputEpoch;
  }
  write(data: string) {
    if (this.inputEpoch)
      throw Error("Native framed pane context required; raw input refused");
    this.owner.notify("input", { pane: this.pane, data });
    return true;
  }
  setWindow(rows: number, cols: number) {
    if (this.inputEpoch)
      throw Error("Native framed pane context required; raw resize refused");
    this.owner.notify("resize", { pane: this.pane, rows, cols });
  }
  writeInputFrame(input: CapturedPaneInput, data: string) {
    if (!this.inputEpoch || input?.epoch !== this.inputEpoch)
      throw Error("Stale native pane input context; no input sent");
    this.owner.notify("input-framed", {
      pane: this.pane,
      epoch: input.epoch,
      sequence: input.sequence,
      data,
    });
    return true;
  }
  resizeInputFrame(input: CapturedPaneInput, rows: number, cols: number) {
    if (!this.inputEpoch || input?.epoch !== this.inputEpoch)
      throw Error("Stale native pane input context; no resize sent");
    this.owner.notify("resize-framed", {
      pane: this.pane,
      epoch: input.epoch,
      sequence: input.sequence,
      rows,
      cols,
    });
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
  protected override browserCommands = true;
  private commandCancellationSupported = false;
  private framedInputSupported = false;
  private retainedInputSupported = false;
  private retainedControlSupported = false;
  private retainedRestoreSupported = false;
  private retainedPolicyReportsSupported = false;
  private retainedTransport = "";
  override async prepareMonitoring() {
    if (!this.retainedMonitoringRequired) return false;
    if (
      !this.framedPaneInput ||
      !this.framedInputSupported ||
      !this.retainedInputSupported ||
      !this.retainedControlSupported ||
      !this.retainedRestoreSupported ||
      !this.retainedPolicyReportsSupported
    )
      throw Error(
        "Loaded browser, WASM and native monitoring versions disagree. Preserve the preparation and load matching versions before Begin; no new clock has started.",
      );
    return true;
  }
  private browserFeatures(connected: any) {
    this.commandCancellationSupported = connected?.command_cancel === true;
    this.framedInputSupported =
      connected?.framed_input === true && connected?.loaded_pane_input === "v1";
    this.retainedInputSupported =
      connected?.pane_epoch_change === true &&
      connected?.loaded_pane_epoch_change === "v1";
    this.retainedControlSupported =
      connected?.loaded_control_retention === "v1";
    this.retainedRestoreSupported = connected?.loaded_control_restore === "v1";
    this.retainedPolicyReportsSupported =
      connected?.loaded_policy_reports === "v1";
  }
  async restoreRetained(raw: unknown) {
    const owner = monitoringOwner.parse(raw);
    const offered = await this.request(
      "retained-control",
      { owner, controlToken: this.controlToken },
      5000,
    );
    this.browserFeatures(offered);
    if (
      offered?.retained_control !== "v1" ||
      !this.framedInputSupported ||
      !this.retainedInputSupported ||
      !this.retainedControlSupported ||
      !this.retainedRestoreSupported ||
      !this.retainedPolicyReportsSupported ||
      !Array.isArray(offered.panes) ||
      offered.panes.length > 4
    )
      throw Error(
        "Matching retained control versions required; preserve the live SSH and original attempt",
      );
    // A recorded transport is only a candidate. The signed command's native
    // peer/registration checks prove that this is the SAME authenticated SSH.
    this.transport = owner.transport_hash;
    this.alive = true;
    const remote = await this.command("inspect-attempt", { id: owner.attempt });
    const observed = monitoringOwner.parse(remote?.registered_owner);
    if (
      remote?.monitoring_mode !== "v1" ||
      remote.browser_ssh !== true ||
      remote.terminal_supervised !== true ||
      !remote.start ||
      !["ACTIVE", "LOCKED"].includes(remote.state) ||
      JSON.stringify(observed) !== JSON.stringify(owner) ||
      remote.id !== owner.attempt ||
      remote.username !== this.username ||
      remote.exam !== this.exam ||
      remote.uid !== owner.uid ||
      remote.transport !== owner.transport_hash ||
      remote.boot !== owner.boot ||
      remote.protected ||
      remote.checksum ||
      remote.deadline <= Date.now() ||
      (remote.clock_revision || 0) !== owner.clock_revision
    )
      throw Error(
        "Current native retained owner differs; preserve SSH and retry current-page verification",
      );
    await this.authority.confirmRegisteredPaneOwner(
      owner.attempt,
      observed,
      this.username,
    );
    const hints = new Map<
      string,
      { pane: string; input_epoch: string; pane_instance: string }
    >();
    for (const hint of offered.panes) {
      if (
        !/^[a-f0-9-]{36}$/.test(hint?.pane || "") ||
        hints.has(hint.pane) ||
        !/^[a-f0-9]{64}$/.test(hint.input_epoch || "") ||
        !/^[a-f0-9]{64}$/.test(hint.pane_instance || "")
      )
        throw Error(
          "Retained pane routing is incomplete; no channel or capability created",
        );
      hints.set(hint.pane, hint);
    }
    this.framedPaneInput = true;
    this.retainedMonitoringRequired = true;
    this.retainedTransport = owner.transport_hash;
    for (const hint of hints.values())
      this.panes.set(
        hint.pane,
        new BrowserPane(
          hint.pane,
          owner.attempt,
          this,
          hint.input_epoch,
          hint.pane_instance,
        ) as any,
      );
    return { attempt: remote, panes: [...hints.values()] };
  }
  override async command(op: string, body: any = {}) {
    const result = await super.command(op, body);
    // The base command has verified the native signed reply and its current
    // gateway observation. Retaining an existing transport grants no execution
    // permission and lasts only until explicit loss/secured cleanup closes it.
    const remote = result?.attempt ?? result;
    if (
      this.retainedMonitoringRequired &&
      this.retainedControlSupported &&
      remote?.monitoring_mode === "v1" &&
      remote.start > 0 &&
      remote.browser_ssh === true &&
      remote.terminal_supervised === true &&
      ["ACTIVE", "LOCKED", "FINALIZING", "COLLECTION_FAILED"].includes(
        remote.state,
      )
    ) {
      const owner = monitoringOwner.safeParse(remote.registered_owner);
      if (
        owner.success &&
        owner.data.attempt === remote.id &&
        owner.data.exam === this.exam &&
        owner.data.username === this.username &&
        owner.data.uid === remote.uid &&
        owner.data.transport_hash === this.transport &&
        owner.data.boot === remote.boot &&
        owner.data.clock_revision === (remote.clock_revision || 0)
      )
        this.retainedTransport = owner.data.transport_hash;
    }
    return result;
  }
  private hasRetainedTransport() {
    return (
      this.alive &&
      !!this.transport &&
      this.retainedTransport === this.transport
    );
  }
  protected override canUseFramedPaneInput() {
    return this.framedInputSupported;
  }
  protected override canRecoverRenewalReceipts() {
    return this.commandCancellationSupported;
  }
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
  private detachedAt: number | null = null;
  private closed = false;
  private opening = new Map<string, { closed: boolean; inputEpoch?: string }>();
  constructor(
    user: string,
    private exam: string,
    private settings: Config,
    private authority: Agent,
    ws: WebSocket,
    private preserveTransportOnClose = false,
  ) {
    super(user, settings, authority);
    this.attach(ws);
  }
  attach(ws: WebSocket) {
    if (this.closed) throw Error("SSH connection ended");
    // Timer dispatch may be delayed by the event loop. Never let a late bind
    // extend the server's recovery grace merely by clearing an overdue timer.
    if (
      !this.hasRetainedTransport() &&
      this.detachedAt !== null &&
      performance.now() - this.detachedAt >= 15000
    ) {
      this.alive = false;
      this.onLoss();
      this.close();
      throw new AgentCommandDisconnectedError(
        "SSH recovery grace expired; fresh authentication is required",
      );
    }
    clearTimeout(this.detachment);
    this.detachedAt = null;
    const previous = this.socket;
    this.socket = ws;
    if (previous && previous !== ws) previous.close(1000, "Control replaced");
    ws.on("close", () => {
      if (this.socket !== ws) return;
      this.socket = undefined;
      if (!this.alive) this.close();
      else {
        this.detachedAt = performance.now();
        this.detachment = setTimeout(() => {
          if (this.hasRetainedTransport()) return;
          this.alive = false;
          this.onLoss();
          this.close();
        }, 15000);
      }
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
      const opening = this.opening.get(m.pane);
      const expected = m.pane_instance
        ? pane?.outputEpoch || opening?.inputEpoch
        : pane?.inputEpoch || opening?.inputEpoch;
      const received = m.pane_instance || m.input_epoch;
      if ((received || expected) && received !== expected) return true;
      if (pane instanceof BrowserPane) pane.dispose();
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
  private request(
    op: string,
    args: any,
    timeout = 120000,
    id = randomUUID(),
  ): Promise<any> {
    if (this.closed || !this.socket || this.socket.readyState !== 1)
      return Promise.reject(
        new AgentCommandDisconnectedError(
          "Browser SSH control connection unavailable",
        ),
      );
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
  private epochChanges: Promise<unknown> = Promise.resolve();
  override changeInputEpochs(attempt: string, epochs: Record<string, string>) {
    // Serialize retries/completions, and retain the actual channel object across
    // each await. A reused UI UUID must never inherit an older pane's outcome.
    const channels = [...this.panes].map(([id, channel]) => {
      if (
        !(channel instanceof BrowserPane) ||
        channel.attempt !== attempt ||
        !channel.inputEpoch ||
        !/^[a-f0-9]{64}$/.test(epochs?.[id] || "")
      )
        throw Error(
          "Retained pane input agreement is incomplete. Preserve the panes and retry native Continue with matching versions.",
        );
      return { id, channel, next: epochs[id] };
    });
    const change = this.epochChanges.then(async () => {
      const result: Record<string, { instance: string; epoch: string }> = {};
      for (const { id, channel, next } of channels) {
        if (!this.alive || this.panes.get(id) !== channel)
          throw Error(
            "Terminal changed during continuation; no replacement pane was reauthorized.",
          );
        if (channel.inputEpoch !== next) {
          const previous = channel.inputEpoch;
          await this.request(
            "change-input-epoch",
            {
              pane: id,
              previous,
              next,
              instance: channel.outputEpoch,
            },
            15000,
          );
          if (
            !this.alive ||
            this.panes.get(id) !== channel ||
            channel.inputEpoch !== previous
          )
            throw Error(
              "Terminal changed during continuation; preserve the current pane and retry.",
            );
          channel.inputEpoch = next;
        }
        result[id] = { instance: channel.outputEpoch!, epoch: next };
      }
      return result;
    });
    this.epochChanges = change.catch(() => {});
    return change;
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
      const connected = await this.request("connect", {
        url: relay.relay,
        ticket,
        username: this.username,
        jump: this.settings.jump,
        class: this.settings.class,
        controlToken: this.controlToken,
      });
      this.browserFeatures(connected);
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
  protected override exchangeCommand(
    frame: any,
    nonce: string,
    timeout = 120000,
  ) {
    const id = randomUUID();
    const promise = this.request("command", frame, timeout, id);
    if (timeout < 120000 && this.commandCancellationSupported)
      void promise.catch(() => this.notify("cancel-command", { nonce }));
    return {
      promise,
      cancel: async () => {
        try {
          await this.request("cancel-command", { nonce }, 1000);
        } finally {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(
              Error(
                "Exact command RPC retired after verified receipt recovery",
              ),
            );
          }
        }
      },
    };
  }
  override async open(attempt: string, pane: string, purpose = "exam") {
    if (this.panes.has(pane) || this.opening.has(pane))
      throw Error("Terminal already opening or open");
    const opening: { closed: boolean; inputEpoch?: string } = { closed: false };
    this.opening.set(pane, opening);
    let requested = false;
    try {
      const admission = await this.command("issue-channel-admission", {
        id: attempt,
        pane,
        transport: this.transport,
        username: this.username,
        purpose,
        framed_input:
          purpose === "exam" &&
          this.framedPaneInput &&
          this.canUseFramedPaneInput(),
      });
      opening.inputEpoch = admission.input_epoch;
      requested = true;
      const acknowledgment = await this.request(
        "open",
        { pane, token: admission.token, input_epoch: admission.input_epoch },
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
      if (
        admission.input_epoch &&
        (receipt.result?.input_epoch !== admission.input_epoch ||
          receipt.result?.input_protocol !== "v1")
      )
        throw Error(
          "Native framed pane acknowledgment mismatch; no raw fallback is authorized",
        );
      await this.authority.confirmRegisteredPaneOwner(
        attempt,
        receipt.result?.registered_owner,
      );
      const channel = new BrowserPane(
        pane,
        attempt,
        this,
        admission.input_epoch,
      );
      if (!this.alive || this.closed)
        throw new AgentCommandDisconnectedError(
          "SSH connection ended during terminal admission",
        );
      if (opening.closed) channel.dispose();
      else this.panes.set(pane, channel as any);
      return channel as any;
    } catch (error) {
      // A valid native pane may already exist when its receipt/current page
      // disagrees. Close only that browser channel; do not expose it as usable
      // or tear down healthy siblings. This best-effort request is not proof of
      // native cleanup; the existing native lifetime/lease fences still apply.
      if (requested) this.notify("close-pane", { pane });
      throw error;
    } finally {
      this.opening.delete(pane);
    }
  }
  override close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.detachment);
    this.detachedAt = null;
    if (!this.preserveTransportOnClose) this.notify("close", {});
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
