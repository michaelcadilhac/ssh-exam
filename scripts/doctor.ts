import { loadConfig } from "../packages/config/index.js";
import { Store } from "../apps/server/src/db.js";
import { Agent } from "../apps/server/src/agent.js";
import { statSync, statfsSync } from "node:fs";
const config = loadConfig();
let failed = false;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) failed = true;
};
check(
  "Exactly one gateway required",
  true,
  "Do not run multiple independent workers",
);
check(
  "Pinned SSH host keys",
  config.jump.pins.length > 0 && config.class.pins.length > 0,
);
check("SMTP configured", !!config.smtp);
for (const [name, p] of Object.entries(config.agent).filter(([n]) =>
  ["signingKey", "callbackPublicKey"].includes(n),
)) {
  const st = statSync(p);
  check(
    `Agent signature ${name}`,
    st.isFile() && (name !== "signingKey" || (st.mode & 0o077) === 0),
    p,
  );
}
const disk = statfsSync(config.data);
check(
  "Free storage",
  disk.bavail * disk.bsize > 1024 ** 3,
  "minimum 1 GiB; size for enrollment and retention",
);
try {
  const store = new Store(config.data);
  const health = await new Agent(config.agent, store).call("health");
  store.close();
  check(
    "Class agent guards and capabilities",
    health.ready &&
      [
        "interval-access-hold",
        "all-session-channel-gate",
        "signed-ssh-control",
        "durable-status-callbacks",
      ].every((cap) => health.capabilities?.includes(cap)),
    JSON.stringify(health.missing || health.warning || ""),
  );
} catch {
  check(
    "Authenticated agent configuration callback",
    false,
    "Start the class agent; it reports configuration through HTTPS. No inbound agent route exists.",
  );
}
check(
  "Production signoff",
  config.mode === "production",
  "Development fixtures establish no production guarantees",
);
process.exitCode = failed ? 1 : 0;
