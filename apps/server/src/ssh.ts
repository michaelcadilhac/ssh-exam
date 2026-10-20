import ssh2 from "ssh2";
import type { Client as SSHClient, ClientChannel, ConnectConfig } from "ssh2";
const { Client } = ssh2;
import type { Config } from "../../../packages/config/index.js";
import {
  AgentCommandDisconnectedError,
  AgentCommandStateError,
  type Agent,
} from "./agent.js";
import { LoginPassword, isPasswordPrompt } from "./login-password.js";
export type Dialogue = (
  host: string,
  instruction: string,
  prompts: { prompt: string; echo: boolean }[],
) => Promise<string[]>;
export class Connection {
  get supportsAutomaticHandoff(): boolean {
    return false;
  }
  async secureAccess(_id: string, _exam: string): Promise<void> {
    throw Error("Automatic exam setup requires browser SSH.");
  }
  jump = new Client();
  class = new Client();
  panes = new Map<string, ClientChannel>();
  transport = "";
  alive = false;
  onLoss = () => {};
  onDiagnostic = (host: string, detail: string) => {};
  constructor(
    public username: string,
    private config: Config,
    private agent: Agent,
  ) {}
  private authentication?: {
    password: LoginPassword;
    dialogue?: Dialogue;
    cancelled: boolean;
  };
  private cancelAuthentication?: () => void;
  async connect(
    dialogue: Dialogue,
    options: {
      exam?: string;
      timeoutMs?: number;
      continuation?: { id: string; generation: number; expires: number };
    } = {},
  ) {
    if (this.authentication || this.alive)
      throw Error("SSH connection already in use");
    const attempt = {
      password: new LoginPassword(),
      dialogue: dialogue as Dialogue | undefined,
      cancelled: false,
    };
    this.authentication = attempt;
    // Long-lived event closures refer only to this clearable attempt, never to a password string.
    dialogue = async () => {
      throw Error("Authentication ended");
    };
    const cleanups: (() => void)[] = [];
    const copies = new Set<Buffer>();
    const release = () => {
      attempt.cancelled = true;
      attempt.password.clear();
      for (const copy of copies) copy.fill(0);
      copies.clear();
      attempt.dialogue = undefined;
      clearTimeout(timeout);
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      if (this.authentication === attempt) this.authentication = undefined;
      this.cancelAuthentication = undefined;
    };
    this.cancelAuthentication = release;
    const timeout = setTimeout(() => this.close(), options.timeoutMs ?? 120000);
    const ask = async (
      host: string,
      instruction: string,
      prompts: { prompt: string; echo: boolean }[],
    ) => {
      if (attempt.cancelled || !attempt.dialogue)
        throw Error("Authentication ended");
      const answers = await attempt.dialogue(host, instruction, prompts);
      if (attempt.cancelled) {
        answers.fill("");
        throw Error("Authentication ended");
      }
      return answers;
    };
    const shared = async (host: string, instruction: string) => {
      if (!attempt.password.available) {
        const answers = await ask(host, instruction, [
          { prompt: "Shared SSH password", echo: false },
        ]);
        attempt.password.capture(answers);
      }
      const copy = attempt.password.copy();
      copies.add(copy);
      return copy;
    };
    const hop = async (client: SSHClient, host: Config["jump"], sock?: any) =>
      new Promise<void>((resolve, reject) => {
        const methods = new Set<string>();
        const label =
          host.port === 22 ? host.host : `${host.host}:${host.port}`;
        let verified = false,
          passwordSent = false,
          finished = false,
          partialKeyboard = false;
        let connectOptions: ConnectConfig;
        const cleanupAuth = () => {
          client.off("keyboard-interactive", keyboard);
          client.off("banner", banner);
          client.off("change password", changePassword);
          if (connectOptions) connectOptions.authHandler = undefined;
          const stored = (client as any).config;
          if (stored) {
            stored.password = undefined;
            stored.authHandler = undefined;
          }
        };
        cleanups.push(cleanupAuth);
        const fail = () => {
          if (!finished) {
            finished = true;
            release();
            reject(Error("SSH authentication or connection failed"));
          } else if (this.alive) {
            this.alive = false;
            this.onLoss();
          }
        };
        const terminate = () => {
          fail();
          this.close();
        };
        client.on("error", fail);
        client.on("close", fail);
        const banner = (message: string) => {
          void ask(label, message, []).catch(terminate);
        };
        const changePassword = () => terminate(); // Password changes require a separate, fresh workflow.
        const keyboard = (
          name: string,
          instructions: string,
          _lang: string,
          prompts: { prompt: string; echo: boolean }[],
          finish: (answers: string[]) => void,
        ) => {
          void (async () => {
            if (!verified || attempt.cancelled || prompts.length > 16)
              throw Error("Unverified or ended authentication");
            const instruction = [name, instructions].filter(Boolean).join("\n");
            const passwordSlots = prompts.flatMap((p, i) =>
              isPasswordPrompt(p, this.username, host.host) ? [i] : [],
            );
            if (
              passwordSlots.length > 1 ||
              (passwordSlots.length && passwordSent)
            )
              throw Error("Repeated password request rejected");
            const automatic = passwordSlots[0];
            let password: Buffer | undefined;
            let answers: string[] = [],
              manual: string[] = [];
            try {
              if (automatic !== undefined) {
                passwordSent = true;
                password = await shared(label, instruction);
              }
              const remaining = prompts.filter((_p, i) => i !== automatic);
              // Every other prompt, including hidden OTP/passcode fields, remains explicit.
              if (remaining.length || automatic === undefined)
                manual = await ask(label, instruction, remaining);
              else
                await ask(
                  label,
                  instruction || "Authenticating with the shared SSH password.",
                  [],
                );
              if (attempt.cancelled) throw Error("Authentication ended");
              if (manual.length !== remaining.length)
                throw Error("Invalid challenge response");
              let index = 0;
              answers = prompts.map((_p, i) =>
                i === automatic ? password!.toString("utf8") : manual[index++],
              );
              finish(answers); // ssh2 synchronously serializes these strings; it does not retain this array.
            } finally {
              password?.fill(0);
              if (password) copies.delete(password);
              answers.fill("");
              manual.fill("");
            }
          })().catch(terminate);
        };
        // ssh2 also supports Buffer passwords; its published typings omit that runtime support.
        (client as any).on("keyboard-interactive", keyboard);
        client.on("banner", banner);
        client.on("change password", changePassword);
        client.once("ready", () => {
          if (attempt.cancelled) {
            terminate();
            return;
          }
          finished = true;
          cleanupAuth();
          resolve();
        });
        connectOptions = {
          host: host.host,
          port: host.port,
          username: this.username,
          sock,
          hostHash: "sha256",
          hostVerifier: (key: string | Buffer) => {
            verified = host.pins.includes(String(key));
            if (!verified)
              this.onDiagnostic(
                host.host,
                "SSH host-key pin mismatch; received SHA256(hex): " +
                  String(key),
              );
            return verified;
          },
          readyTimeout: options.timeoutMs ?? 120000,
          keepaliveInterval: 5000,
          keepaliveCountMax: 2,
          tryKeyboard: true,
          authHandler: (left, partial, next) => {
            if (!verified || attempt.cancelled) {
              (next as any)(false);
              return;
            }
            if (left === null) {
              next("none");
              return;
            }
            // A rejection never causes the same password to be tried using another method.
            if (passwordSent && !partial) {
              (next as any)(false);
              return;
            }
            if (
              left.includes("keyboard-interactive") &&
              (!methods.has("keyboard-interactive") ||
                (partial && !partialKeyboard))
            ) {
              if (methods.has("keyboard-interactive")) partialKeyboard = true;
              methods.add("keyboard-interactive");
              next("keyboard-interactive");
              return;
            }
            if (
              left.includes("password") &&
              !methods.has("password") &&
              !passwordSent
            ) {
              methods.add("password");
              passwordSent = true;
              void (async () => {
                const password = await shared(
                  label,
                  "Enter the shared SSH password for both configured hosts.",
                );
                const authentication = {
                  type: "password" as const,
                  username: this.username,
                  password,
                };
                try {
                  if (attempt.cancelled) throw Error("Authentication ended");
                  await ask(
                    label,
                    "Authenticating with the shared SSH password.",
                    [],
                  );
                  if (attempt.cancelled) throw Error("Authentication ended");
                  (next as any)(authentication);
                } finally {
                  password.fill(0);
                  copies.delete(password);
                  // ssh2 clones the method object, but its Buffer refers to this now-zeroed copy.
                  (authentication as any).password = undefined;
                }
              })().catch(terminate);
              return;
            }
            (next as any)(false);
          },
        };
        client.connect(connectOptions);
      });
    try {
      await hop(this.jump, this.config.jump);
      const sock = await new Promise<any>((resolve, reject) =>
        this.jump.forwardOut(
          "127.0.0.1",
          0,
          this.config.class.host,
          this.config.class.port,
          (e, s) => (e ? reject(e) : resolve(s)),
        ),
      );
      await hop(this.class, this.config.class, sock);
      release(); // Drop credentials before any exam-agent registration or retained terminal use.
      this.alive = true;
      if (this.config.loginOnly) {
        if (this.config.mode !== "development")
          throw Error("Login-only testing requires development mode");
        return;
      }
      const result = await this.command("register", {
        exam: options.exam,
        continuation: options.continuation,
      });
      this.transport = result.transport;
      this.agent.bind?.(this);
    } catch {
      this.close();
      throw Error("SSH authentication or connection failed");
    } finally {
      release();
    }
  }
  async command(op: string, body: any = {}): Promise<any> {
    if (!this.alive)
      throw new AgentCommandDisconnectedError("SSH transports unavailable");
    const envelope = this.agent.sign(op, this.username, this.transport, body);
    return new Promise((resolve, reject) => {
      this.class.exec("exam-control", (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        if (!this.alive) {
          channel.close();
          reject(new AgentCommandDisconnectedError("SSH connection ended"));
          return;
        }
        let input = Buffer.alloc(0),
          settled = false;
        const finish = (error?: Error, value?: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.close();
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(
          () =>
            finish(Error("SSH agent command timed out; await status callback")),
          120000,
        );
        channel.on("error", (e: Error) => finish(e));
        channel.on("close", () =>
          finish(
            new AgentCommandDisconnectedError(
              "SSH command ended without acknowledgment",
            ),
          ),
        );
        channel.on("data", (chunk: Buffer) => {
          input = Buffer.concat([input, chunk]);
          if (input.length > 4 * 1024 * 1024) {
            finish(Error("Oversized agent response"));
            return;
          }
          const end = input.indexOf(10);
          if (end < 0) return;
          try {
            const response = JSON.parse(input.subarray(0, end).toString());
            finish(
              response.error
                ? new AgentCommandStateError(response.error, response.result)
                : undefined,
              response.result,
            );
          } catch {
            finish(Error("Invalid agent command response"));
          }
        });
        channel.write(JSON.stringify(envelope) + "\n");
      });
    });
  }
  private exec() {
    return new Promise<ClientChannel>((resolve, reject) =>
      this.class.exec(
        "exam-gateway",
        { pty: { term: "xterm-256color", cols: 100, rows: 30 } },
        (error, channel) => {
          if (error) return reject(error);
          // A channel can fail after admission, when handshake listeners have
          // been removed. Consume its error rather than crashing the gateway.
          channel.on("error", () => {});
          if (!this.alive) {
            channel.close();
            reject(new AgentCommandDisconnectedError("SSH connection ended"));
          } else resolve(channel);
        },
      ),
    );
  }
  private handshake(channel: ClientChannel, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let input = Buffer.alloc(0),
        sent = false,
        settled = false;
      const finish = (error?: Error, result?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel.off("data", data);
        channel.off("close", closed);
        channel.off("error", failed);
        if (error) {
          channel.close();
          reject(error);
        } else resolve(result);
      };
      const closed = () =>
        finish(
          new AgentCommandDisconnectedError(
            "Session gate closed before admission",
          ),
        );
      const failed = (error: Error) => finish(error);
      const timer = setTimeout(
        () => finish(Error("Controlled session gate timed out")),
        10000,
      );
      const data = (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
        if (input.length > 8192) return finish(Error("Invalid gate response"));
        let idx;
        while ((idx = input.indexOf(10)) >= 0) {
          const line = input.subarray(0, idx).toString().trim();
          input = input.subarray(idx + 1);
          if (line === "EXAM-GATE/1" && !sent) {
            sent = true;
            channel.write(JSON.stringify({ token }) + "\n");
          } else if (line.startsWith("EXAM-READY ")) {
            try {
              const result = JSON.parse(line.slice(11));
              channel.pause();
              if (input.length) channel.unshift(input);
              finish(undefined, result);
            } catch {
              finish(Error("Invalid gate response"));
            }
            return;
          } else if (line.startsWith("EXAM-ERROR")) {
            finish(Error("Class-server admission rejected"));
            return;
          }
        }
      };
      channel.on("data", data);
      channel.once("close", closed);
      channel.once("error", failed);
    });
  }
  async open(attempt: string, pane: string, purpose = "exam") {
    if (this.config.loginOnly)
      throw Error("Terminals are unavailable during login-only testing");
    if (!this.alive)
      throw new AgentCommandDisconnectedError("SSH transports unavailable");
    const admission = await this.command("issue-channel-admission", {
      id: attempt,
      pane,
      transport: this.transport,
      username: this.username,
      purpose,
    });
    const channel = await this.exec();
    await this.handshake(channel, admission.token);
    if (!this.alive) {
      channel.close();
      throw new AgentCommandDisconnectedError(
        "SSH connection ended during admission",
      );
    }
    this.panes.set(pane, channel);
    channel.once("close", () => this.panes.delete(pane));
    return channel;
  }
  close() {
    const authenticating = !!this.authentication;
    this.cancelAuthentication?.();
    this.alive = false;
    this.agent.unbind?.(this);
    for (const c of this.panes.values()) c.close();
    this.panes.clear();
    if (authenticating) {
      this.class.destroy();
      this.jump.destroy();
    } else {
      this.class.end();
      this.jump.end();
    }
  }
}
