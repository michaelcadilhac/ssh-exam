// Actual createApp child for opt-in local browser process-restart qualification.
// All fixture-only routes remain parent-owned; no production fault API exists.
import { readFileSync } from "node:fs";
import { createApp } from "../../apps/server/src/app.js";
import type { IsolatedConnection } from "../../apps/server/src/connection-process.js";
process.once("disconnect", () => process.exit(0));
if (!process.connected) throw Error("Private fixture parent required");
const workers: IsolatedConnection[] = [];
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { app } = await createApp(config, {
  connectionWorkerEntry: new URL(process.argv[3]),
  onConnection: (connection) => workers.push(connection),
});
const routes = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
let sequence = 0;
const send = (message: any) => {
  if (!process.connected) throw Error("Private fixture parent disconnected");
  process.send!(message, (error) => {
    if (error) process.exit(1);
  });
};
process.on("message", async (message: any) => {
  if (message?.kind === "fixture-result") {
    const p = routes.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    routes.delete(message.id);
    if (message.error) p.reject(Error(message.error));
    else p.resolve(message.result);
    return;
  }
  if (message?.kind !== "call") return;
  try {
    let result: any;
    switch (message.op) {
      case "start":
        for (const route of message.args.routes) {
          const space = route.indexOf(" ");
          app.route({
            method: route.slice(0, space),
            url: route.slice(space + 1),
            handler: (req) =>
              new Promise((resolve, reject) => {
                if (routes.size >= 64) {
                  reject(Error("Private fixture route capacity"));
                  return;
                }
                const id = ++sequence;
                const timer = setTimeout(() => {
                  routes.delete(id);
                  reject(Error("Private fixture route timed out"));
                }, 10000);
                routes.set(id, { resolve, reject, timer });
                send({
                  kind: "fixture-route",
                  id,
                  route,
                  request: {
                    body: req.body,
                    params: req.params,
                    query: req.query,
                  },
                });
              }),
          });
        }
        result = await app.listen({ host: "127.0.0.1", port: config.port });
        break;
      case "inject": {
        const reply = await app.inject(message.args);
        result = {
          statusCode: reply.statusCode,
          body: reply.body,
          headers: reply.headers,
        };
        break;
      }
      case "workers":
        result = workers
          .filter((w) => w.alive)
          .map((w: any) => ({ username: w.username, pid: w.child.pid }));
        break;
      case "fault": {
        const worker = workers.findLast(
          (w) => w.username === message.args.username && w.alive,
        ) as any;
        if (!worker) throw Error("No live private fixture worker");
        if (message.args.fault === "kill") worker.child.kill("SIGKILL");
        else
          worker.child.send({
            kind: "fixture-fault",
            fault: message.args.fault,
          });
        result = { pid: worker.child.pid };
        break;
      }
      case "shutdown":
        await app.close();
        send({ kind: "reply", id: message.id, result: { closed: true } });
        process.disconnect!();
        return;
      default:
        throw Error("Unknown private fixture operation");
    }
    send({ kind: "reply", id: message.id, result });
  } catch (error) {
    send({ kind: "reply", id: message.id, error: String(error) });
  }
});
send({ kind: "ready" });
