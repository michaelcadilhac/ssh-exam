import { useEffect, useId, useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import { RefreshButton } from "./refresh-button.js";
import { allGrants, grantStatus, grantUnused } from "./grant-options.js";
import { TemplatePicker } from "./template-picker.js";
import { SavedWorkSetup } from "./saved-work-setup.js";
import { workspaceChoice } from "./grant-workspace.js";
import {
  attemptsForExam,
  examChoiceLabel,
  latestStarted,
  savedWorkLabel,
  savedWorkUsable,
} from "./exam-file-options.js";
import {
  deviceTimeZone,
  localDateTime,
  localOccurrence,
  parseLocalDateTime,
  shortDateTime,
  timeLimit,
  utcOffset,
  windowLabel,
} from "./local-date-time.js";
import { LocalDateTimeInput } from "./local-date-time-input.js";
import {
  MAX_COLLECTION_FILE_MIB,
  MAX_COLLECTION_TOTAL_MIB,
} from "../../../packages/protocol/collection-limits.js";

type ChangeRow = {
  grant: any;
  operation: "revise" | "revoke";
  body: any;
  state: "review" | "noop" | "applying" | "saved" | "refused" | "unknown";
  error?: string;
  result?: any;
};
const prefix = "exam-admin-unused:";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const title = (g: any) =>
  ["ENROLLMENT", "REVIEWED_NEW"].includes(g.issuance)
    ? "First attempt"
    : g.issuance === "PRACTICE"
      ? "Practice attempt"
      : "Extra attempt";
const sameWork = (a: any, b: any) =>
  a?.kind === b?.kind &&
  (a.kind === "empty" || a.kind === "saved"
    ? a.kind === "empty" ||
      (a.attempt === b.attempt && a.checksum === b.checksum)
    : a.name === b.name && a.hash === b.hash);
const numeric = [
  ["terminals", "Terminals", 1, 4],
  [
    "collection_file_mib",
    "Maximum file size (MiB)",
    1,
    MAX_COLLECTION_FILE_MIB,
  ],
  [
    "collection_total_mib",
    "Maximum total size (MiB)",
    1,
    MAX_COLLECTION_TOTAL_MIB,
  ],
] as const;
const compactGrant = (g: any) =>
  g
    ? Object.fromEntries(
        [
          "id",
          "exam",
          "username",
          "revision",
          "status",
          "issuance",
          "issued_at",
          "settings",
          "work",
        ].map((key) => [key, g[key]]),
      )
    : undefined;
function restored(
  key: string,
  exam: string,
  names: string[],
): ChangeRow[] | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 200 ||
      new Set(value.map((r) => r.grant.id)).size !== value.length ||
      value.some(
        (r) =>
          !uuid.test(r.grant?.id) ||
          r.grant.exam !== exam ||
          !names.includes(r.grant.username) ||
          !["revise", "revoke"].includes(r.operation) ||
          !uuid.test(r.body?.request) ||
          r.body.revision !== r.grant.revision ||
          ![
            "review",
            "noop",
            "applying",
            "saved",
            "refused",
            "unknown",
          ].includes(r.state),
      )
    )
      return null;
    return value.map((r) => ({
      ...r,
      state: r.state === "applying" ? "unknown" : r.state,
    }));
  } catch {
    return null;
  }
}
function workLabel(work: any, sources: any[]) {
  if (work.kind === "empty") return "Empty folder";
  if (work.kind === "template") return `${work.name} (starter files)`;
  const source = sources.find((s) => s?.id === work.attempt);
  return source
    ? `Saved files from ${savedWorkLabel(source, sources)}`
    : "Saved files";
}
function valueLabel(key: string, value: any) {
  if (key === "duration") return timeLimit(value);
  if (key === "webcam") return value ? "Required" : "Optional";
  if (key === "earliest" || key === "latest")
    return `${shortDateTime(value)} (${utcOffset(value)})`;
  return String(value);
}

