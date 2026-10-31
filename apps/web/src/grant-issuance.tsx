import { useEffect, useState, useId } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import {
  attemptsForExam,
  latestStarted,
  savedWorkLabel,
  savedWorkUsable,
} from "./exam-file-options.js";
import {
  deviceTimeZone,
  localDateTime,
  parseLocalDateTime,
  shortDateTime,
  timeLimit,
  windowLabel,
} from "./local-date-time.js";
import { LocalDateTimeInput } from "./local-date-time-input.js";
import { TemplatePicker } from "./template-picker.js";
import { workspaceChoice } from "./grant-workspace.js";
import { SavedWorkSetup } from "./saved-work-setup.js";

type Intent = {
  operation: "preview" | "confirm" | "cancel";
  path: string;
  body: any;
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const scopeNames = (names: string[]) => JSON.stringify([...names].sort());
const cachePrefix = "exam-admin-review:";
export function clearGrantReviewCache() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(cachePrefix) || key.startsWith("exam-admin-unused:"))
        sessionStorage.removeItem(key);
  } catch {
    /* No persisted administrator intents exist when storage is unavailable. */
  }
}
function readCache(key: string, exam: string, names: string[]) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!saved || (saved.review && !uuid.test(saved.review))) return null;
    const p = saved.pending;
    if (
      p &&
      (!uuid.test(p.body?.request) ||
        !["preview", "confirm", "cancel"].includes(p.operation) ||
        (p.operation === "preview"
          ? !["additional-preview", "issue-preview"].some(
              (suffix) =>
                p.path ===
                `/admin/exams/${encodeURIComponent(exam)}/grants/${suffix}`,
            ) || scopeNames(p.body.usernames ?? []) !== scopeNames(names)
          : !saved.review ||
            p.path !== `/admin/grant-issuance/${saved.review}/${p.operation}`))
    )
      return null;
    return saved as { review?: string; pending?: Intent };
  } catch {
    return null;
  }
}
function minutes(value: string) {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1 || n > 360)
    throw Error("Choose a time limit from 1 to 360 minutes.");
  return n * 60;
}

