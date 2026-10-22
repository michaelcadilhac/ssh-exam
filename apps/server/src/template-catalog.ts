import { z } from "zod";
import { hash, now, type Store } from "./db.js";
import {
  nativeTemplateVersion,
  templateCatalogPage,
  templateCatalogShow,
  templateCatalogSource,
  templateCatalogSync,
  templateName,
  type TemplateCatalogSource,
} from "../../../packages/protocol/template-catalog.js";

type SourceRow = Omit<TemplateCatalogSource, "schema" | "revision">;
export const templateCatalogNote =
  "Timestamped root-agent source attestation only; NOT a live filesystem probe, availability lease, template selection or grant. Native exact verification is required before Begin. No exam contents/inventories are stored here.";
const conflict = (message: string) =>
  Object.assign(Error(message), { statusCode: 409 });

// Caller authentication is owned by the existing signed management/admin
// transports. Only the signed ROOT transport calls sync; there is no browser
// route that can claim to have verified the class filesystem.
export class TemplateCatalog {
  constructor(
    private store: Store,
    private agent: string,
  ) {
    templateName.parse(agent);
  }
  private view(row: SourceRow): TemplateCatalogSource {
    const value = { schema: 1 as const, ...row };
    return templateCatalogSource.parse({
      ...value,
      revision: hash(JSON.stringify(value)),
    });
  }
  private row(name: string, digest: string): SourceRow | undefined {
    return this.store.db
      .prepare(
        "SELECT * FROM agent_template_versions WHERE agent=? AND name=? AND hash=?",
      )
      .get(this.agent, name, digest) as SourceRow | undefined;
  }
  show(raw: unknown) {
    const b = templateCatalogShow.parse(raw);
    const row = this.row(b.name, b.hash);
    if (!row)
      throw Object.assign(
        Error(
          "No authenticated source attestation for this exact name/hash; run root examctl templates verify, then templates sync NAME HASH --reason TEXT on the class server. Do not select latest or edit gateway JSON.",
        ),
        { statusCode: 404 },
      );
    return {
      agent: this.agent,
      source: this.view(row),
      observed: now(),
      note: templateCatalogNote,
    };
  }
  page(raw: unknown) {
    const b = templateCatalogPage.parse(raw);
    const [afterName, afterHash] = b.after?.split("@") ?? ["", ""];
    const rows = this.store.db
      .prepare(
        `SELECT * FROM agent_template_versions
      WHERE agent=? ${b.name ? "AND name=?" : ""} AND (name,hash)>(?,?)
      ORDER BY name,hash LIMIT ?`,
      )
      .all(
        this.agent,
        ...(b.name ? [b.name] : []),
        afterName,
        afterHash,
        b.limit + 1,
      ) as SourceRow[];
    const sources = rows.slice(0, b.limit).map((r) => this.view(r));
    return {
      agent: this.agent,
      sources,
      next:
        rows.length > b.limit
          ? `${sources.at(-1)!.name}@${sources.at(-1)!.hash}`
          : null,
      observed: now(),
      note: templateCatalogNote,
    };
  }
  sync(
    raw: unknown,
    context: {
      agent: string;
      actor: string;
      request: string;
      issued: number;
      observed: number;
    },
  ) {
    const b = templateCatalogSync.parse(raw);
    if (
      context.agent !== this.agent ||
      context.actor !== `agent:${this.agent}:root`
    )
      throw Object.assign(
        Error(
          "Only the authenticated class root-agent may attest native template bytes",
        ),
        { statusCode: 403 },
      );
    z.string().uuid().parse(context.request);
    for (const time of [context.issued, context.observed])
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(time);
    const v = nativeTemplateVersion.parse(b.version);
    return this.store.db.transaction(() => {
      const old = this.row(v.name, v.hash);
      if (old) {
        this.view(old); // Refuse damaged persisted metadata before a write.
        if (
          old.entries !== v.entries ||
          old.files !== v.files ||
          old.bytes !== v.bytes ||
          old.max_file_bytes !== v.max_file_bytes
        )
          throw conflict(
            "Exact template version conflicts with retained logical metadata; preserve registry/files, inspect templates verify and matching software; never overwrite or substitute a mutable source",
          );
      }
      const updated = !old || context.issued > old.last_attested_at;
      if (!old) {
        this.store.db
          .prepare(
            "INSERT INTO agent_template_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            this.agent,
            v.name,
            v.hash,
            v.entries,
            v.files,
            v.bytes,
            v.max_file_bytes,
            v.created,
            v.created,
            context.observed,
            context.issued,
            context.observed,
            context.request,
          );
      } else if (updated) {
        this.store.db
          .prepare(
            "UPDATE agent_template_versions SET last_native_created=?,last_attested_at=?,last_acknowledged_at=?,last_request=? WHERE agent=? AND name=? AND hash=?",
          )
          .run(
            v.created,
            context.issued,
            Math.max(old.last_acknowledged_at, context.observed),
            context.request,
            this.agent,
            v.name,
            v.hash,
          );
      }
      const source = this.view(this.row(v.name, v.hash)!);
      const acknowledgement = {
        request: context.request,
        attested_at: context.issued,
        acknowledged_at: context.observed,
        native_created: v.created,
      };
      this.store.audit(
        context.actor,
        "template-source-attested",
        `${v.name}@${v.hash}`,
        JSON.stringify({
          request: context.request,
          reason: b.reason,
          acknowledgement,
          updated,
          priorRevision: old ? this.view(old).revision : null,
          revision: source.revision,
        }),
      );
      return {
        agent: this.agent,
        source,
        acknowledgement,
        updated,
        observed: context.observed,
        note: templateCatalogNote,
      };
    })();
  }
}
