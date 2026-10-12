import https from "node:https";
import { readFileSync } from "node:fs";
import type { Config } from "../../../packages/config/index.js";
export class Agent {
  private transport: https.Agent | undefined;
  constructor(private config: Config["agent"]) {}
  private connection() {
    return (this.transport ??= new https.Agent({
      keepAlive: true,
      maxSockets: 16,
      maxFreeSockets: 8,
      ca: readFileSync(this.config.ca),
      cert: readFileSync(this.config.cert),
      key: readFileSync(this.config.key),
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    }));
  }
  async call<T = any>(op: string, body: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        new URL(`/v1/${op}`, this.config.url),
        {
          method: "POST",
          agent: this.connection(),
          timeout: 10000,
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (d) => {
            size += d.length;
            if (size > 4 * 1024 * 1024)
              req.destroy(Error("Oversized agent response"));
            else chunks.push(d);
          });
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (res.statusCode !== 200)
                reject(Error(data.error || "Agent rejected operation"));
              else resolve(data);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () =>
        req.destroy(Error("Agent request timed out; reconcile operation")),
      );
      req.end(JSON.stringify(body));
    });
  }
  async archive(id: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        new URL(`/v1/export/${id}`, this.config.url),
        { agent: this.connection(), timeout: 120000 },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (d) => {
            size += d.length;
            if (size > 128 * 1024 * 1024)
              req.destroy(Error("Archive exceeds transfer cap"));
            else chunks.push(d);
          });
          res.on("end", () =>
            res.statusCode === 200
              ? resolve(Buffer.concat(chunks))
              : reject(Error("Archive export unavailable")),
          );
        },
      );
      req.on("timeout", () => req.destroy(Error("Archive transfer timeout")));
      req.on("error", reject);
      req.end();
    });
  }
  close() {
    this.transport?.destroy();
  }
}