export function GrantIssuanceDialog({
  initial,
  students,
  actor,
  additional = false,
  onClose,
  onChanged,
  onAdoptStudents,
}: {
  initial: any;
  students: any[];
  actor: string;
  additional?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onAdoptStudents: (names: string[]) => void;
}) {
  const names = students.map((s) => s.username).sort(),
    practice = initial.id === "sandbox",
    kind = practice
      ? "NEW_SANDBOX_PRACTICE_GRANTS"
      : additional
        ? "NEW_ADDITIONAL_TEMPLATE_GRANTS"
        : "NEW_LEGACY_INITIAL_GRANTS",
    cacheKey = `${cachePrefix}${JSON.stringify([actor, initial.id, kind, names])}`;
  const [saved] = useState(() => readCache(cacheKey, initial.id, names));
  const formId = useId();
  const [review, setReview] = useState<any>(null),
    [pending, setPending] = useState<Intent | null>(saved?.pending ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recovering, setRecovering] = useState(!!saved?.review),
    [earliest, setEarliest] = useState(
      localDateTime(Math.max(Date.now(), initial.earliest)),
    ),
    [latest, setLatest] = useState(
      initial.latest > Date.now() ? localDateTime(initial.latest) : "",
    ),
    [duration, setDuration] = useState(""),
    [webcam, setWebcam] = useState("effective"),
    [reason, setReason] = useState(
      additional
        ? "Allow another exam attempt"
        : "Issue first attempt from selected current settings",
    ),
    [individual, setIndividual] = useState<
      Record<string, { duration: string; webcam: string }>
    >({}),
    [workMode, setWorkMode] = useState("latest"),
    [workName, setWorkName] = useState(initial.template),
    [workHash, setWorkHash] = useState(initial.template_version ?? ""),
    [exams, setExams] = useState<any[]>([]),
    [sourceExams, setSourceExams] = useState<string[]>([initial.id]),
    [attempts, setAttempts] = useState<any[]>([]),
    [sourceChoices, setSourceChoices] = useState<Record<string, string>>({}),
    [sourceLoading, setSourceLoading] = useState(true),
    [sourceError, setSourceError] = useState(""),
    [sourceReload, setSourceReload] = useState(0),
    [recent, setRecent] = useState<any[]>([]),
    [recentNext, setRecentNext] = useState<string | null>(null),
    [recentError, setRecentError] = useState("");
  const [setupRows, setSetupRows] = useState<Record<string, any>>({}),
    [setupRefresh, setSetupRefresh] = useState(0);
  const [sourceDetails, setSourceDetails] = useState<Record<string, any>>({});
  const [earliestOccurrence, setEarliestOccurrence] = useState(0),
    [latestOccurrence, setLatestOccurrence] = useState(0);
  const remember = (id?: string, intent?: Intent | null, cohort = names) => {
    const key = `${cachePrefix}${JSON.stringify([actor, initial.id, kind, [...cohort].sort()])}`;
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ review: id, pending: intent ?? undefined }),
      );
    } catch {
      throw Error(
        "This browser could not save the request for safe retry. Enable session storage before continuing.",
      );
    }
  };
  const acceptReview = (value: any, expected: string[] | null = names) => {
    if (
      value.exam !== initial.id ||
      value.actor !== actor ||
      value.kind !== kind ||
      !Array.isArray(value.rows) ||
      !value.rows.length ||
      (expected &&
        scopeNames(value.rows.map((r: any) => r.username)) !==
          scopeNames(expected))
    )
      throw Error(
        "This request belongs to another exam or instructor. Close it and refresh the exam.",
      );
    setReview(value);
    return value;
  };
  const inspect = async (id: string, adopt = false) => {
    setBusy(true);
    setError("");
    try {
      const value = acceptReview(
          await api(`/admin/grant-issuance/${id}`),
          adopt ? null : names,
        ),
        cohort = value.rows.map((r: any) => r.username);
      if (adopt) onAdoptStudents(cohort);
      setSetupRefresh((n) => n + 1);
      if (["CONFIRMED", "CANCELLED", "EXPIRED"].includes(value.status)) {
        setPending(null);
        remember(id, null, cohort);
      } else remember(id, pending, cohort);
      if (value.status === "CONFIRMED") await onChanged();
      setRecovering(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadRecent = async (after?: string) => {
    try {
      const value = await api(
        `/admin/exams/${encodeURIComponent(initial.id)}/grant-reviews?limit=20${after ? `&after=${after}` : ""}`,
      );
      if (
        value.actor !== actor ||
        value.exam !== initial.id ||
        !Array.isArray(value.rows)
      )
        throw Error("Could not read recent requests.");
      const rows = value.rows.filter((r: any) => r.kind === kind);
      setRecent((old) => (after ? [...old, ...rows] : rows));
      setRecentNext(value.next);
      setRecentError("");
    } catch (e) {
      setRecentError((e as Error).message);
    }
  };
  useEffect(() => {
    void loadRecent();
    if (saved?.review) void inspect(saved.review);
    const abort = new AbortController();
    void api("/admin/exams?lifecycle=all", undefined, undefined, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          if (!Array.isArray(value))
            throw Error("Could not read the exam list.");
          setExams(value);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setSourceError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!additional || workMode !== "latest") {
      setSourceLoading(false);
      return;
    }
    const abort = new AbortController();
    setSourceLoading(true);
    setSourceError("");
    void Promise.all(
      sourceExams.map((exam) => attemptsForExam(exam, undefined, abort.signal)),
    )
      .then((pages) => {
        if (!abort.signal.aborted) {
          setAttempts(pages.flat());
          setSourceLoading(false);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setSourceError(e.message);
          setSourceLoading(false);
        }
      });
    return () => abort.abort();
  }, [sourceExams.join(","), sourceReload, workMode]);
  useEffect(() => {
    if (!review) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await api(
          `/admin/grant-issuance/${review.id}/source-setup`,
          undefined,
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (
          value.id !== review.id ||
          !Array.isArray(value.rows) ||
          value.rows.length !== review.issued.length ||
          value.rows.some(
            (r: any) =>
              !review.issued.some(
                (g: any) => g.grant === r.id && g.username === r.username,
              ),
          )
        )
          throw Error("Status differs from this request.");
        setSetupRows(Object.fromEntries(value.rows.map((r: any) => [r.id, r])));
        setSourceDetails(value.sources ?? {});
        if (
          value.rows.some(
            (r: any) =>
              r.current_revision === r.revision &&
              r.grant_status === "PENDING_NATIVE" &&
              ["QUEUED", "RUNNING", "READY"].includes(r.status),
          )
        )
          timer = setTimeout(() => void load(), 3000);
      } catch (e) {
        if (!abort.signal.aborted)
          setSetupRows(
            Object.fromEntries(
              review.issued.map((g: any) => [
                g.grant,
                { read_error: (e as Error).message },
              ]),
            ),
          );
      }
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [review?.id, review?.status, setupRefresh]);
  const sourceFor = (username: string, automatic = false) => {
    const choice = automatic ? undefined : sourceChoices[username];
    if (choice === "starter")
      return workspaceChoice(
        "template",
        initial.template,
        initial.template_version ?? "",
      )!;
    if (choice === "empty") return { kind: "empty" };
    if (choice) {
      const a = attempts.find(
        (a) => a.id === choice && a.username === username,
      );
      if (!a || !savedWorkUsable(a))
        throw Error("Choose protected saved work or different starting files.");
      return { kind: "saved", attempt: a.id, checksum: a.checksum };
    }
    const a = latestStarted(attempts, username);
    if (!a)
      return workspaceChoice(
        "template",
        initial.template,
        initial.template_version ?? "",
      )!;
    if (!savedWorkUsable(a))
      throw Error(
        "The latest files are not ready. Choose different starting files or check the previous attempt.",
      );
    return { kind: "saved", attempt: a.id, checksum: a.checksum };
  };
  const rowSource = (username: string, automatic = false) => {
    try {
      return { work: sourceFor(username, automatic), error: "" };
    } catch (e) {
      return { work: null, error: (e as Error).message };
    }
  };
  const perform = async (operation: Intent["operation"]) => {
    if (busy) return;
    setError("");
    const retrying = !!pending;
    try {
      let intent = pending;
      if (!intent) {
        let body: any;
        if (operation === "preview") {
          if (
            !names.length ||
            names.length > 200 ||
            new Set(names).size !== names.length
          )
            throw Error("Select from 1 to 200 students.");
          const start = parseLocalDateTime(earliest, earliestOccurrence),
            end = parseLocalDateTime(latest, latestOccurrence);
          if (end <= start || end <= Date.now())
            throw Error(
              "Choose a closing time after the opening time, in the future.",
            );
          if (reason.trim().length < 8 || reason.trim().length > 1000)
            throw Error("Use a reason from 8 to 1,000 characters.");
          body = {
            definition_revision: initial.revision,
            template_version: initial.template_version,
            earliest: start,
            latest: end,
            usernames: names,
            reason: reason.trim(),
            request: crypto.randomUUID(),
          };
          if (additional) {
            if (
              workMode === "latest" &&
              (sourceLoading || sourceError || !sourceExams.length)
            )
              throw Error(
                "Load the selected exam histories before continuing.",
              );
            const shared =
              workMode === "latest"
                ? null
                : workMode === "materials"
                  ? workspaceChoice(
                      "template",
                      initial.template,
                      initial.template_version ?? "",
                    )
                  : workspaceChoice(workMode, workName, workHash);
            body.work_sources = names.map((username) => ({
              username,
              work: shared ?? sourceFor(username),
            }));
            if (duration && !practice) body.duration = minutes(duration);
            else body.preserve_duration = true;
            if (webcam !== "effective" && !practice)
              body.webcam = webcam === "required";
            const overrides = names.flatMap((username) => {
              const row = individual[username];
              if (!row || practice) return [];
              const value = {
                username,
                ...(row.duration ? { duration: minutes(row.duration) } : {}),
                ...(row.webcam !== "shared"
                  ? { webcam: row.webcam === "required" }
                  : {}),
              };
              return Object.keys(value).length > 1 ? [value] : [];
            });
            if (overrides.length) body.student_settings = overrides;
          }
        } else {
          if (!review)
            throw Error("Load the original review before continuing.");
          body = { revision: review.revision, request: crypto.randomUUID() };
        }
        intent = {
          operation,
          path:
            operation === "preview"
              ? `/admin/exams/${encodeURIComponent(initial.id)}/grants/${additional ? "additional-preview" : "issue-preview"}`
              : `/admin/grant-issuance/${review.id}/${operation}`,
          body,
        };
        remember(review?.id, intent);
        setPending(intent);
      }
      setBusy(true);
      const value = acceptReview(
        await api(
          intent.path,
          intent.body,
          undefined,
          new AbortController().signal,
        ),
        intent.operation === "preview"
          ? intent.body.usernames
          : review.rows.map((r: any) => r.username),
      );
      remember(value.id);
      setPending(null);
      setRecovering(false);
      if (value.status === "CONFIRMED") await onChanged();
      void loadRecent();
    } catch (e) {
      // A first, definite refusal differs from retrying an earlier unknown
      // result. The latter always keeps its original intent for reconciliation.
      if (!retrying && [400, 403, 404, 409].includes((e as any).status)) {
        setPending(null);
        remember(review?.id);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startAgain = () => {
    sessionStorage.removeItem(cacheKey);
    setReview(null);
    setPending(null);
    setError("");
    setRecovering(false);
  };
  const close = () => {
    if (!busy) {
      if (
        ["CONFIRMED", "CANCELLED", "EXPIRED"].includes(review?.status) &&
        !pending
      )
        sessionStorage.removeItem(cacheKey);
      onClose();
    }
  };
  const blockedSources = names.filter(
    (username) => rowSource(username, true).error,
  );
  const unresolvedSources = names.filter(
    (username) => rowSource(username).error,
  );
  const sourceRow = (username: string) => {
    const row = rowSource(username),
      automatic = rowSource(username, true),
      choices = attempts.filter(
        (a) => a.username === username && savedWorkUsable(a),
      );
    return (
      <div key={username}>
        <label>
          Starting files for {username}
          <select
            value={sourceChoices[username] ?? ""}
            onChange={(e) =>
              setSourceChoices((old) => ({
                ...old,
                [username]: e.target.value,
              }))
            }
          >
            <option value="">
              Automatic:{" "}
              {automatic.error
                ? "Latest files need review"
                : automatic.work?.kind === "saved"
                  ? savedWorkLabel(
                      attempts.find((a) => a.id === automatic.work?.attempt),
                      attempts,
                    )
                  : `Starter files: ${initial.template}`}
            </option>
            <option value="starter">Starter files: {initial.template}</option>
            <option value="empty">Empty folder</option>
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {savedWorkLabel(a, attempts)}
              </option>
            ))}
          </select>
        </label>
        {row.error && (
          <p className="warn">
            {username}: {row.error}
          </p>
        )}
      </div>
    );
  };
  const sharedWindow =
    review &&
    review.rows.every(
      (r: any) =>
        r.settings.earliest === review.rows[0].settings.earliest &&
        r.settings.latest === review.rows[0].settings.latest,
    );
  const sourceLabel = (row: any) => {
    if (row.work.kind === "empty") return "Empty folder";
    if (row.work.kind === "template") return `Starter files: ${row.work.name}`;
    const source =
      attempts.find(
        (a) => a.id === row.work.attempt && a.username === row.username,
      ) ?? sourceDetails[row.work.attempt];
    return source?.id === row.work.attempt
      ? `Saved work: ${savedWorkLabel(source, [...attempts, ...Object.values(sourceDetails)])}`
      : "Saved work · Source details unavailable";
  };
  return (
    <Modal
      title={additional ? "Allow another attempt" : "Allow first attempt"}
      onClose={close}
      wide
      className="grant-dialog"
    >
      <div className="grant-dialog-content">
        <p>
          {initial.name} · {review ? review.rows.length : names.length}{" "}
          {(review ? review.rows.length : names.length) === 1
            ? "student"
            : "students"}
        </p>
        {error && (
          <div role="alert" className="warn">
            <p>
              {pending
                ? "The result is unconfirmed. Retry the same request or check its status."
                : "Could not continue. Check the details and try again."}
            </p>
            <details>
              <summary>Details</summary>
              <p>{error}</p>
            </details>
          </div>
        )}
        {recovering && !review && (
          <>
            <p role="status">Loading the previous request…</p>
            <button
              disabled={busy}
              onClick={() => saved?.review && void inspect(saved.review)}
            >
              Check previous request
            </button>
          </>
        )}
        {!review && pending?.operation === "preview" && (
          <section aria-label="Unconfirmed request">
            <h3>Previous review request</h3>
            <p>{pending.body.usernames.join(", ")}</p>
            <p>
              {shortDateTime(pending.body.earliest)} —{" "}
              {shortDateTime(pending.body.latest)} · {deviceTimeZone()}
            </p>
            <p>
              {pending.body.preserve_duration
                ? "Keep each student's time limit"
                : pending.body.duration
                  ? timeLimit(pending.body.duration)
                  : "Use current first-attempt settings"}
            </p>
            <details>
              <summary>Technical details</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(pending.body, null, 2)}
              </pre>
            </details>
          </section>
        )}
        {!review && !recovering && !pending && (
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              void perform("preview");
            }}
          >
            <fieldset disabled={busy || !!pending}>
              <details>
                <summary>Selected students ({names.length})</summary>
                <p>{names.join(", ")}</p>
              </details>
              {additional ? (
                <>
                  {practice ? (
                    <p>Five minutes · Webcam optional · Four terminals</p>
                  ) : (
                    <>
                      <label>
                        Time limit (minutes)
                        <input
                          type="number"
                          min={1}
                          max={360}
                          step={1}
                          value={duration}
                          placeholder="Keep each student's time limit"
                          onChange={(e) => setDuration(e.target.value)}
                        />
                      </label>
                      <label>
                        Webcam
                        <select
                          value={webcam}
                          onChange={(e) => setWebcam(e.target.value)}
                        >
                          <option value="effective">
                            Keep each student's setting
                          </option>
                          <option value="required">
                            Required for everyone
                          </option>
                          <option value="optional">
                            Optional for everyone
                          </option>
                        </select>
                      </label>
                    </>
                  )}
                  <label>
                    Start with
                    <select
                      value={workMode}
                      onChange={(e) => {
                        if (
                          e.target.value === "latest" &&
                          workMode !== "latest"
                        )
                          setSourceLoading(true);
                        setWorkMode(e.target.value);
                      }}
                    >
                      <option value="latest">
                        Latest saved work; starter files if never started
                      </option>
                      <option value="materials">Exam starter files</option>
                      <option value="template">Other starter files</option>
                      <option value="empty">Empty folder</option>
                    </select>
                  </label>
                  {workMode === "template" && (
                    <TemplatePicker
                      name={workName}
                      hash={workHash}
                      onChange={(n, h) => {
                        setWorkName(n);
                        setWorkHash(h);
                      }}
                    />
                  )}
                  {workMode === "latest" && (
                    <>
                      <details>
                        <summary>
                          Saved work from{" "}
                          {sourceExams
                            .map(
                              (id) =>
                                exams.find((e) => e.id === id)?.name || id,
                            )
                            .join(", ") || "no exam selected"}
                        </summary>
                        <fieldset>
                          <legend>Choose source exams</legend>
                          {(exams.length ? exams : [initial]).map((exam) => (
                            <label key={exam.id}>
                              <input
                                type="checkbox"
                                checked={sourceExams.includes(exam.id)}
                                onChange={(e) => {
                                  setSourceChoices({});
                                  setSourceLoading(true);
                                  setSourceExams((old) =>
                                    e.target.checked
                                      ? [...old, exam.id]
                                      : old.filter((id) => id !== exam.id),
                                  );
                                }}
                              />
                              {exam.name || exam.id}
                              {exams.filter((e) => e.name === exam.name)
                                .length > 1
                                ? ` (${exam.id})`
                                : ""}
                              {exam.lifecycle === "archived"
                                ? " · Archived"
                                : ""}
                            </label>
                          ))}
                        </fieldset>
                      </details>
                      {!sourceExams.length ? (
                        <p role="alert">Choose at least one source exam.</p>
                      ) : sourceLoading ? (
                        <p role="status">Loading saved work…</p>
                      ) : sourceError ? (
                        <div role="alert">
                          <p>Could not load saved work.</p>
                          <details>
                            <summary>Details</summary>
                            <p>{sourceError}</p>
                          </details>
                          <button
                            type="button"
                            onClick={() => {
                              setSourceLoading(true);
                              setSourceReload((n) => n + 1);
                            }}
                          >
                            Refresh saved work
                          </button>
                        </div>
                      ) : (
                        <>
                          <p>
                            Saved work:{" "}
                            {
                              names.filter(
                                (n) => rowSource(n).work?.kind === "saved",
                              ).length
                            }{" "}
                            · Starter files:{" "}
                            {
                              names.filter(
                                (n) => rowSource(n).work?.kind === "template",
                              ).length
                            }
                            {names.some(
                              (n) => rowSource(n).work?.kind === "empty",
                            )
                              ? ` · Empty folders: ${names.filter((n) => rowSource(n).work?.kind === "empty").length}`
                              : ""}
                            {unresolvedSources.length
                              ? ` · Needs review: ${unresolvedSources.length}`
                              : ""}
                          </p>
                          {blockedSources.map(sourceRow)}
                          <details>
                            <summary>Individual starting files</summary>
                            {names
                              .filter((n) => !blockedSources.includes(n))
                              .map(sourceRow)}
                          </details>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p>
                  Use current settings for students who have never received an
                  attempt. Existing attempts keep their settings.
                </p>
              )}
              <fieldset>
                <legend>Start window</legend>
                <LocalDateTimeInput
                  label="Opens"
                  value={earliest}
                  onChange={setEarliest}
                  occurrence={earliestOccurrence}
                  onOccurrence={setEarliestOccurrence}
                />
                <LocalDateTimeInput
                  label="Closes"
                  value={latest}
                  onChange={setLatest}
                  occurrence={latestOccurrence}
                  onOccurrence={setLatestOccurrence}
                />
                <p className="muted">
                  Dates shown in {deviceTimeZone()}. The time limit starts when
                  the student begins.
                </p>
              </fieldset>
              {additional && !practice && (
                <details>
                  <summary>Individual time and webcam settings</summary>
                  {additional &&
                    !practice &&
                    names.map((username) => {
                      const row = individual[username] ?? {
                          duration: "",
                          webcam: "shared",
                        },
                        update = (value: Partial<typeof row>) =>
                          setIndividual((old) => ({
                            ...old,
                            [username]: { ...row, ...value },
                          }));
                      return (
                        <fieldset key={username}>
                          <legend>{username}</legend>
                          <label>
                            Time limit for {username} (minutes)
                            <input
                              type="number"
                              min={1}
                              max={360}
                              step={1}
                              placeholder="Use setting above"
                              value={row.duration}
                              onChange={(e) =>
                                update({ duration: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Webcam for {username}
                            <select
                              value={row.webcam}
                              onChange={(e) =>
                                update({ webcam: e.target.value })
                              }
                            >
                              <option value="shared">Use setting above</option>
                              <option value="required">Required</option>
                              <option value="optional">Optional</option>
                            </select>
                          </label>
                        </fieldset>
                      );
                    })}
                </details>
              )}
              <label>
                Reason
                <input
                  value={reason}
                  minLength={8}
                  maxLength={1000}
                  required
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </fieldset>
            {!initial.template_version && (
              <p className="warn">
                Choose published starter files in Exam defaults before
                reviewing.
              </p>
            )}
          </form>
        )}
        {review && (
          <section aria-label="Attempt review" className="grant-review">
            <h3>
              {review.status === "CONFIRMED"
                ? review.rows.length === 1
                  ? "Attempt allowed"
                  : "Attempts allowed"
                : review.status === "REVIEW"
                  ? "Review attempts"
                  : review.status === "CANCELLED"
                    ? "Request cancelled"
                    : "Review expired"}
            </h3>
            {sharedWindow && (
              <p>
                Start window:{" "}
                {windowLabel(
                  review.rows[0].settings.earliest,
                  review.rows[0].settings.latest,
                )}
              </p>
            )}
            <p>
              Dates shown in {deviceTimeZone()}. The full time limit starts when
              each student begins.
            </p>
            {review.rows.map((row: any) => (
              <article key={row.username} className="clock-batch-row">
                {review.status === "CONFIRMED" &&
                  (row.work.kind === "saved" ? (
                    <SavedWorkSetup
                      id={
                        review.issued.find(
                          (g: any) => g.username === row.username,
                        ).grant
                      }
                      revision={1}
                      snapshot={
                        setupRows[
                          review.issued.find(
                            (g: any) => g.username === row.username,
                          ).grant
                        ] ?? null
                      }
                      onRefresh={() => setSetupRefresh((n) => n + 1)}
                    />
                  ) : (
                    <p role="status">Attempt allowed</p>
                  ))}
                <h4>{row.username}</h4>
                <p>
                  {timeLimit(row.settings.duration)} · Webcam{" "}
                  {row.settings.webcam ? "required" : "optional"}
                </p>
                {!sharedWindow && (
                  <p>
                    {windowLabel(row.settings.earliest, row.settings.latest)}
                  </p>
                )}
                <p>{sourceLabel(row)}</p>
                {!!row.existing_grants && (
                  <p className="warn">
                    {row.existing_grants} earlier unused{" "}
                    {row.existing_grants === 1
                      ? "attempt remains"
                      : "attempts remain"}
                    .
                  </p>
                )}
              </article>
            ))}
            <details>
              <summary>Details</summary>
              <p>Reason: {review.reason}</p>
              <details>
                <summary>Technical details</summary>
                <p>
                  Review {review.id} · {review.status}
                </p>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(
                    { issued: review.issued, rows: review.rows },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </details>
          </section>
        )}
        {!review && !pending && !recovering && (
          <details>
            <summary>Your recent requests in this exam</summary>
            {recent.map((r) => (
              <p key={r.id}>
                <button
                  disabled={busy}
                  onClick={() => void inspect(r.id, true)}
                >
                  {shortDateTime(r.created)} ·{" "}
                  {r.usernames.slice(0, 3).join(", ")}
                  {r.usernames.length > 3
                    ? ` and ${r.usernames.length - 3} more`
                    : ""}{" "}
                  ·{" "}
                  {r.status === "CONFIRMED"
                    ? "Created"
                    : r.status === "REVIEW"
                      ? "Awaiting confirmation"
                      : r.status === "CANCELLED"
                        ? "Cancelled"
                        : "Expired"}
                </button>
              </p>
            ))}
            {!recent.length && !recentError && <p>No recent requests.</p>}
            {recentError && <p role="alert">Could not load recent requests.</p>}
            <button
              disabled={busy}
              onClick={() => void loadRecent(recentNext ?? undefined)}
            >
              {recentNext ? "Load more requests" : "Refresh requests"}
            </button>
          </details>
        )}
      </div>
      <div className="actions grant-dialog-actions">
        {!review && !recovering && !pending && (
          <button
            className="primary"
            form={formId}
            type="submit"
            disabled={
              busy ||
              !initial.template_version ||
              (additional &&
                workMode === "latest" &&
                (sourceLoading || !sourceExams.length))
            }
          >
            Review
          </button>
        )}
        {review?.status === "REVIEW" && !pending && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void perform("confirm")}
            >
              Allow {review.rows.length === 1 ? "attempt" : "attempts"}
            </button>
            <button disabled={busy} onClick={() => void perform("cancel")}>
              Cancel request
            </button>
          </>
        )}
        {["CANCELLED", "EXPIRED"].includes(review?.status) && !pending && (
          <button disabled={busy} onClick={startAgain}>
            Edit and review again
          </button>
        )}
        {review && (
          <button disabled={busy} onClick={() => void inspect(review.id)}>
            Refresh status
          </button>
        )}
        {pending && (
          <>
            <button
              disabled={busy || (pending.operation !== "preview" && !review)}
              onClick={() => void perform(pending.operation)}
            >
              Retry same request
            </button>
            {pending.operation === "preview" && !review && (
              <button disabled={busy} onClick={startAgain}>
                Edit draft
              </button>
            )}
          </>
        )}
        <button disabled={busy} onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
