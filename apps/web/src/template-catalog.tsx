import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { RefreshButton } from "./refresh-button.js";
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
    <section className="template-catalog-view" aria-label="Starter files">
      {!selected ? (
        <p>Starter files are verified again before an exam starts.</p>
      ) : (
        <p>Published starter details. Times shown in Chicago.</p>
      )}
      {selected && (
        <button ref={back} type="button" onClick={() => setSelected(null)}>
          Back
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
                "Use 1–64 letters, numbers, underscores or hyphens.",
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
            Starter name{" "}
            <input
              value={draft}
              maxLength={64}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="All starter names"
            />
          </label>
          <button type="submit">Filter</button>
          <RefreshButton
            label="Refresh"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          />
        </form>
        {filterError && <p role="alert">{filterError}</p>}
        {error && (
          <p role="alert">{error} Refresh to load published starter choices.</p>
        )}
        {loading && <p role="status">Loading starter files…</p>}
        {data && (
          <>
            <p className="muted">
              Information retrieved {timestamp(data.observed)}. Times shown in
              Chicago.
            </p>
            {data.sources.length === 0 ? (
              <p>
                No published starter files{name ? " match this name" : " yet"}.
                Ask the server administrator to publish starter files.
              </p>
            ) : (
              <div className="template-catalog-table">
                <table>
                  <thead>
                    <tr>
                      <th>Starter files</th>
                      <th>Files</th>
                      <th>Published</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((source) => (
                      <tr key={key(source)}>
                        <td data-label="Starter files">
                          <strong>{source.name}</strong>
                        </td>
                        <td data-label="Files">
                          {source.files.toLocaleString()} files ·{" "}
                          {source.bytes.toLocaleString()} bytes
                        </td>
                        <td data-label="Published">
                          {timestamp(source.first_acknowledged_at)}
                        </td>
                        <td data-label="Details">
                          <button
                            type="button"
                            onClick={(event) => {
                              inspected.current = event.currentTarget;
                              setSelected(source);
                            }}
                            aria-label={`Details for ${source.name} published ${timestamp(source.first_acknowledged_at)}`}
                          >
                            Details
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
              aria-label="Starter file pages"
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
      {detailLoading && <p role="status">Loading starter details…</p>}
      {detailError && <p role="alert">{detailError}</p>}
      {detail && (
        <section
          className="template-catalog-detail"
          aria-label="Starter details"
        >
          <h3>{detail.name}</h3>
          <p>
            {detail.files} files · {detail.bytes.toLocaleString()} bytes ·
            Published {timestamp(detail.first_acknowledged_at)}
          </p>
          <details>
            <summary>Technical details</summary>
            <code className="template-catalog-hash">{detail.hash}</code>
            <dl>
              <dt>Exam server</dt>
              <dd>{detail.agent}</dd>
              <dt>Files / entries</dt>
              <dd>
                {detail.files} / {detail.entries}
              </dd>
              <dt>File sizes</dt>
              <dd>
                {detail.bytes.toLocaleString()} bytes; largest file{" "}
                {detail.max_file_bytes.toLocaleString()} bytes
              </dd>
              <dt>First published</dt>
              <dd>{timestamp(detail.first_acknowledged_at)}</dd>
              <dt>Last verified on the exam server</dt>
              <dd>{timestamp(detail.last_attested_at)}</dd>
              <dt>Last web confirmation</dt>
              <dd>{timestamp(detail.last_acknowledged_at)}</dd>
              <dt>Installed (last reported)</dt>
              <dd>{timestamp(detail.last_native_created)}</dd>
            </dl>
            <p>Refresh this publication from the exam server:</p>
            <code className="template-catalog-command">
              sudo examctl templates sync {detail.name} {detail.hash} --reason
              'Reviewed installed source version'
            </code>
            <p>
              Exact retries keep the original confirmation. A new request
              refreshes it.
            </p>
          </details>
        </section>
      )}
      <details>
        <summary>Server setup</summary>
        <p>
          Run <code>examctl templates help</code> on the class server for
          instructions. New starter files are published by the server
          administrator.
        </p>
        <p>
          Inspect publications with <code>examctl web templates list</code> and{" "}
          <code>examctl web templates show NAME HASH</code>. These commands read
          published metadata.
        </p>
      </details>
    </section>
  );
}
