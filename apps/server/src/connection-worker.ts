import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import {
  Agent,
  AgentCommandDisconnectedError,
  AgentCommandStateError,
} from "./agent.js";
import { BrowserConnection } from "./browser-ssh.js";
import { Connection } from "./ssh.js";

// Never install a catch-and-continue uncaught-exception handler. A broken attempt
// exits; only its supervising HTTP process decides how to report and recover it.
try {
  writeFileSync("/proc/self/oom_score_adj", "500");
} catch {
  /* Non-Linux development hosts. */
}
let connection: Connection;
let sequence = 0;
const answers = new Map<number, (answers: string[]) => void>();
const sockets = new Map<number, WorkerSocket>();
let queued = 0;
function send(message: any) {
  if (!process.connected) {
    process.exit(0);
  }
  const bytes =
    message.kind === "pane-data"
      ? message.data.length + 128
      : Buffer.byteLength(JSON.stringify(message));
  if (bytes > 8 * 1024 * 1024 || queued + bytes > 16 * 1024 * 1024)
    process.exit(1);
  queued += bytes;
  process.send!(message, (error: Error | null) => {
    queued -= bytes;
    if (error) process.exit(1);
  });
}
class WorkerSocket extends EventEmitter {
  readyState = 1;
  constructor(readonly id: number) {
    super();
  }
  send(data: string, callback?: (error?: Error) => void) {
    send({ kind: "socket-send", socket: this.id, data });
    callback?.();
  }
  close(code = 1000, reason = "") {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    send({ kind: "socket-end", socket: this.id, code, reason });
    this.emit("close");
  }
}
function socket(id: number) {
  const value = new WorkerSocket(id);
  sockets.set(id, value);
  return value;
}
process.on("disconnect", () => process.exit(0));
process.on("message", async (m: any) => {
  if (m.kind === "init") {
    const authority = new Agent(m.config.agent);
    connection = m.browser
      ? new BrowserConnection(
          m.username,
          m.exam,
          m.config,
          authority,
          socket(m.socket) as any,
        )
      : new Connection(m.username, m.config, authority);
    if (m.browser) Object.assign(connection, { controlToken: m.controlToken });
    connection.onLoss = () => send({ kind: "loss" });
    connection.onDiagnostic = (host, detail) =>
      send({ kind: "diagnostic", host, detail });
  } else if (m.kind === "ping") send({ kind: "pong" });
  else if (m.kind === "shutdown") {
    connection?.close();
    process.exit(0);
  } else if (m.kind === "socket-close") {
    const value = sockets.get(m.socket);
    sockets.delete(m.socket);
    if (value) {
      value.readyState = 3;
      value.emit("close");
    }
  } else if (m.kind === "browser-message")
    (connection as BrowserConnection).receive(m.message);
  else if (m.kind === "answers") {
    answers.get(m.id)?.(m.answers);
    answers.delete(m.id);
  } else if (m.kind === "pane") {
    const pane = connection.panes.get(m.pane);
    if (!pane) return;
    switch (m.op) {
      case "write":
        pane.write(m.args[0]);
        break;
      case "setWindow":
        pane.setWindow(m.args[0], m.args[1], 0, 0);
        break;
      case "pause":
        pane.pause();
        break;
      case "resume":
        pane.resume();
        break;
    }
  } else if (m.kind === "rpc") {
    try {
      let result: any;
      switch (m.op) {
        case "attach":
          (connection as BrowserConnection).attach(socket(m.args[0]) as any);
          break;
        case "connect":
          await connection.connect(
            (host, instruction, prompts) =>
              new Promise((resolve) => {
                const id = ++sequence;
                answers.set(id, resolve);
                send({ kind: "dialogue", id, host, instruction, prompts });
              }),
            m.args[0],
          );
          break;
        case "secureAccess":
          await connection.secureAccess(m.args[0], m.args[1]);
          break;
        case "command":
          result = await connection.command(m.args[0], m.args[1]);
          break;
        case "open": {
          const [attempt, id, purpose] = m.args;
          const pane = await connection.open(attempt, id, purpose);
          pane.on("data", (data: Buffer) =>
            send({ kind: "pane-data", pane: id, data }),
          );
          pane.once("close", () => send({ kind: "pane-close", pane: id }));
          pane.pause();
          if (!connection.panes.has(id)) send({ kind: "pane-close", pane: id });
          break;
        }
        case "close-pane":
          await connection.panes.get(m.args[0])?.close();
          break;
        default:
          throw Error("Unsupported connection operation");
      }
      send({
        kind: "reply",
        id: m.id,
        result,
        alive: connection.alive,
        transport: connection.transport,
      });
    } catch (error: any) {
      send({
        kind: "reply",
        id: m.id,
        error: {
          message: error.message,
          disconnected: error instanceof AgentCommandDisconnectedError,
          attemptState:
            error instanceof AgentCommandStateError
              ? error.attemptState
              : undefined,
          publicMessage: error.publicMessage,
          authenticationStage: error.authenticationStage,
        },
        alive: connection?.alive,
        transport: connection?.transport,
      });
    }
  }
});