export function AttemptGrantsDialog({
  exam,
  username,
  students,
  actor,
  initialGrantId,
  onClose,
  onChanged,
}: {
  exam: string;
  username?: string;
  students?: string[];
  actor: string;
  initialGrantId?: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const names = [...new Set(students ?? (username ? [username] : []))].sort(),
    cacheKey = prefix + JSON.stringify([actor, exam, names]),
    formId = useId();
  const [catalog, setCatalog] = useState<any[]>([]),
    [selected, setSelected] = useState(new Set<string>()),
    [editingId, setEditingId] = useState<string | null>(null),
    [editingSnapshot, setEditingSnapshot] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [review, setReview] = useState<ChangeRow[] | null>(() =>
      restored(cacheKey, exam, names),
    ),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [webcam, setWebcam] = useState("keep"),
    [windowMode, setWindowMode] = useState("keep"),
    [opens, setOpens] = useState(""),
    [closes, setCloses] = useState(""),
    [openOccurrence, setOpenOccurrence] = useState(0),
    [closeOccurrence, setCloseOccurrence] = useState(0),
    [workMode, setWorkMode] = useState("keep"),
    [workChanged, setWorkChanged] = useState(false),
    [workName, setWorkName] = useState(""),
    [workHash, setWorkHash] = useState(""),
    [materialChange, setMaterialChange] = useState(false),
    [materialName, setMaterialName] = useState(""),
    [materialHash, setMaterialHash] = useState(""),
    [exams, setExams] = useState<any[]>([]),
    [examError, setExamError] = useState(""),
    [sourceExam, setSourceExam] = useState(exam),
    [sources, setSources] = useState<any[]>([]),
    [sourceReload, setSourceReload] = useState(0),
    [savedChoices, setSavedChoices] = useState<Record<string, string>>({}),
    [sourceError, setSourceError] = useState(""),
    [sourceLoading, setSourceLoading] = useState(false),
    [snapshots, setSnapshots] = useState<Record<string, any>>({}),
    [statusRefresh, setStatusRefresh] = useState(0),
    [histories, setHistories] = useState<Record<string, any>>({});
  const load = async (signal?: AbortSignal) => {
    const values = await allGrants(exam, names, signal);
    if (initialGrantId && !values.some((g) => g.id === initialGrantId)) {
      const g = await api(
        `/admin/grants/${initialGrantId}`,
        undefined,
        undefined,
        signal,
      );
      if (g.exam !== exam || !names.includes(g.username))
        throw Error("The selected settings belong to another student or exam.");
      values.push(g);
    }
    if (signal?.aborted) return;
    setCatalog(values);
    setLoaded(true);
    const labels = values
      .filter(
        (g) =>
          g.work.kind === "saved" &&
          (grantUnused(g) || g.id === initialGrantId),
      )
      .slice(0, 200);
    if (labels.length) {
      const snapshots = await readStatus(
        labels.map((g) => ({ id: g.id, revision: g.revision })),
        signal,
      );
      if (!signal?.aborted) setSnapshots((old) => ({ ...old, ...snapshots }));
    }
    setSelected((old) => {
      const eligible = values.filter(grantUnused),
        current = new Set(
          [...old].filter((id) => eligible.some((g) => g.id === id)),
        );
      if (
        !loaded &&
        !review &&
        !old.size &&
        initialGrantId &&
        eligible.some((g) => g.id === initialGrantId)
      )
        current.add(initialGrantId);
      else if (
        !loaded &&
        !review &&
        !initialGrantId &&
        !old.size &&
        names.length === 1 &&
        eligible.length === 1
      )
        current.add(eligible[0].id);
      return current;
    });
    return values;
  };
  const loadExams = async (signal?: AbortSignal) => {
    try {
      const value = await api(
        "/admin/exams?lifecycle=all",
        undefined,
        undefined,
        signal,
      );
      if (!Array.isArray(value)) throw Error("Could not read the exam list.");
      if (!signal?.aborted) {
        setExams(value);
        setExamError("");
      }
    } catch (e) {
      if (!signal?.aborted) setExamError((e as Error).message);
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).catch((e) => {
      if (!abort.signal.aborted) {
        setError(e.message);
        setLoaded(true);
      }
    });
    void loadExams(abort.signal);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (workMode !== "saved") return;
    const abort = new AbortController();
    setSourceLoading(true);
    setSourceError("");
    setSources([]);
    void attemptsForExam(sourceExam, undefined, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setSources(value);
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
  }, [sourceExam, workMode, sourceReload]);
  const saveReview = (rows: ChangeRow[]) => {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify(
        rows.map((row) => ({
          ...row,
          grant: compactGrant(row.grant),
          result: compactGrant(row.result),
        })),
      ),
    );
    setReview(rows);
  };
  const readStatus = async (
    refs: { id: string; revision: number }[],
    signal?: AbortSignal,
  ) => {
    const value = await api(
      `/admin/exams/${encodeURIComponent(exam)}/grants/status`,
      { rows: refs },
      undefined,
      signal,
    );
    if (
      !Array.isArray(value.rows) ||
      value.rows.length !== refs.length ||
      new Set(value.rows.map((r: any) => r.id)).size !== refs.length ||
      value.rows.some(
        (r: any) =>
          !refs.some((ref) => ref.id === r.id && ref.revision === r.revision) ||
          r.grant?.id !== r.id ||
          r.grant.exam !== exam ||
          !names.includes(r.grant.username),
      )
    )
      throw Error(
        "Attempt status differs from the selection. Refresh before continuing.",
      );
    return Object.fromEntries(value.rows.map((r: any) => [r.id, r]));
  };
  const observed = review
    ? review.map((row) => ({
        id: row.grant.id,
        revision: row.result?.revision ?? row.grant.revision,
      }))
    : catalog
        .filter(
          (g) =>
            selected.has(g.id) && g.work.kind === "saved" && grantUnused(g),
        )
        .map((g) => ({ id: g.id, revision: g.revision }));
  useEffect(() => {
    if (!observed.length || observed.length > 200) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await readStatus(observed, abort.signal);
        if (abort.signal.aborted) return;
        setSnapshots((old) => ({ ...old, ...value }));
        if (
          Object.values(value).some(
            (s: any) =>
              s.grant_status === "PENDING_NATIVE" &&
              ["QUEUED", "RUNNING", "READY"].includes(s.status),
          )
        )
          timer = setTimeout(() => void poll(), 3000);
      } catch (e) {
        if (!abort.signal.aborted)
          setSnapshots((old) => ({
            ...old,
            ...Object.fromEntries(
              observed.map((ref) => [
                ref.id,
                { read_error: (e as Error).message },
              ]),
            ),
          }));
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [JSON.stringify([observed, review?.map((r) => r.state)]), statusRefresh]);
  const selectedGrants = catalog.filter((g) => selected.has(g.id)),
    selectedNames = [...new Set(selectedGrants.map((g) => g.username))],
    editingGrant =
      username &&
      editingId === selectedGrants[0]?.id &&
      selectedGrants.length === 1 &&
      grantUnused(selectedGrants[0])
        ? editingSnapshot
        : null,
    sourceExams = exams.length ? exams : [{ id: exam, name: exam }],
    sourceExamLabel = examChoiceLabel(
      sourceExams.find((value) => value.id === sourceExam) ?? {
        id: sourceExam,
      },
    );
  const populateEditor = (
    grant: any,
    changes: Record<string, any> = {},
    replacement?: any,
  ) => {
    const settings = { ...grant.settings, ...changes },
      work = replacement ?? grant.work;
    setEditingId(grant.id);
    setEditingSnapshot(structuredClone(grant));
    setSelected(new Set([grant.id]));
    setDraft(
      Object.fromEntries(
        Object.entries(changes)
          .filter(
            ([key]) =>
              key === "duration" || numeric.some(([name]) => key === name),
          )
          .map(([key, value]) => [
            key,
            String(key === "duration" ? value / 60 : value),
          ]),
      ),
    );
    setWebcam(String(settings.webcam));
    setWindowMode("set");
    setOpens(localDateTime(settings.earliest));
    setCloses(localDateTime(settings.latest));
    setOpenOccurrence(localOccurrence(settings.earliest));
    setCloseOccurrence(localOccurrence(settings.latest));
    setWorkMode(work.kind);
    setWorkChanged(!!replacement && !sameWork(work, grant.work));
    setWorkName(work.name ?? "");
    setWorkHash(work.hash ?? "");
    setMaterialChange(
      changes.template !== undefined || changes.template_version !== undefined,
    );
    setMaterialName(settings.template ?? "");
    setMaterialHash(settings.template_version ?? "");
    setSourceExam(
      [...sources, snapshots[grant.id]?.source].find(
        (s) => s?.id === work.attempt,
      )?.exam ?? exam,
    );
    setSources([]);
    setSavedChoices(
      work.kind === "saved" ? { [grant.username]: work.attempt } : {},
    );
    setSourceError("");
    setSourceLoading(false);
    setError("");
  };
  const editGrant = (grant: any) => {
    if (busy || review || !grantUnused(grant)) return;
    populateEditor(grant);
  };
  useEffect(() => {
    if (!editingGrant || workChanged || editingGrant.work.kind !== "saved")
      return;
    const source = snapshots[editingGrant.id]?.source;
    if (source?.id === editingGrant.work.attempt) setSourceExam(source.exam);
  }, [editingGrant?.id, snapshots, workChanged]);
  useEffect(() => {
    if (editingGrant && !review) {
      document
        .getElementById(`${formId}-editor`)
        ?.scrollIntoView({ block: "nearest" });
      document.getElementById(`${formId}-duration`)?.focus();
    }
  }, [editingGrant?.id, !!review]);
  const cancelEditing = () => {
    if (busy) return;
    setEditingId(null);
    setError("");
    setWorkMode("keep");
    setWorkChanged(false);
    requestAnimationFrame(() =>
      document.getElementById(`${formId}-edit-${editingId}`)?.focus(),
    );
  };
  const savedSource = (name: string) => {
    if (sourceLoading || sourceError)
      throw Error("Load the saved-work list before reviewing.");
    const last =
      savedChoices[name] !== undefined
        ? sources.find(
            (s) => s.id === savedChoices[name] && s.username === name,
          )
        : latestStarted(sources, name);
    if (!last || !savedWorkUsable(last))
      throw Error(
        `${name}: choose protected saved work. No older source was selected automatically.`,
      );
    return last;
  };
  const makeReview = async (
    operation: "revise" | "revoke",
    targets = username && editingGrant ? [editingGrant] : selectedGrants,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const reviewReason =
        operation === "revoke"
          ? "Cancel unused attempt"
          : "Change unused attempt settings";
      if (!targets.length || targets.length > 200)
        throw Error("Choose from 1 to 200 unused attempts.");
      if (username && targets.length !== 1)
        throw Error("Choose Edit settings for the attempt you want to change.");
      const current = await readStatus(
        targets.map((g) => ({ id: g.id, revision: g.revision })),
        new AbortController().signal,
      );
      setSnapshots(current);
      const changed = targets.filter(
        (g) =>
          current[g.id].grant.revision !== g.revision ||
          !grantUnused(current[g.id].grant),
      );
      if (changed.length)
        throw Error(
          `Settings changed or setup started for ${[...new Set(changed.map((g) => g.username))].join(", ")}. ${username ? "Cancel editing and reopen settings to check the current attempt." : "Refresh the selection and review again."}`,
        );
      const rows: ChangeRow[] = targets.map((old) => {
        const grant = current[old.id].grant,
          changes: Record<string, any> = {};
        let work: any;
        if (operation === "revise") {
          if (draft.duration) {
            const n = Number(draft.duration);
            if (!/^\d+$/.test(draft.duration) || n < 1 || n > 360)
              throw Error("Choose a time limit from 1 to 360 whole minutes.");
            if (n * 60 !== grant.settings.duration) changes.duration = n * 60;
          }
          if (
            webcam !== "keep" &&
            (webcam === "true") !== grant.settings.webcam
          )
            changes.webcam = webcam === "true";
          if (windowMode === "set")
            for (const [key, value, occurrence] of [
              ["earliest", opens, openOccurrence],
              ["latest", closes, closeOccurrence],
            ] as const) {
              if (username && !value)
                throw Error(
                  `Choose ${key === "earliest" ? "an opening" : "a closing"} date and time.`,
                );
              if (
                value &&
                (!username ||
                  value !== localDateTime(grant.settings[key]) ||
                  occurrence !== localOccurrence(grant.settings[key]))
              ) {
                const at = parseLocalDateTime(value, occurrence);
                if (at !== grant.settings[key]) changes[key] = at;
              }
            }
          for (const [key, label, min, max] of numeric)
            if (draft[key]) {
              const n = Number(draft[key]);
              if (
                !/^\d+$/.test(draft[key]) ||
                !Number.isSafeInteger(n) ||
                n < min ||
                n > max
              )
                throw Error(
                  `${label}: choose a whole number from ${min} to ${max}.`,
                );
              if (n !== grant.settings[key]) changes[key] = n;
            }
          if (materialChange) {
            workspaceChoice("template", materialName, materialHash);
            if (materialName !== grant.settings.template)
              changes.template = materialName;
            if (materialHash !== grant.settings.template_version)
              changes.template_version = materialHash;
          }
          if (
            (changes.latest ?? grant.settings.latest) <=
            (changes.earliest ?? grant.settings.earliest)
          )
            throw Error(
              `${grant.username}: closing time must be after opening time.`,
            );
          if (
            (changes.collection_total_mib ??
              grant.settings.collection_total_mib) <
            (changes.collection_file_mib ?? grant.settings.collection_file_mib)
          )
            throw Error(
              `${grant.username}: total file limit must be at least the per-file limit.`,
            );
          if (workMode === "saved" && (!username || workChanged)) {
            if (
              username &&
              grant.work.kind === "saved" &&
              savedChoices[grant.username] === grant.work.attempt
            )
              work = grant.work;
            else {
              const source = savedSource(grant.username);
              work = workspaceChoice("saved", source.id, source.checksum);
            }
          } else if (workMode !== "keep" && (!username || workChanged))
            work = workspaceChoice(workMode, workName, workHash);
          if (work && sameWork(work, grant.work)) work = undefined;
        }
        const body = {
          revision: grant.revision,
          reason: reviewReason,
          request: crypto.randomUUID(),
          ...(operation === "revise"
            ? { changes, ...(work ? { work } : {}) }
            : {}),
        };
        return {
          grant,
          operation,
          body,
          state:
            operation === "revise" && !Object.keys(changes).length && !work
              ? "noop"
              : "review",
        };
      });
      saveReview(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!review || busy) return;
    const pending = review.filter((r) =>
      ["review", "unknown"].includes(r.state),
    );
    if (!pending.length) return;
    setBusy(true);
    setError("");
    try {
      const identity = await api("/session");
      if (identity.role !== "admin" || identity.username !== actor)
        throw Error(
          "Instructor sign-in changed. Return to the original sign-in before retrying these requests.",
        );
      const applying = review.map((r) =>
        pending.includes(r) ? { ...r, state: "applying" as const } : r,
      );
      saveReview(applying);
      let next: ChangeRow[];
      try {
        const response = await api(
          `/admin/exams/${encodeURIComponent(exam)}/grants/change`,
          {
            rows: pending.map((r) => ({
              id: r.grant.id,
              operation: r.operation,
              body: r.body,
            })),
          },
          undefined,
          new AbortController().signal,
        );
        if (
          !Array.isArray(response.results) ||
          response.results.length !== pending.length ||
          new Set(response.results.map((r: any) => r.id)).size !==
            pending.length ||
          response.results.some(
            (r: any) =>
              !pending.some(
                (p) => p.grant.id === r.id && p.body.request === r.request,
              ) || !["saved", "refused", "unknown"].includes(r.outcome),
          )
        )
          throw Error("Change results do not match the original requests.");
        next = review.map((row) => {
          if (!pending.includes(row)) return row;
          const result = response.results.find(
            (r: any) => r.id === row.grant.id,
          );
          if (result.outcome === "saved") {
            const g = result.grant;
            const expected = {
              ...row.grant.settings,
              ...(row.body.changes ?? {}),
            };
            if (
              !g ||
              !g.settings ||
              g.id !== row.grant.id ||
              g.exam !== exam ||
              g.username !== row.grant.username ||
              g.revision !==
                row.grant.revision + (row.operation === "revise" ? 1 : 0) ||
              (row.operation === "revoke" && g.status !== "REVOKED") ||
              Object.keys({ ...expected, ...g.settings }).some(
                (key) => expected[key] !== g.settings[key],
              ) ||
              !sameWork(row.body.work ?? row.grant.work, g.work)
            )
              return {
                ...row,
                state: "unknown",
                error: "The result did not confirm this exact change.",
              };
            return { ...row, state: "saved", result: g, error: "" };
          }
          return {
            ...row,
            state:
              result.outcome === "refused" && row.state !== "unknown"
                ? "refused"
                : "unknown",
            error: result.error || "The change was not confirmed.",
          };
        });
      } catch (e) {
        next = review.map((row) =>
          pending.includes(row)
            ? {
                ...row,
                state:
                  row.state !== "unknown" &&
                  [400, 403, 404, 409].includes((e as any).status)
                    ? "refused"
                    : "unknown",
                error: (e as Error).message,
              }
            : row,
        );
      }
      try {
        saveReview(next);
      } catch {
        setReview(next);
        setError(
          "Results are shown, but this browser could not save them for reopening.",
        );
      }
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async (grant: any, before?: number) => {
    try {
      const value = await api(
        `/admin/grants/${grant.id}${before ? `?before=${before}` : ""}`,
        undefined,
        undefined,
        new AbortController().signal,
      );
      if (
        value.id !== grant.id ||
        value.username !== grant.username ||
        value.exam !== exam
      )
        throw Error("History differs from this attempt.");
      setHistories((old) => ({
        ...old,
        [grant.id]: {
          rows: before
            ? [...(old[grant.id]?.rows ?? []), ...value.history]
            : value.history,
          next: value.history_next,
        },
      }));
      if (grant.work.kind === "saved" && !snapshots[grant.id]?.source) {
        const status = await readStatus([
          { id: grant.id, revision: grant.revision },
        ]);
        setSnapshots((old) => ({ ...old, ...status }));
      }
    } catch (e) {
      setHistories((old) => ({
        ...old,
        [grant.id]: { ...old[grant.id], error: (e as Error).message },
      }));
    }
  };
  const grantRow = (g: any) => {
    const setupSelected =
      selected.has(g.id) &&
      selected.size <= 200 &&
      g.work.kind === "saved" &&
      grantUnused(g);
    const heading = (
      <>
        {title(g)} · {shortDateTime(g.issued_at)}
        {!setupSelected && ` · ${grantStatus(g)}`}
      </>
    );
    return (
      <article key={g.id} className="clock-batch-row">
        {!username && grantUnused(g) ? (
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={selected.has(g.id)}
              onChange={(e) =>
                setSelected((old) => {
                  const value = new Set(old);
                  e.target.checked ? value.add(g.id) : value.delete(g.id);
                  return value;
                })
              }
            />
            Select {heading}
          </label>
        ) : (
          <p>{heading}</p>
        )}
        {username && grantUnused(g) && (
          <div className="actions">
            <button
              id={`${formId}-edit-${g.id}`}
              type="button"
              disabled={busy || !!review}
              onClick={() => editGrant(g)}
            >
              Edit settings
            </button>
            <button
              type="button"
              disabled={busy || !!review}
              onClick={() => void makeReview("revoke", [g])}
            >
              Cancel attempt
            </button>
          </div>
        )}
        <p>
          {timeLimit(g.settings.duration)} · Webcam{" "}
          {g.settings.webcam ? "required" : "optional"}
        </p>
        <p>
          Start window: {windowLabel(g.settings.earliest, g.settings.latest)}
        </p>
        <p>
          Starting files:{" "}
          {workLabel(
            g.work,
            [...sources, snapshots[g.id]?.source].filter(Boolean),
          )}
        </p>
        {setupSelected && (
          <SavedWorkSetup
            id={g.id}
            revision={g.revision}
            snapshot={snapshots[g.id] ?? null}
            onRefresh={() => setStatusRefresh((n) => n + 1)}
          />
        )}
        <details
          open={g.id === initialGrantId}
          onToggle={(e) => {
            if (e.currentTarget.open && !histories[g.id]) void loadHistory(g);
          }}
        >
          <summary>Details and history</summary>
          {histories[g.id]?.rows?.map((h: any) => (
            <p key={h.revision}>
              {h.at ? `${shortDateTime(h.at)} · ` : ""}
              {timeLimit(h.settings.duration)} · Webcam{" "}
              {h.settings.webcam ? "required" : "optional"} · {h.actor}:{" "}
              {h.reason}
            </p>
          ))}
          {histories[g.id]?.error && (
            <>
              <p role="alert">{histories[g.id].error}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadHistory(g)}
              >
                Retry history
              </button>
            </>
          )}
          {histories[g.id]?.next && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadHistory(g, histories[g.id].next)}
            >
              Load earlier changes
            </button>
          )}
          <details>
            <summary>Technical details</summary>
            <p>
              Reference {g.id} · Revision {g.revision}
            </p>
          </details>
        </details>
      </article>
    );
  };
  const close = () => {
    if (busy) return;
    if (
      review &&
      review.every((r) => ["noop", "saved", "refused"].includes(r.state))
    ) {
      try {
        sessionStorage.removeItem(cacheKey);
      } catch {
        /* The original persisted request remains safe to retry. */
      }
    }
    onClose();
  };
  const editAgain = async () => {
    if (busy || review?.some((r) => ["unknown", "applying"].includes(r.state)))
      return;
    setBusy(true);
    setError("");
    try {
      const values = await load();
      if (!values)
        throw Error("Could not load current attempt settings. Try again.");
      setSelected(
        new Set(
          review?.filter((r) => r.state !== "saved").map((r) => r.grant.id),
        ),
      );
      if (username) {
        const remaining = review?.find((r) => r.state !== "saved");
        const fresh = values.find(
          (g) => g.id === remaining?.grant.id && grantUnused(g),
        );
        if (fresh && remaining?.operation === "revise")
          populateEditor(fresh, remaining.body.changes, remaining.body.work);
        else {
          setEditingId(null);
          setEditingSnapshot(null);
          setWorkMode("keep");
        }
      }
      try {
        sessionStorage.removeItem(cacheKey);
      } catch {
        /* A new dispatch still requires successful persistence. */
      }
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visibleChanges = (row: ChangeRow) => {
    if (row.operation === "revoke")
      return (
        <p>Cancel this unused attempt. Saved files and history are kept.</p>
      );
    const labels: Record<string, string> = {
      duration: "Time limit",
      webcam: "Webcam",
      earliest: "Opens",
      latest: "Closes",
      name: "Exam name",
      terminals: "Terminals",
      collection_file_mib: "Per-file MiB",
      collection_total_mib: "Total MiB",
    };
    const changes = row.body.changes,
      allSources = [
        ...sources,
        ...Object.values(snapshots)
          .map((s: any) => s?.source)
          .filter(Boolean),
      ];
    return (
      <ul>
        {Object.entries(changes)
          .filter(([key]) => !["template", "template_version"].includes(key))
          .map(([key, value]) => (
            <li key={key}>
              {labels[key] ?? key}: {valueLabel(key, row.grant.settings[key])} →{" "}
              {valueLabel(key, value)}
            </li>
          ))}
        {("template" in changes || "template_version" in changes) && (
          <li>
            Exam files: {row.grant.settings.template} →{" "}
            {changes.template ?? row.grant.settings.template}
            {changes.template_version ? " (new version)" : ""}
          </li>
        )}
        {row.body.work && (
          <li>
            Starting files: {workLabel(row.grant.work, allSources)} →{" "}
            {workLabel(row.body.work, allSources)}
            {row.body.work.kind === "template" &&
            row.grant.work.kind === "template" &&
            row.body.work.name === row.grant.work.name
              ? " (new version)"
              : ""}
          </li>
        )}
      </ul>
    );
  };
  const noUnused = loaded
    ? names.filter(
        (name) => !catalog.some((g) => g.username === name && grantUnused(g)),
      )
    : [];
  const attemptGroups = names.map((name) => (
    <section key={name} aria-label={`Attempts for ${name}`}>
      <h3>{name}</h3>
      {catalog
        .filter(
          (g) =>
            g.username === name && (grantUnused(g) || g.id === initialGrantId),
        )
        .map(grantRow)}
      {catalog.some(
        (g) =>
          g.username === name && !grantUnused(g) && g.id !== initialGrantId,
      ) && (
        <details>
          <summary>Unavailable attempts and history</summary>
          {catalog
            .filter(
              (g) =>
                g.username === name &&
                !grantUnused(g) &&
                g.id !== initialGrantId,
            )
            .map(grantRow)}
        </details>
      )}
    </section>
  ));
  const currentStatus = (row: ChangeRow) =>
    snapshots[row.grant.id]?.grant ? (
      <p>
        Current status: {grantStatus(snapshots[row.grant.id].grant)}
        {snapshots[row.grant.id].grant.revision !==
        (row.result?.revision ?? row.grant.revision)
          ? " · Settings changed since review"
          : ""}
      </p>
    ) : null;
  const needsCurrentStatus = (row: ChangeRow) =>
    ["unknown", "refused"].includes(row.state) ||
    (snapshots[row.grant.id]?.grant &&
      snapshots[row.grant.id].grant.revision !==
        (row.result?.revision ?? row.grant.revision));
  const dateChanges = review?.some(
    (row) =>
      row.body.changes?.earliest !== undefined ||
      row.body.changes?.latest !== undefined,
  );
  const pendingRows =
      review?.filter((r) => ["review", "unknown"].includes(r.state)) ?? [],
    unknown = review?.some((r) => r.state === "unknown");
  return (
    <Modal
      title={
        username ? `Allowed attempts for ${username}` : "Change unused attempts"
      }
      wide
      className="grant-dialog"
      onClose={close}
    >
      <div className="grant-dialog-content">
        {error && (
          <p role="alert" className="warn">
            {error}
          </p>
        )}
        {!review && (
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              const input = Array.from(
                e.currentTarget.querySelectorAll<HTMLInputElement>("input"),
              ).find((field) => field.willValidate && field.validity.badInput);
              if (input) {
                const label =
                  input.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim() ||
                  "the number or date";
                setError(`Complete ${label} before reviewing.`);
                for (
                  let details = input.closest("details");
                  details;
                  details = details.parentElement?.closest("details") ?? null
                )
                  details.open = true;
                input.focus();
                return;
              }
              void makeReview("revise");
            }}
          >
            {!loaded && <p role="status">Loading allowed attempts…</p>}
            {!!catalog.length && (
              <p className="muted">Times in {deviceTimeZone()}.</p>
            )}
            {!username && (
              <>
                <p>Select unused attempts to change or cancel.</p>
                <div className="actions">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !catalog.some(grantUnused) ||
                      catalog.filter(grantUnused).length > 200
                    }
                    onClick={() =>
                      setSelected(
                        new Set(catalog.filter(grantUnused).map((g) => g.id)),
                      )
                    }
                  >
                    Select unused attempts
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </button>
                </div>
                <p>
                  {selectedGrants.length}{" "}
                  {selectedGrants.length === 1 ? "attempt" : "attempts"} for{" "}
                  {selectedNames.length}{" "}
                  {selectedNames.length === 1 ? "student" : "students"} selected
                </p>
                {selectedGrants.length > 200 && (
                  <p role="alert">Choose up to 200 unused attempts.</p>
                )}
              </>
            )}
            {!!noUnused.length && (
              <p>No unused attempts for: {noUnused.join(", ")}.</p>
            )}
            {username && !editingGrant && attemptGroups}
            {(!username || editingGrant) && (
              <>
                {editingGrant && (
                  <h3 id={`${formId}-editor`}>
                    Editing: {title(editingGrant)} ·{" "}
                    {shortDateTime(editingGrant.issued_at)}
                  </h3>
                )}
                <fieldset
                  key={editingGrant?.id ?? "bulk-editor"}
                  disabled={busy || !selectedGrants.length}
                >
                  {exam === "sandbox" && (
                    <p>
                      Practice uses five minutes, optional webcam and four
                      terminals.
                    </p>
                  )}
                  <label>
                    Time limit (minutes)
                    <input
                      id={`${formId}-duration`}
                      type="number"
                      min={1}
                      max={360}
                      step={1}
                      placeholder={
                        exam === "sandbox"
                          ? "Fixed at 5"
                          : editingGrant
                            ? "Keep current time limit"
                            : "Unchanged"
                      }
                      disabled={exam === "sandbox"}
                      value={
                        draft.duration ??
                        (editingGrant &&
                        editingGrant.settings.duration % 60 === 0
                          ? String(editingGrant.settings.duration / 60)
                          : "")
                      }
                      onChange={(e) =>
                        setDraft({ ...draft, duration: e.target.value })
                      }
                    />
                  </label>
                  {editingGrant &&
                    editingGrant.settings.duration % 60 !== 0 && (
                      <p>
                        Current time limit:{" "}
                        {timeLimit(editingGrant.settings.duration)}. Leave blank
                        to keep it.
                      </p>
                    )}
                  <label>
                    Webcam
                    <select
                      disabled={exam === "sandbox"}
                      value={webcam}
                      onChange={(e) => setWebcam(e.target.value)}
                    >
                      {!editingGrant && <option value="keep">Unchanged</option>}
                      <option value="true">Required</option>
                      <option value="false">Optional</option>
                    </select>
                  </label>
                  {!editingGrant && (
                    <label>
                      Start window
                      <select
                        value={windowMode}
                        onChange={(e) => setWindowMode(e.target.value)}
                      >
                        <option value="keep">Unchanged</option>
                        <option value="set">Set dates</option>
                      </select>
                    </label>
                  )}
                  {windowMode === "set" && (
                    <fieldset>
                      <legend>Start window</legend>
                      <LocalDateTimeInput
                        label="Opens"
                        value={opens}
                        onChange={setOpens}
                        occurrence={openOccurrence}
                        onOccurrence={setOpenOccurrence}
                        required={!!editingGrant}
                      />
                      <LocalDateTimeInput
                        label="Closes"
                        value={closes}
                        onChange={setCloses}
                        occurrence={closeOccurrence}
                        onOccurrence={setCloseOccurrence}
                        required={!!editingGrant}
                      />
                      {!editingGrant && (
                        <small>Leave either date blank to keep it.</small>
                      )}
                    </fieldset>
                  )}
                  <section
                    key={editingGrant?.id ?? "bulk-files"}
                    aria-label="Starting file settings"
                  >
                    <label>
                      Starting files
                      <select
                        value={workMode}
                        onChange={(e) => {
                          if (
                            e.target.value === "saved" &&
                            workMode !== "saved"
                          )
                            setSourceLoading(true);
                          setWorkChanged(true);
                          setWorkMode(e.target.value);
                        }}
                      >
                        {!editingGrant && (
                          <option value="keep">Keep current files</option>
                        )}
                        <option value="empty">Empty folder</option>
                        <option value="template">
                          Published starter files
                        </option>
                        <option value="saved">
                          Use files from an earlier attempt
                        </option>
                      </select>
                    </label>
                    {workMode === "template" && (
                      <TemplatePicker
                        name={workName}
                        hash={workHash}
                        onChange={(name, hash) => {
                          setWorkChanged(true);
                          setWorkName(name);
                          setWorkHash(hash);
                        }}
                      />
                    )}
                    {workMode === "saved" && (
                      <>
                        {editingGrant?.work.kind === "saved" &&
                          (sourceLoading ||
                            sourceError ||
                            !sources.some(
                              (s) => s.id === editingGrant.work.attempt,
                            )) && (
                            <p>
                              Current files:{" "}
                              {workLabel(
                                editingGrant.work,
                                [snapshots[editingGrant.id]?.source].filter(
                                  Boolean,
                                ),
                              )}
                            </p>
                          )}
                        {sourceExams.length === 1 ? (
                          <p>From exam: {sourceExamLabel}</p>
                        ) : (
                          <label>
                            From exam
                            <select
                              value={sourceExam}
                              onChange={(e) => {
                                setWorkChanged(true);
                                setSourceLoading(true);
                                setSources([]);
                                setSourceExam(e.target.value);
                                setSavedChoices({});
                              }}
                            >
                              {sourceExams.map((value) => (
                                <option key={value.id} value={value.id}>
                                  {examChoiceLabel(value)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {examError && (
                          <div role="alert">
                            <p>Could not load exam choices.</p>
                            <RefreshButton
                              label="Refresh exams"
                              onClick={() => void loadExams()}
                            />
                            <details>
                              <summary>Details</summary>
                              <p>{examError}</p>
                            </details>
                          </div>
                        )}
                        {sourceLoading && (
                          <p role="status">Loading saved work…</p>
                        )}
                        {sourceError && (
                          <div role="alert">
                            <p>Could not load saved work.</p>
                            <details>
                              <summary>Details</summary>
                              <p>{sourceError}</p>
                            </details>
                          </div>
                        )}
                        <RefreshButton
                          label="Refresh saved work"
                          disabled={sourceLoading}
                          onClick={() => {
                            setSourceLoading(true);
                            setSources([]);
                            setSourceReload((n) => n + 1);
                          }}
                        />
                        {!sourceLoading &&
                          !sourceError &&
                          selectedNames.map((name) => {
                            const usable = sources.filter(
                              (value) =>
                                value.username === name &&
                                savedWorkUsable(value),
                            );
                            let automatic: any = null,
                              tied = false;
                            try {
                              automatic = latestStarted(sources, name);
                            } catch {
                              tied = true;
                            }
                            const explicit = savedChoices[name] !== undefined,
                              currentSource =
                                editingGrant?.work.kind === "saved" &&
                                savedChoices[name] === editingGrant.work.attempt
                                  ? snapshots[editingGrant.id]?.source
                                  : null,
                              keepingCurrent =
                                editingGrant?.work.kind === "saved" &&
                                savedChoices[name] ===
                                  editingGrant.work.attempt,
                              chosen = explicit
                                ? usable.find(
                                    (value) => value.id === savedChoices[name],
                                  )
                                : automatic && savedWorkUsable(automatic)
                                  ? automatic
                                  : null;
                            if (!usable.length)
                              return (
                                <p key={name}>
                                  No saved files are available for {name} in{" "}
                                  {sourceExamLabel}.{" "}
                                  {editingGrant
                                    ? "Cancel editing to keep the current files."
                                    : sourceExams.length > 1
                                      ? "Choose another exam or keep the current files."
                                      : "Keep the current files."}
                                </p>
                              );
                            if (
                              usable.length === 1 &&
                              automatic &&
                              savedWorkUsable(automatic) &&
                              (!explicit || chosen?.id === automatic.id)
                            )
                              return (
                                <p key={name}>
                                  {name}: {savedWorkLabel(automatic, sources)}
                                </p>
                              );
                            return (
                              <div key={name}>
                                {tied ? (
                                  <p>
                                    The latest attempt could not be identified.
                                    Choose an attempt or keep the current files.
                                  </p>
                                ) : automatic && !savedWorkUsable(automatic) ? (
                                  <p>
                                    The latest attempt’s saved files are not
                                    available. Choose an earlier attempt or keep
                                    the current files.
                                  </p>
                                ) : explicit &&
                                  savedChoices[name] &&
                                  !chosen &&
                                  !keepingCurrent ? (
                                  <p>
                                    The saved-file list changed. Choose the
                                    files again or keep the current files.
                                  </p>
                                ) : null}
                                <label>
                                  Saved work for {name}
                                  <select
                                    required={!editingGrant || workChanged}
                                    value={
                                      chosen?.id ??
                                      (keepingCurrent
                                        ? editingGrant.work.attempt
                                        : "")
                                    }
                                    onChange={(e) => {
                                      setWorkChanged(true);
                                      setSavedChoices((old) => ({
                                        ...old,
                                        [name]: e.target.value,
                                      }));
                                    }}
                                  >
                                    <option value="">Choose an attempt</option>
                                    {keepingCurrent && !chosen && (
                                      <option value={editingGrant.work.attempt}>
                                        Current files
                                        {currentSource
                                          ? `: ${savedWorkLabel(currentSource)}`
                                          : ""}
                                      </option>
                                    )}
                                    {usable.map((value) => (
                                      <option key={value.id} value={value.id}>
                                        {savedWorkLabel(value, sources)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {(chosen || keepingCurrent) && (
                                  <p className="selected-file-source">
                                    Selected files:{" "}
                                    {chosen
                                      ? savedWorkLabel(chosen, sources)
                                      : currentSource
                                        ? savedWorkLabel(currentSource)
                                        : "Current saved files"}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                      </>
                    )}
                  </section>
                  <details>
                    <summary>More settings</summary>
                    {numeric.map(([key, label, min, max]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={1}
                          disabled={exam === "sandbox" && key === "terminals"}
                          placeholder="Unchanged"
                          value={
                            draft[key] ??
                            (editingGrant
                              ? String(editingGrant.settings[key])
                              : "")
                          }
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        checked={materialChange}
                        onChange={(e) => setMaterialChange(e.target.checked)}
                      />
                      Change exam files
                    </label>
                    {materialChange && (
                      <TemplatePicker
                        label="Exam files"
                        name={materialName}
                        hash={materialHash}
                        onChange={(name, hash) => {
                          setMaterialName(name);
                          setMaterialHash(hash);
                        }}
                      />
                    )}
                  </details>
                </fieldset>
              </>
            )}
            {!username && attemptGroups}
          </form>
        )}
        {review && (
          <section className="grant-review" aria-label="Review unused changes">
            <h3>
              {review.some((r) => r.state === "review")
                ? "Review changes"
                : "Change results"}
            </h3>
            <p>
              {review.length} {review.length === 1 ? "attempt" : "attempts"}
              {dateChanges ? ` · Dates shown in ${deviceTimeZone()}` : ""}
            </p>
            {review.map((row) => (
              <article key={row.grant.id} className="clock-batch-row">
                <p role="status">
                  {
                    {
                      review: "Not applied",
                      noop: "No changes",
                      applying: "Applying…",
                      saved:
                        row.operation === "revoke"
                          ? "Cancelled"
                          : "Settings saved",
                      refused: "Not changed",
                      unknown: "Change unconfirmed",
                    }[row.state]
                  }
                </p>
                <h4>
                  {row.grant.username} · {title(row.grant)}
                </h4>
                {row.state !== "noop" && visibleChanges(row)}
                {needsCurrentStatus(row) && currentStatus(row)}
                {snapshots[row.grant.id]?.read_error && (
                  <p className="warn">
                    Current status unconfirmed. Refresh status to retry.
                  </p>
                )}
                {row.state === "saved" &&
                  row.result?.work.kind === "saved" &&
                  row.operation === "revise" && (
                    <SavedWorkSetup
                      id={row.grant.id}
                      revision={row.result.revision}
                      snapshot={snapshots[row.grant.id] ?? null}
                      onRefresh={() => setStatusRefresh((n) => n + 1)}
                    />
                  )}
                <details>
                  <summary>Details</summary>
                  {!needsCurrentStatus(row) && currentStatus(row)}
                  {row.error && <p>{row.error}</p>}
                  <details>
                    <summary>Technical details</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(
                        {
                          reference: row.grant.id,
                          request: row.body,
                          previous: row.grant.settings,
                          previous_files: row.grant.work,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </details>
              </article>
            ))}
          </section>
        )}
      </div>
      <div className="actions grant-dialog-actions">
        {!review && (!username || editingGrant) && (
          <>
            <button
              form={formId}
              type="submit"
              formNoValidate
              className="primary"
              disabled={
                busy ||
                (!!username && !editingGrant) ||
                !selectedGrants.length ||
                selectedGrants.length > 200 ||
                ((!username || workChanged) &&
                  workMode === "saved" &&
                  (sourceLoading || !!sourceError))
              }
            >
              Review changes
            </button>
            {!username && (
              <button
                disabled={
                  busy || !selectedGrants.length || selectedGrants.length > 200
                }
                onClick={() => void makeReview("revoke")}
              >
                Review cancellation
              </button>
            )}
          </>
        )}
        {review && !!pendingRows.length && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void apply()}
          >
            {unknown
              ? "Retry unconfirmed changes"
              : review[0].operation === "revoke"
                ? username
                  ? "Cancel attempt"
                  : "Cancel selected attempts"
                : "Apply changes"}
          </button>
        )}
        {review &&
          !unknown &&
          review.some((row) =>
            ["review", "refused", "noop"].includes(row.state),
          ) && (
            <button disabled={busy} onClick={() => void editAgain()}>
              {username && review[0].operation === "revoke"
                ? "Back to attempts"
                : "Back to editing"}
            </button>
          )}
        {review && (
          <RefreshButton
            label="Refresh status"
            disabled={busy}
            onClick={() => setStatusRefresh((n) => n + 1)}
          />
        )}
        {!review && (
          <RefreshButton
            label="Refresh"
            disabled={busy || !loaded}
            onClick={() => {
              setError("");
              void load().catch((e) => setError(e.message));
            }}
          />
        )}
        {!review && editingGrant ? (
          <button disabled={busy} onClick={cancelEditing}>
            Cancel editing
          </button>
        ) : (
          <button disabled={busy} onClick={close}>
            {review && !pendingRows.length ? "Done" : "Close"}
          </button>
        )}
      </div>
    </Modal>
  );
}
