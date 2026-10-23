import { randomUUID } from "node:crypto";
import type { Store } from "../../apps/server/src/db.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";

// Test-only historical metadata attestation. Native byte/worker verification is
// qualified separately; this fixture never claims live availability/enforcement.
export function grantExam(store: Store, id: string) {
  const digest = "a".repeat(64);
  new TemplateCatalog(store, "class").sync(
    {
      version: {
        schema: 1,
        name: "v1",
        hash: digest,
        entries: 4,
        files: 2,
        bytes: 30,
        max_file_bytes: 20,
        created: 1000,
      },
      reason: "Synthetic reviewed source for enrollment interface tests",
    },
    {
      agent: "class",
      actor: "agent:class:root",
      request: randomUUID(),
      issued: 1000,
      observed: 1001,
    },
  );
  const settings = {
    id,
    name: "Synthetic enrollment exam",
    template: "v1",
    template_version: digest,
    duration: 5400,
    webcam: true,
    terminals: 4,
    earliest: Date.now() - 60000,
    latest: Date.now() + 3600000,
  };
  store.db
    .prepare(
      "INSERT INTO exams VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
    )
    .run(id, JSON.stringify(settings));
  return settings;
}
