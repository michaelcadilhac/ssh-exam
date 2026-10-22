import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import {
  templateCatalogPageResult,
  templateCatalogShowResult,
  type TemplateCatalogSource,
} from "../../../packages/protocol/template-catalog.js";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
function timestamp(n: number) {
  const date = new Date(n);
  return Number.isFinite(date.getTime())
    ? timeFormat.format(date)
    : `${n} ms (outside display range)`;
}
const key = (s: TemplateCatalogSource) => s.name + "@" + s.hash;

// Read-only recorded attestations. No automatic version/default selection,
// source upload/contents, filesystem probe or root action from the browser.
export function TemplateCatalogView() {
  const back = useRef<HTMLButtonElement>(null);
  const inspected = useRef<HTMLButtonElement | null>(null);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [history, setHistory] = useState([""]);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<ReturnType<
    typeof templateCatalogPageResult.parse
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [selected, setSelected] = useState<TemplateCatalogSource | null>(null);
  const [detail, setDetail] = useState<TemplateCatalogSource | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const cursor = history[page] ?? "";
  useEffect(() => {
    if (selected) back.current?.focus();
    else inspected.current?.focus();
  }, [selected]);
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    setData(null);
    setSelected(null);
    setDetail(null);
    const load = async () => {
      try {
        const query = new URLSearchParams({ limit: "50" });
        if (name) query.set("name", name);
        if (cursor) query.set("after", cursor);
        const result = templateCatalogPageResult.safeParse(
          await api(
            "/admin/templates?" + query,
            undefined,
            undefined,
            abort.signal,
          ),
        );
        if (!result.success)
          throw Error(
            "Invalid catalog metadata reply; refresh or inspect the exact source through examctl web templates.",
          );
        let last = cursor;
        for (const source of result.data.sources) {
          if ((name && source.name !== name) || key(source) <= last)
            throw Error(
              "Catalog page does not match this filter/cursor; refresh before inspecting a source.",
            );
          last = key(source);
        }
        if (
          result.data.sources.length > 50 ||
          (result.data.next !== null &&
            (result.data.sources.length !== 50 || result.data.next !== last))
        )
          throw Error(
            "Catalog pagination reply is incomplete or mismatched; refresh metadata.",
          );
        if (alive) setData(result.data);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [name, cursor, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    setDetail(null);
    setDetailError("");
    if (!selected) {
      setDetailLoading(false);
      return () => {
        alive = false;
        abort.abort();
      };
    }
    setDetailLoading(true);
    void (async () => {
      try {
        const result = templateCatalogShowResult.safeParse(
          await api(
            `/admin/templates/${encodeURIComponent(selected.name)}/${selected.hash}`,
            undefined,
            undefined,
            abort.signal,
          ),
        );
        if (
          !result.success ||
          key(result.data.source) !== key(selected) ||
          result.data.agent !== selected.agent
        )
          throw Error(
            "Catalog detail does not match the selected exact source; refresh metadata before inspecting it.",
          );
        if (alive) setDetail(result.data.source);
      } catch (e) {
        if (alive) setDetailError((e as Error).message);
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [selected]);
  return (
    <section
      className="template-catalog-view"
      aria-label="Recorded template sources"
    >
      {!selected ? (
        <p>
          Authenticated class-server source attestations, not live filesystem
          probes or availability guarantees. Reading or syncing this catalog
          does not select a template, issue an attempt grant, or change existing
          work or deadlines.
        </p>
      ) : (
        <p>
          Exact recorded source metadata, not a live availability check or
          attempt grant. Times shown in Chicago.
        </p>
      )}
      {selected && (
        <button ref={back} type="button" onClick={() => setSelected(null)}>
          Back to sources
        </button>
      )}
      <div hidden={!!selected}>
        <form
          className="template-catalog-filter"
          onSubmit={(e) => {
            e.preventDefault();
            const value = draft.trim();
            if (value && !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
              setFilterError(
                "Use the exact template name: 1–64 letters, digits, underscores or hyphens.",
              );
              return;
            }
            setFilterError("");
            setName(value);
            setHistory([""]);
            setPage(0);
            setRefresh((n) => n + 1);
          }}
        >
          <label>
            Template name{" "}
            <input
              value={draft}
              maxLength={64}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="All template names"
            />
          </label>
          <button type="submit">Filter sources</button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh metadata
          </button>
        </form>
        {filterError && <p role="alert">{filterError}</p>}
        {error && (
          <p role="alert">
            {error} No source availability or grant is confirmed by this failed
            read.
          </p>
        )}
        {loading && <p role="status">Loading recorded source metadata…</p>}
        {data && (
          <>
            <p className="muted">
              Metadata read {timestamp(data.observed)}. Times shown in Chicago.
              Native byte verification still happens before Begin. There is no
              implicit “latest” version.
            </p>
            {data.sources.length === 0 ? (
              <p>
                No attested template sources{name ? " match this name" : " yet"}
                . A local installation alone is not a gateway acknowledgement.
              </p>
            ) : (
              <div className="template-catalog-table">
                <table>
                  <thead>
                    <tr>
                      <th>Exact source</th>
                      <th>Saved file content</th>
                      <th>Last gateway acknowledgement</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((source) => (
                      <tr key={key(source)}>
                        <td data-label="Exact source">
                          <strong>{source.name}</strong>
                          <code className="template-catalog-hash">
                            {source.hash}
                          </code>
                        </td>
                        <td data-label="Saved file content">
                          {source.files.toLocaleString()} files ·{" "}
                          {source.bytes.toLocaleString()} bytes
                        </td>
                        <td data-label="Last gateway acknowledgement">
                          {timestamp(source.last_acknowledged_at)}
                        </td>
                        <td data-label="Inspect">
                          <button
                            type="button"
                            onClick={(event) => {
                              inspected.current = event.currentTarget;
                              setSelected(source);
                            }}
                            aria-label={`Inspect ${source.name} ${source.hash.slice(0, 12)}`}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <nav
              className="template-catalog-pages"
              aria-label="Template source pages"
            >
              <button
                disabled={loading || page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous page
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={loading || !data.next}
                onClick={() => {
                  setHistory((old) => [...old.slice(0, page + 1), data.next!]);
                  setPage((n) => n + 1);
                }}
              >
                Next page
              </button>
            </nav>
          </>
        )}
      </div>
      {detailLoading && <p role="status">Loading exact source details…</p>}
      {detailError && <p role="alert">{detailError}</p>}
      {detail && (
        <section
          className="template-catalog-detail"
          aria-label="Exact source details"
        >
          <h3>{detail.name}</h3>
          <code className="template-catalog-hash">{detail.hash}</code>
          <dl>
            <dt>Class agent</dt>
            <dd>{detail.agent}</dd>
            <dt>Files / total entries</dt>
            <dd>
              {detail.files} / {detail.entries}
            </dd>
            <dt>Logical file content</dt>
            <dd>
              {detail.bytes.toLocaleString()} bytes; largest file{" "}
              {detail.max_file_bytes.toLocaleString()} bytes
            </dd>
            <dt>First gateway acknowledgement</dt>
            <dd>{timestamp(detail.first_acknowledged_at)}</dd>
            <dt>Latest root attestation</dt>
            <dd>{timestamp(detail.last_attested_at)}</dd>
            <dt>Latest gateway acknowledgement</dt>
            <dd>{timestamp(detail.last_acknowledged_at)}</dd>
            <dt>Native creation (last reported)</dt>
            <dd>{timestamp(detail.last_native_created)}</dd>
          </dl>
          <p>
            Record or refresh the source observation from root on the class
            server:
          </p>
          <code className="template-catalog-command">
            sudo examctl templates sync {detail.name} {detail.hash} --reason
            'Reviewed installed source version'
          </code>
          <p>
            Exact retries keep the original acknowledgement; a new request
            refreshes it. This is not a grant or a fresh native availability
            check.
          </p>
          <button onClick={() => setSelected(null)}>
            Close source details
          </button>
        </section>
      )}
      <details>
        <summary>Install and synchronize a source</summary>
        <p>
          Run <code>examctl templates help</code> on the class server for
          validate/install/verify/sync. Native installation is separate from
          gateway acknowledgement. No file upload, contents download, source
          deletion or grant creation is available here.
        </p>
        <p>
          For recorded metadata from the CLI, use{" "}
          <code>examctl web templates list</code> and{" "}
          <code>examctl web templates show NAME HASH</code>. These reads do not
          access class files.
        </p>
      </details>
    </section>
  );
}
