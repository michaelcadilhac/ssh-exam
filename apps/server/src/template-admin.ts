import type { FastifyInstance } from "fastify";
import type { Store } from "./db.js";
import { TemplateCatalog } from "./template-catalog.js";

// Metadata reads only. A browser administrator cannot attest class filesystem
// verification: use the explicit signed root templates.sync workflow.
export function registerTemplateAdmin(
  app: FastifyInstance,
  store: Store,
  agent: string,
  principal: (req: any, role: string) => any,
) {
  const catalog = new TemplateCatalog(store, agent);
  app.get("/api/admin/templates", async (req, reply) => {
    const actor = principal(req, "admin");
    const query = { ...(req.query as Record<string, unknown>) };
    if (query.limit !== undefined) query.limit = Number(query.limit);
    const result = catalog.page(query);
    store.audit(actor.username, "view-template-catalog", agent);
    return reply.header("Cache-Control", "no-store").send(result);
  });
  app.get("/api/admin/templates/:name/:hash", async (req, reply) => {
    const actor = principal(req, "admin");
    const result = catalog.show(req.params);
    store.audit(
      actor.username,
      "view-template-source",
      `${result.source.name}@${result.source.hash}`,
    );
    return reply.header("Cache-Control", "no-store").send(result);
  });
}
