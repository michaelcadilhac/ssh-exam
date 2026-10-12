import { loadConfig } from "../../../packages/config/index.js";
import { createApp } from "./app.js";
const config = loadConfig();
const { app } = await createApp(config);
await app.listen({ host: "0.0.0.0", port: config.port });
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => void app.close().then(() => process.exit(0)));
