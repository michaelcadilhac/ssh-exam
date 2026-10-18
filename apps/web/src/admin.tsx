import "./admin.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, chicago, remaining } from "./api.js";
import { Modal } from "./modal.js";
import { CreateAdministrator } from "./create-administrator.js";
import { ExamSettings } from "./exam-settings.js";
import { StudentImport } from "./student-import.js";
import { EnrollmentSetting } from "./enrollment-setting.js";
import { StudentActions, type StudentAction } from "./student-actions.js";
import { AdminMenu } from "./admin-menu.js";
import { AdminReview } from "./admin-review.js";
import {
  attemptStatus,
  clockEditable,
  webcamRequired,
  matchesDashboardView,
  type DashboardView,
} from "../../../packages/protocol/admin.js";
const filterLabels: [DashboardView, string][] = [
  ["", "All students"],
  ["working", "Working"],
  ["attention", "Needs attention"],
  ["secured", "Submission secured"],
  ["PREPARING", "Preflight"],
  ["ACTIVE", "Active attempts"],
  ["LOCKED", "Paused"],
  ["FINALIZING", "Collecting"],
  ["COMPLETED", "Completed"],
  ["COLLECTION_FAILED", "Collection failed"],
  ["CANCELLED_BEFORE_START", "Cancelled"],
  ["camera", "Webcam required"],
  ["no-camera", "Webcam not required"],
];
const startFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const attemptStarted = (n: number) => startFormat.format(n);
export function Admin({
  onError,
  onSignOut,
}: {
  onError: (s: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [exams, setExams] = useState<any[]>([]),
    [exam, setExam] = useState("");
  const [data, setData] = useState<any>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<DashboardView>("");
  const [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [stale, setStale] = useState(false),
    [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now()),
    [notice, setNotice] = useState("");
  const [creatingAdmin, setCreatingAdmin] = useState(false),
    [editingExam, setEditingExam] = useState<any>(null),
    [addingStudent, setAddingStudent] = useState(false),
    [alerts, setAlerts] = useState(false);
  const [bulkKind, setBulkKind] = useState(""),
    [selection, setSelection] = useState(new Set<string>());
  const [operation, setOperation] = useState<StudentAction | null>(null),
    [removing, setRemoving] = useState<string | null>(null),
    [removingBusy, setRemovingBusy] = useState(false),
    [removingError, setRemovingError] = useState("");
  const [selected, setSelected] = useState<any>(null),
    [sound, setSound] = useState(false),
    [signingOut, setSigningOut] = useState(false);
  const [alertsError, setAlertsError] = useState(""),
    [alertsNotice, setAlertsNotice] = useState(""),
    [alertsBusy, setAlertsBusy] = useState(false);
  const [permission, setPermission] = useState(
    typeof Notification === "undefined"
      ? "unavailable"
      : Notification.permission,
  );
  const query = useRef({ exam, search, filter, offset }),
    selectedRef = useRef<any>(null),
    soundRef = useRef(sound);
  query.current = { exam, search, filter, offset };
  soundRef.current = sound;
  const requestPending = useRef(0),
    lastUpdate = useRef(0);
  const version = useRef(0),
    serverOffset = useRef(0),
    seen = useRef(new Set<string>()),
    seenLoaded = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++version.current;
    };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++version.current,
      q = { ...query.current },
      review = selectedRef.current?.id;
    requestPending.current = request;
    try {
      const [list, result] = await Promise.all([
        api("/admin/exams"),
        q.exam
          ? api(
              `/admin/exams/${q.exam}/dashboard?q=${encodeURIComponent(q.search)}&offset=${q.offset}&view=${q.filter}${review ? `&review=${review}` : ""}`,
            )
          : Promise.resolve(null),
      ]);
      if (
        !mounted.current ||
        request !== version.current ||
        q.exam !== query.current.exam
      )
        return;
      lastUpdate.current = performance.now();
      setExams(list);
      setData(result);
      setStale(false);
      setLoading(false);
      setError("");
      if (!result) return;
      serverOffset.current = result.serverNow - Date.now();
      setClock(result.serverNow);
      if (selectedRef.current?.id === review) {
        const latest =
          result.reviewAttempt ||
          result.students
            .flatMap((s: any) => s.attempts)
            .find((a: any) => a.id === review);
        if (latest) {
          selectedRef.current = latest;
          setSelected(latest);
        }
      }
      for (const i of result.incidents) {
        if (seenLoaded.current && !seen.current.has(i.id)) {
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          )
            new Notification("Exam needs attention", {
              body: `${list.find((e: any) => e.id === q.exam)?.name || q.exam}: instructor review requested`,
            });
          if (soundRef.current) {
            const ctx = new AudioContext(),
              osc = ctx.createOscillator();
            osc.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            osc.onended = () => void ctx.close();
          }
        }
        seen.current.add(i.id);
      }
      seenLoaded.current = true;
    } catch (e) {
      if (mounted.current && request === version.current) {
        setStale(true);
        setLoading(false);
        setError((e as Error).message);
      }
    } finally {
      if (requestPending.current === request) requestPending.current = 0;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!requestPending.current) void refresh();
    }, 5000);
    return () => {
      ++version.current;
      clearInterval(timer);
    };
  }, [exam, search, offset, filter, refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => setClock(Date.now() + serverOffset.current),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (
      data &&
      lastUpdate.current &&
      performance.now() - lastUpdate.current > 15000
    )
      setStale(true);
  }, [clock, data]);
  const clearView = () => {
    ++version.current;
    setData(null);
    setLoading(true);
    setSelection(new Set());
    setNotice("");
    setError("");
  };
  const chooseExam = (id: string) => {
    clearView();
    query.current = { exam: id, search: "", filter: "", offset: 0 };
    setExam(id);
    setSearch("");
    setFilter("");
    setOffset(0);
    setBulkKind("");
    selectedRef.current = null;
    setSelected(null);
    setOperation(null);
    setRemoving(null);
    setAddingStudent(false);
    setEditingExam(null);
    seen.current.clear();
    seenLoaded.current = false;
  };
  const chooseFilter = (view: DashboardView) => {
    if (view === filter) return;
    clearView();
    setFilter(view);
    setOffset(0);
    query.current = { ...query.current, filter: view, offset: 0 };
  };
  const closeReview = () => {
    selectedRef.current = null;
    setSelected(null);
  };
  const openReview = (a: any) => {
    selectedRef.current = a;
    setSelected(a);
    void refresh();
  };
  const current = exams.find((e) => e.id === exam),
    students = data?.students || [];
  // The server filters before pagination; the client check also tolerates older cached responses.
  const visible = students
    .map((s: any) => ({
      ...s,
      attempts: s.attempts.filter((a: any) => matchesDashboardView(a, filter)),
    }))
    .filter((s: any) => !filter || s.attempts.length);
  const studentSettings = bulkKind === "duration" || bulkKind === "webcam";
  const candidates = studentSettings
    ? visible.filter((s: any) => s.enrollment)
    : visible.flatMap((s: any) =>
        s.attempts.filter((a: any) => clockEditable(a, clock)),
      );
  const keyOf = (a: any) => (studentSettings ? a.username : a.id);
  const chosen = candidates.filter((a: any) => selection.has(keyOf(a)));
  useEffect(() => {
    const valid = new Set(candidates.map(keyOf));
    setSelection((old) => {
      const next = new Set([...old].filter((id) => valid.has(id)));
      return next.size === old.size ? old : next;
    });
  }, [data, clock, bulkKind]);
  const toggle = (id: string) =>
    setSelection((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const openOperation = (kind: string, targets: any[]) =>
    setOperation({
      kind: kind as StudentAction["kind"],
      students: kind === "duration" || kind === "webcam" ? targets : [],
      attempts:
        kind === "reset" || kind === "extend"
          ? targets.map((a) => ({
              ...a,
              allowance:
                (students.find((s: any) => s.username === a.username)
                  ?.enrollment?.duration ?? current?.duration) / 60,
              requestID: crypto.randomUUID(),
            }))
          : [],
    });
  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } catch (e) {
      setSigningOut(false);
      onError((e as Error).message);
    }
  };
  const bulkType = studentSettings ? "students" : "attempts";
  return (
    <main className="admin admin-redesign">
      <header className="admin-header">
        <h1>Exams</h1>
        <label className="admin-exam-picker">
          <span className="visually-hidden">Selected exam</span>
          <select
            aria-label="Selected exam"
            value={exam}
            disabled={loading && !exams.length}
            onChange={(e) => chooseExam(e.target.value)}
          >
            <option value="">
              {loading && !exams.length ? "Loading exams…" : "Select an exam"}
            </option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name === e.id ? e.name : `${e.name} · ${e.id}`}
              </option>
            ))}
          </select>
        </label>
        <button className="quiet-button" onClick={() => setEditingExam({})}>
          New exam
        </button>
        <AdminMenu
          label={signingOut ? "Signing out…" : "Administration"}
          disabled={signingOut}
          actions={[
            {
              label: "Alerts",
              onSelect: () => {
                setAlertsError("");
                setAlertsNotice("");
                setAlerts(true);
              },
            },
            {
              label: "Add administrator",
              onSelect: () => setCreatingAdmin(true),
            },
            {
              label: signingOut ? "Signing out…" : "Sign out",
              disabled: signingOut,
              onSelect: () => void signOut(),
            },
          ]}
        >
          {signingOut ? "Signing out…" : "Administration"}
        </AdminMenu>
      </header>
      {error && (
        <div className="admin-service-error" role="alert">
          <span>
            {stale && data ? "Updates paused. " : ""}
            {error}
          </span>
          <button onClick={() => void refresh()}>Retry updates</button>
        </div>
      )}
      {stale && !error && (
        <div className="admin-service-error" role="alert">
          <span>Updates paused. Displayed information may be out of date.</span>
          <button onClick={() => void refresh()}>Retry updates</button>
        </div>
      )}
      {notice && (
        <div className="admin-notice" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {!exam ? (
        <section className="admin-start" aria-label="Choose an exam">
          {loading ? (
            <p role="status">Loading exams…</p>
          ) : (
            <>
              <h2>
                {exams.length
                  ? "Select an exam"
                  : stale
                    ? "Exam list unavailable"
                    : "Create your first exam"}
              </h2>
              <p>
                {exams.length
                  ? "Choose an exam above to manage students and review their work."
                  : stale
                    ? "Use Retry updates to load your exams."
                    : "Start with New exam to configure an exam and add students."}
              </p>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="admin-exam-heading">
            <div>
              <h2>{current?.name || exam}</h2>
              <p>
                {current
                  ? `${current.duration / 60} minutes · Webcam ${current.webcam ? "required" : "not required"} by default`
                  : "Loading exam settings…"}
              </p>
            </div>
            <div>
              <button
                onClick={() => setEditingExam(current)}
                disabled={!current}
              >
                Exam settings
              </button>
              <button
                className="primary"
                onClick={() => setAddingStudent(true)}
                disabled={!current}
              >
                Add student
              </button>
            </div>
          </section>
          <section className="admin-roster" aria-label="Students and attempts">
            <div
              className="admin-view-strip"
              role="group"
              aria-label="Exam overview"
            >
              {(
                [
                  ["", "All students", data?.counts.students ?? data?.total],
                  [
                    "working",
                    "Working",
                    data?.counts.working ?? data?.counts.active,
                  ],
                  [
                    "attention",
                    "Needs attention",
                    data?.counts.attention ?? data?.counts.locked,
                  ],
                  ["secured", "Secured", data?.counts.collected],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => chooseFilter(value)}
                >
                  {label}
                  <span>{count ?? "—"}</span>
                </button>
              ))}
              <span
                className={`admin-live ${stale ? "warning" : ""}`}
                role="status"
              >
                {stale ? "Updates paused" : loading ? "Updating…" : "Live"}
              </span>
            </div>
            <div className="admin-roster-tools">
              <label className="admin-search">
                <span className="visually-hidden">Search username</span>
                <input
                  aria-label="Search username"
                  placeholder="Find a student…"
                  maxLength={64}
                  value={search}
                  onChange={(e) => {
                    clearView();
                    setSearch(e.target.value);
                    setOffset(0);
                    query.current = {
                      ...query.current,
                      search: e.target.value,
                      offset: 0,
                    };
                  }}
                />
              </label>
              <label>
                <span className="visually-hidden">Filter attempts</span>
                <select
                  aria-label="Filter attempts"
                  value={filter}
                  onChange={(e) =>
                    chooseFilter(e.target.value as DashboardView)
                  }
                >
                  {filterLabels.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-bulk-picker">
                <span className="visually-hidden">Bulk action</span>
                <select
                  aria-label="Bulk action"
                  value={bulkKind}
                  onChange={(e) => {
                    setBulkKind(e.target.value);
                    setSelection(new Set());
                  }}
                >
                  <option value="">Bulk actions…</option>
                  <optgroup label="Student settings">
                    <option value="duration">Set duration</option>
                    <option value="webcam">Set webcam requirement</option>
                  </optgroup>
                  <optgroup label="Current attempt clocks">
                    <option value="reset">Reset clock</option>
                    <option value="extend">Extend time</option>
                  </optgroup>
                </select>
              </label>
            </div>
            {bulkKind && (
              <div
                className="admin-selection-bar"
                role="region"
                aria-label="Bulk selection"
              >
                <span>
                  <strong>
                    {chosen.length}{" "}
                    {chosen.length === 1 ? bulkType.slice(0, -1) : bulkType}{" "}
                    selected
                  </strong>{" "}
                  · {studentSettings ? "Student settings" : "Current clocks"}
                </span>
                <label className="admin-select-page">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${bulkType} on this page`}
                    checked={
                      !!candidates.length && chosen.length === candidates.length
                    }
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          chosen.length > 0 &&
                          chosen.length < candidates.length;
                    }}
                    onChange={(e) =>
                      setSelection(
                        new Set(e.target.checked ? candidates.map(keyOf) : []),
                      )
                    }
                    disabled={!candidates.length || stale}
                  />
                  Select page
                </label>
                <button
                  className="quiet-button"
                  onClick={() => {
                    setBulkKind("");
                    setSelection(new Set());
                  }}
                >
                  Cancel selection
                </button>
                <button
                  className="primary"
                  disabled={
                    !chosen.length ||
                    stale ||
                    (!studentSettings && chosen.length > 100)
                  }
                  onClick={() => openOperation(bulkKind, chosen)}
                >
                  Apply to {chosen.length}{" "}
                  {chosen.length === 1 ? bulkType.slice(0, -1) : bulkType}
                </button>
                {!studentSettings && chosen.length > 100 && (
                  <span className="warn">
                    Select at most 100 current attempts.
                  </span>
                )}
              </div>
            )}
            {loading && !data ? (
              <p className="admin-loading" role="status">
                Loading students…
              </p>
            ) : (
              data && (
                <>
                  {!visible.length ? (
                    <div className="admin-empty">
                      <h3>
                        {search || filter
                          ? "No matching students"
                          : "No students yet"}
                      </h3>
                      <p>
                        {search || filter
                          ? "Change the search or filter to see more students."
                          : "Add a student or upload a CSV roster to get started."}
                      </p>
                      {(search || filter) && (
                        <button
                          onClick={() => {
                            clearView();
                            setSearch("");
                            setFilter("");
                            setOffset(0);
                            query.current = {
                              ...query.current,
                              search: "",
                              filter: "",
                              offset: 0,
                            };
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="admin-roster-scroll">
                      <table
                        className={bulkKind ? "selecting" : undefined}
                        aria-label="Students and attempts"
                        role="table"
                      >
                        <thead>
                          <tr role="row">
                            {bulkKind && (
                              <th className="selection-cell">
                                <span className="visually-hidden">
                                  Selection
                                </span>
                              </th>
                            )}
                            <th>Student / attempt</th>
                            <th>Status</th>
                            <th>Webcam</th>
                            <th>Time remaining</th>
                            <th>
                              <span className="visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        {visible.map((s: any) => (
                          <tbody
                            role="rowgroup"
                            key={s.username}
                            aria-label={s.username}
                          >
                            <tr className="student-row" role="row">
                              {bulkKind && (
                                <td className="selection-cell" role="cell">
                                  {studentSettings && s.enrollment && (
                                    <input
                                      type="checkbox"
                                      aria-label={`Select student ${s.username}`}
                                      checked={selection.has(s.username)}
                                      disabled={stale}
                                      onChange={() => toggle(s.username)}
                                    />
                                  )}
                                </td>
                              )}
                              <td className="student-identity" role="cell">
                                <strong title={s.username}>{s.username}</strong>
                                {!s.enrollment && <small>Not enrolled</small>}
                              </td>
                              <td role="cell" className="student-history-count">
                                {s.attempts.length
                                  ? `${s.attempts.length} ${s.attempts.length === 1 ? "attempt" : "attempts"}`
                                  : "Not started"}
                              </td>
                              {(["webcam", "duration"] as const).map((kind) => (
                                <td
                                  key={kind}
                                  role="cell"
                                  className="enrollment-cell"
                                >
                                  {s.enrollment && (
                                    <EnrollmentSetting
                                      exam={current}
                                      student={s}
                                      kind={kind}
                                      disabled={stale}
                                      onSaved={refresh}
                                    />
                                  )}
                                </td>
                              ))}
                              <td role="cell" className="row-actions">
                                {s.enrollment && (
                                  <AdminMenu
                                    label={`Actions for student ${s.username}`}
                                    actions={[
                                      {
                                        label: "Remove from exam…",
                                        danger: true,
                                        disabled: stale,
                                        onSelect: () => {
                                          setRemovingError("");
                                          setRemoving(s.username);
                                        },
                                      },
                                    ]}
                                  />
                                )}
                              </td>
                            </tr>
                            {s.attempts.map((a: any) => {
                              const status = attemptStatus(a),
                                editable = !stale && clockEditable(a, clock),
                                webcam = webcamRequired(a);
                              return (
                                <tr
                                  key={a.id}
                                  className="attempt-row"
                                  role="row"
                                >
                                  {bulkKind && (
                                    <td className="selection-cell" role="cell">
                                      {!studentSettings &&
                                        ["ACTIVE", "LOCKED"].includes(
                                          a.state,
                                        ) && (
                                          <input
                                            type="checkbox"
                                            aria-label={`Select attempt ${a.id}`}
                                            checked={
                                              editable && selection.has(a.id)
                                            }
                                            disabled={!editable}
                                            onChange={() => toggle(a.id)}
                                          />
                                        )}
                                    </td>
                                  )}
                                  <td className="attempt-identity" role="cell">
                                    <span>Attempt {a.attempt_number}</span>
                                    {!!a.start && (
                                      <time
                                        dateTime={new Date(
                                          a.start,
                                        ).toISOString()}
                                        title={chicago(a.start)}
                                      >
                                        Started {attemptStarted(a.start)}
                                      </time>
                                    )}
                                  </td>
                                  <td role="cell">
                                    <span
                                      className={`attempt-status ${status.tone}`}
                                    >
                                      {status.label}
                                    </span>
                                    {!!a.reason &&
                                      (a.state === "LOCKED" ||
                                        a.state === "COLLECTION_FAILED") && (
                                        <small
                                          className="attempt-reason"
                                          title={a.reason}
                                        >
                                          {a.reason}
                                        </small>
                                      )}
                                  </td>
                                  <td role="cell" data-label="Webcam">
                                    {webcam === null
                                      ? "Unknown"
                                      : webcam
                                        ? "Required"
                                        : "Not required"}
                                  </td>
                                  <td
                                    role="cell"
                                    data-label="Time remaining"
                                    className="attempt-clock"
                                  >
                                    <time
                                      title={
                                        a.deadline
                                          ? `Deadline: ${chicago(a.deadline)}`
                                          : undefined
                                      }
                                    >
                                      {["ACTIVE", "LOCKED"].includes(a.state)
                                        ? remaining(a.deadline, clock)
                                        : "—"}
                                    </time>
                                    {a.pendingClockReset && (
                                      <small className="warn">
                                        Clock change pending
                                      </small>
                                    )}
                                  </td>
                                  <td role="cell" className="row-actions">
                                    <button
                                      className={
                                        a.state === "LOCKED"
                                          ? "review-needed"
                                          : "quiet-button"
                                      }
                                      onClick={() => openReview(a)}
                                    >
                                      Review
                                    </button>
                                    {["ACTIVE", "LOCKED"].includes(a.state) && (
                                      <AdminMenu
                                        label={`Actions for ${s.username} attempt ${a.attempt_number}`}
                                        children="More"
                                        actions={[
                                          {
                                            label: "Reset clock",
                                            disabled: !editable,
                                            onSelect: () =>
                                              openOperation("reset", [a]),
                                          },
                                          {
                                            label: "Extend time",
                                            disabled: !editable,
                                            onSelect: () =>
                                              openOperation("extend", [a]),
                                          },
                                        ]}
                                      />
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        ))}
                      </table>
                    </div>
                  )}
                  <footer className="admin-pagination">
                    <span>
                      {data.total
                        ? `${offset + 1}–${Math.min(offset + 100, data.total)} of ${data.total} students`
                        : "0 students"}
                    </span>
                    {(offset > 0 || data.total > 100) && (
                      <div>
                        <button
                          disabled={!offset}
                          onClick={() => {
                            clearView();
                            setOffset(Math.max(0, offset - 100));
                          }}
                        >
                          Previous
                        </button>
                        <button
                          disabled={offset + 100 >= data.total}
                          onClick={() => {
                            clearView();
                            setOffset(offset + 100);
                          }}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </footer>
                </>
              )
            )}
          </section>
        </>
      )}
      {creatingAdmin && (
        <CreateAdministrator
          onClose={() => setCreatingAdmin(false)}
          onCreated={(username) => {
            setCreatingAdmin(false);
            setNotice(`Administrator ${username} created.`);
          }}
        />
      )}
      {editingExam && (
        <ExamSettings
          initial={editingExam}
          onClose={() => setEditingExam(null)}
          onSaved={async (e) => {
            chooseExam(e.id);
            await refresh();
          }}
        />
      )}
      {addingStudent && current && (
        <StudentImport
          exam={exam}
          defaultWebcam={current.webcam}
          defaultDuration={current.duration}
          onClose={() => setAddingStudent(false)}
          onDone={async () => {
            setAddingStudent(false);
            await refresh();
          }}
        />
      )}
      {operation && current && (
        <StudentActions
          exam={current}
          operation={operation}
          clock={clock}
          onClose={() => setOperation(null)}
          onDone={async (text) => {
            setNotice(text);
            setSelection(new Set());
            await refresh();
          }}
        />
      )}
      {removing && (
        <Modal
          title={`Remove ${removing} from this exam?`}
          onClose={() => {
            if (!removingBusy) setRemoving(null);
          }}
        >
          <p>
            Enrollment is removed. Current attempts, history, monitoring and
            submissions are kept.
          </p>
          {removingError && (
            <p role="alert" className="warn">
              {removingError}
            </p>
          )}
          <div className="actions">
            <button disabled={removingBusy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={removingBusy}
              onClick={async () => {
                if (removingBusy) return;
                setRemovingBusy(true);
                setRemovingError("");
                try {
                  await api(`/admin/exams/${exam}/roster/remove`, {
                    username: removing,
                    confirm: true,
                  });
                  setRemoving(null);
                  await refresh();
                } catch (e) {
                  setRemovingError((e as Error).message);
                } finally {
                  setRemovingBusy(false);
                }
              }}
            >
              {removingBusy ? "Removing…" : "Remove student"}
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <AdminReview
          key={selected.id}
          attempt={selected}
          clock={clock}
          stale={stale}
          onClose={closeReview}
          onChanged={refresh}
        />
      )}
      {alerts && (
        <Modal title="Alerts" onClose={() => setAlerts(false)}>
          {alertsError && (
            <p role="alert" className="warn">
              {alertsError}
            </p>
          )}
          {alertsNotice && <p role="status">{alertsNotice}</p>}
          <p>
            Desktop alerts:{" "}
            {permission === "unavailable"
              ? "unavailable in this browser"
              : permission === "granted"
                ? "enabled"
                : permission === "denied"
                  ? "blocked in browser settings"
                  : "not enabled"}
          </p>
          <button
            disabled={permission === "unavailable" || permission === "granted"}
            onClick={async () => {
              try {
                setPermission(await Notification.requestPermission());
              } catch (e) {
                setAlertsError((e as Error).message);
              }
            }}
          >
            Enable desktop alerts
          </button>
          <label>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => setSound(e.target.checked)}
            />{" "}
            Attention sound
          </label>
          <button
            disabled={alertsBusy}
            onClick={async () => {
              if (alertsBusy) return;
              setAlertsBusy(true);
              setAlertsError("");
              setAlertsNotice("");
              try {
                await api("/admin/notifications/test", {});
                setAlertsNotice("Test email queued.");
              } catch (e) {
                setAlertsError((e as Error).message);
              } finally {
                setAlertsBusy(false);
              }
            }}
          >
            Test email alert
          </button>
          <div className="actions">
            <button onClick={() => setAlerts(false)}>Close</button>
          </div>
        </Modal>
      )}
    </main>
  );
}
