// Private browser-fixture adapter: SSH/relay remain in the parent while the
// actual HTTP application lives in a killable child. Never imported by runtime.
import { fork, type ChildProcess } from "node:child_process";
import { lstatSync, writeFileSync } from "node:fs";
import type { createApp } from "../../apps/server/src/app.js";
import { Store } from "../../apps/server/src/db.js";

type Config = Parameters<typeof createApp>[0];
type App = Awaited<ReturnType<typeof createApp>>["app"];
export function browserGatewayProcess(
  config: Config,
  workerEntry: URL,
  options: { detached?: boolean } = {},
) {
  const store = new Store(config.data);
  const configFile = config.data + "/fixture-gateway.json";
  writeFileSync(configFile, JSON.stringify(config), {
    mode: 0o600,
    flag: "wx",
  });
  const directory = lstatSync(config.data),
    file = lstatSync(configFile);
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid!() ||
    (directory.mode & 0o777) !== 0o700 ||
    !file.isFile() ||
    file.nlink !== 1 ||
    file.uid !== process.getuid!() ||
    (file.mode & 0o777) !== 0o600
  )
    throw Error("Private gateway fixture identity/modes unavailable");
  const routes = new Map<string, (req: any) => any>();
  const closeHooks: (() => Promise<unknown>)[] = [];
  let child: ChildProcess,
    sequence = 0,
    ready: Promise<void>;
  let stopping = false;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  const call = async (op: string, args?: any) => {
    await ready;
    if (!child.connected || pending.size >= 64)
      throw Error("Fixture gateway unavailable/busy");
    const target = child,
      id = ++sequence;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Fixture gateway operation timed out: " + op));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      target.send({ kind: "call", id, op, args }, (error) => {
        if (!error) return;
        const p = pending.get(id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.reject(Error("Fixture gateway IPC unavailable"));
        }
      });
    });
  };
  const launch = () => {
    child = fork(
      new URL("./browser-gateway-child.ts", import.meta.url),
      [configFile, workerEntry.href],
      {
        execArgv: ["--import", "tsx", "--unhandled-rejections=strict"],
        env: {
          PATH: process.env.PATH,
          LANG: "C.UTF-8",
          TZ: process.env.TZ,
          NODE_ENV: "test",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "advanced",
        detached: options.detached ?? false,
      },
    );
    const target = child;
    let detail = "",
      settled = false;
    target.stderr?.on("data", (chunk) => {
      detail = (detail + String(chunk)).slice(-4096);
    });
    ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          target.kill("SIGKILL");
          reject(Error("Fixture gateway startup timed out: " + detail));
        }
      }, 15000);
      target.on("message", async (message: any) => {
        if (target !== child) return;
        if (message?.kind === "ready") {
          settled = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message?.kind === "reply") {
          const p = pending.get(message.id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.delete(message.id);
          if (message.error) p.reject(Error(String(message.error)));
          else p.resolve(message.result);
        } else if (message?.kind === "fixture-route") {
          try {
            const handler = routes.get(message.route);
            if (!handler) throw Error("Unknown private fixture route");
            const result = await handler(message.request);
            if (target.connected)
              target.send({ kind: "fixture-result", id: message.id, result });
          } catch (error) {
            if (target.connected)
              target.send({
                kind: "fixture-result",
                id: message.id,
                error: String(error),
              });
          }
        }
      });
      const lost = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(Error("Fixture gateway startup failed: " + detail));
        }
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(Error("Fixture gateway exited"));
        }
        pending.clear();
      };
      target.once("error", lost);
      target.once("exit", lost);
    });
  };
  launch();
  const listen = async () => call("start", { routes: [...routes.keys()] });
  const facade = {
    get(path: string, handler: any) {
      routes.set("GET " + path, handler);
      return facade;
    },
    post(path: string, handler: any) {
      routes.set("POST " + path, handler);
      return facade;
    },
    addHook(_name: string, handler: any) {
      closeHooks.push(handler);
      return facade;
    },
    async inject(options: any) {
      const result = await call("inject", options);
      return { ...result, json: () => JSON.parse(result.body) };
    },
    listen,
    async close() {
      if (stopping) return;
      stopping = true;
      for (const hook of closeHooks) await hook();
      if (child.connected) await call("shutdown");
      store.close();
    },
  };
  return {
    app: facade as unknown as App,
    store,
    initialized: ready!,
    get pid() {
      return child.pid;
    },
    workers: () => call("workers"),
    fault: (username: string, fault: string) =>
      call("fault", { username, fault }),
    async restart(mode: "kill" | "graceful" = "kill") {
      const target = child,
        previous = target.pid;
      // Subscribe before the shutdown RPC: its reply/disconnect/exit can race.
      const exit = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Owned fixture gateway did not exit")),
          5000,
        );
        target.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        if (mode === "kill" && !target.kill("SIGKILL")) {
          clearTimeout(timer);
          reject(Error("Owned fixture gateway kill failed"));
        }
      });
      if (mode === "graceful") await Promise.all([call("shutdown"), exit]);
      else await exit;
      launch();
      await listen();
      return { previous, current: child.pid };
    },
  };
}
