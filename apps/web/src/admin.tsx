import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { api, chicago, remaining } from "./api.js";
import { Modal } from "./modal.js";
import { CreateAdministrator } from "./create-administrator.js";
import { ExamSettings } from "./exam-settings.js";
import { StudentImport } from "./student-import.js";
import { StudentActions, type StudentAction } from "./student-actions.js";
function accountAccess(a: any) {
  if (a.functional_test)
    return "Administrator functional test; ordinary SSH remains available";
  if (a.access_state === "OVERRIDDEN")
    return "Ordinary access released by administrator override";
  if (a.access_state === "RELEASED") return "Ordinary access released";
  if (a.start)
    return `Ordinary access blocked until at least ${chicago(Math.max(a.original_deadline || 0, a.deadline || 0))} and secured collection`;
  return "Account access restriction not started";
}
function Replay({ id, pane }: { id: string; pane: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<any[]>([]),
    [position, setPosition] = useState(0);
  const terminal = useRef<Terminal | null>(null);
  useEffect(() => {
    const t = new Terminal({
      disableStdin: true,
      scrollback: 2000,
      cols: 100,
      rows: 24,
    });
    terminal.current = t;
    t.parser.registerOscHandler(52, () => true);
    t.parser.registerOscHandler(8, () => true);
    t.open(root.current!);
    api(`/admin/attempts/${id}/recordings/${pane}`).then((text) => {
      setEvents(
        text
          .split("\n")
          .filter(Boolean)
          .map((s: string) => JSON.parse(s)),
      );
    });
    return () => t.dispose();
  }, [id, pane]);
  useEffect(() => {
    const t = terminal.current;
    if (!t) return;
    t.reset();
    for (const e of events.slice(0, position + 1)) {
      if (e.event === "output")
        t.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
      if (e.event === "resize") t.resize(e.cols, e.rows);
    }
  }, [events, position]);
  return (
    <>
      <label>
        Replay position {chicago(events[position]?.at)}
        <input
          type="range"
          min="0"
          max={Math.max(0, events.length - 1)}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </label>
      <div ref={root} />
    </>
  );
}
export function Admin({ onError }: { onError: (s: string) => void }) {
  const [exams, setExams] = useState<any[]>([]),
    [exam, setExam] = useState("");
  const [data, setData] = useState<any>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0),
    [stale, setStale] = useState(false),
    [clock, setClock] = useState(Date.now());
  const [notice, setNotice] = useState(""),
    [creatingAdmin, setCreatingAdmin] = useState(false);
  const [editingExam, setEditingExam] = useState<any>(null),
    [addingStudent, setAddingStudent] = useState(false);
  const [studentSelection, setStudentSelection] = useState(new Set<string>()),
    [attemptSelection, setAttemptSelection] = useState(new Set<string>());
  const [studentAction, setStudentAction] = useState("duration"),
    [attemptAction, setAttemptAction] = useState("reset");
  const [operation, setOperation] = useState<StudentAction | null>(null),
    [removing, setRemoving] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null),
    [media, setMedia] = useState<any>(null),
    [pane, setPane] = useState("");
  const [sound, setSound] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  useEffect(() => {
    if (studentSelection.size || attemptSelection.size) setBulkOpen(true);
  }, [studentSelection.size, attemptSelection.size]);
  const examRef = useRef(exam);
  examRef.current = exam;
  const seenLoaded = useRef(false);
  const reviewVersion = useRef(0);
  const requestVersion = useRef(0),
    serverOffset = useRef(0),
    seen = useRef(new Set<string>());
  const refresh = async () => {
    const id = examRef.current,
      version = ++requestVersion.current;
    const [list, result] = await Promise.all([
      api("/admin/exams"),
      id
        ? api(
            `/admin/exams/${id}/dashboard?q=${encodeURIComponent(search)}&offset=${offset}`,
          )
        : Promise.resolve(null),
    ]);
    if (version !== requestVersion.current || id !== examRef.current) return;
    setExams(list);
    setData(result);
    setStale(false);
    if (!result) return;
    serverOffset.current = result.serverNow - Date.now();
    setClock(result.serverNow);
    for (const i of result.incidents) {
      if (seenLoaded.current && !seen.current.has(i.id)) {
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        )
          new Notification("Exam needs attention", {
            body: `${list.find((e: any) => e.id === id)?.name || id}: instructor review requested`,
          });
        if (sound) {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.2);
          osc.onended = () => void ctx.close();
        }
      }
      seen.current.add(i.id);
    }
    seenLoaded.current = true;
  };
  const chooseExam = (id: string) => {
    ++requestVersion.current;
    ++reviewVersion.current;
    examRef.current = id;
    setExam(id);
    setData(null);
    setSearch("");
    setOffset(0);
    setFilter("");
    setNotice("");
    setStudentSelection(new Set());
    setAttemptSelection(new Set());
    setSelected(null);
    setMedia(null);
    setOperation(null);
    seen.current.clear();
    seenLoaded.current = false;
  };
  const closeReview = () => {
    ++reviewVersion.current;
    setSelected(null);
    setMedia(null);
    setPane("");
  };
  const openReview = async (a: any) => {
    const version = ++reviewVersion.current;
    setSelected(a);
    setPane("");
    setMedia(null);
    try {
      const result = await api(`/admin/attempts/${a.id}/recordings`);
      if (version === reviewVersion.current && examRef.current === a.exam)
        setMedia(result);
    } catch (error) {
      if (version === reviewVersion.current && examRef.current === a.exam)
        onError((error as Error).message);
    }
  };
  const action = async (fn: () => Promise<any>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  useEffect(() => {
    let mounted = true;
    const load = () =>
      void refresh().catch(() => {
        if (mounted) setStale(true);
      });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      mounted = false;
      ++requestVersion.current;
      clearInterval(timer);
    };
  }, [exam, search, offset, sound]);
  useEffect(() => {
    const timer = setInterval(
      () => setClock(Date.now() + serverOffset.current),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const current = exams.find((e) => e.id === exam);
  const students = data?.students || [];
  const eligible = (a: any) =>
    ["ACTIVE", "LOCKED"].includes(a.state) &&
    a.deadline > clock &&
    !a.protected &&
    !a.pendingClockReset;
  const toggle = (
    value: string,
    selected: Set<string>,
    setter: (s: Set<string>) => void,
  ) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    setter(next);
  };
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
  const status = (a: any) =>
    a.working
      ? "Working"
      : a.state === "ACTIVE"
        ? "Disconnected"
        : a.state === "PREPARING"
          ? "Preflight"
          : a.state;
  const visible = students
    .map((s: any) => ({
      ...s,
      attempts: s.attempts.filter(
        (a: any) =>
          !filter ||
          (filter === "camera"
            ? JSON.parse(a.settings).webcam
            : filter === "no-camera"
              ? !JSON.parse(a.settings).webcam
              : a.state === filter),
      ),
    }))
    .filter((s: any) => !filter || s.attempts.length);
  return (
    <div className="admin">
      <header>
        <h1>Exams</h1>
        <label>
          Selected exam
          <select
            aria-label="Selected exam"
            value={exam}
            onChange={(e) => chooseExam(e.target.value)}
          >
            <option value="">Select an exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name === e.id ? e.name : `${e.name} · ${e.id}`}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setEditingExam({})}>New exam</button>
        <details className="alert-settings">
          <summary>Alerts</summary>
          <div>
            <button
              onClick={() =>
                action(async () => {
                  if (typeof Notification === "undefined")
                    throw Error(
                      "Desktop notifications are unavailable in this browser",
                    );
                  await Notification.requestPermission();
                })
              }
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
              onClick={() => action(() => api("/admin/notifications/test", {}))}
            >
              Test email alert
            </button>
          </div>
        </details>
        <button onClick={() => setCreatingAdmin(true)}>
          Add administrator
        </button>
        <button
          onClick={() =>
            action(async () => {
              await api("/admin/logout", {});
              location.reload();
            })
          }
        >
          Sign out
        </button>
      </header>
      {notice && <p role="status">{notice}</p>}
      {!exam && <p>Select an exam to manage its students and attempts.</p>}
      {exam && (
        <>
          <div className="section-title">
            <h2>{current?.name || exam}</h2>
            <span className={stale ? "status warn" : "status"}>
              {stale ? "Data stale · connection lost" : "Live"}
            </span>
            <button onClick={() => setEditingExam(current)}>
              Exam settings
            </button>
            <button onClick={() => setAddingStudent(true)}>Add student</button>
          </div>
          {data && (
            <>
              <section className="metrics">
                <div>
                  <b>{data.counts.active}</b>Active
                </div>
                <div>
                  <b>{data.counts.locked}</b>Need review
                </div>
                <div>
                  <b>{data.counts.collected}</b>Collected
                </div>
              </section>
              <section className="card">
                <div className="section-title">
                  <h2>Students & attempts</h2>
                  <input
                    aria-label="Search username"
                    placeholder="Search username"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                      setStudentSelection(new Set());
                      setAttemptSelection(new Set());
                    }}
                  />
                  <select
                    aria-label="Filter attempts"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setStudentSelection(new Set());
                      setAttemptSelection(new Set());
                    }}
                  >
                    <option value="">All states</option>
                    <option value="camera">Webcam required</option>
                    <option value="no-camera">Webcam not required</option>
                    {[
                      "PREPARING",
                      "ACTIVE",
                      "LOCKED",
                      "FINALIZING",
                      "COMPLETED",
                      "COLLECTION_FAILED",
                      "CANCELLED_BEFORE_START",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <details
                  open={bulkOpen}
                  onToggle={(e) => setBulkOpen(e.currentTarget.open)}
                >
                  <summary>
                    Bulk actions
                    {studentSelection.size || attemptSelection.size
                      ? ` · ${studentSelection.size} students · ${attemptSelection.size} attempts`
                      : ""}
                  </summary>
                  <div className="bulk-actions" aria-label="Bulk actions">
                    <button
                      onClick={() =>
                        setStudentSelection(
                          new Set(
                            visible
                              .filter((s: any) => s.enrollment)
                              .map((s: any) => s.username),
                          ),
                        )
                      }
                    >
                      Select students on this page
                    </button>
                    <button
                      onClick={() =>
                        setAttemptSelection(
                          new Set(
                            visible.flatMap((s: any) =>
                              s.attempts.filter(eligible).map((a: any) => a.id),
                            ),
                          ),
                        )
                      }
                    >
                      Select current attempts
                    </button>
                    <button
                      disabled={
                        !studentSelection.size && !attemptSelection.size
                      }
                      onClick={() => {
                        setStudentSelection(new Set());
                        setAttemptSelection(new Set());
                      }}
                    >
                      Clear selection
                    </button>
                    <label>
                      Student action
                      <select
                        aria-label="Student action"
                        value={studentAction}
                        onChange={(e) => setStudentAction(e.target.value)}
                      >
                        <option value="duration">Set duration</option>
                        <option value="webcam">Set webcam requirement</option>
                      </select>
                    </label>
                    <button
                      disabled={!studentSelection.size}
                      onClick={() =>
                        openOperation(
                          studentAction,
                          students.filter((s: any) =>
                            studentSelection.has(s.username),
                          ),
                        )
                      }
                    >
                      Apply to {studentSelection.size}{" "}
                      {studentSelection.size === 1 ? "student" : "students"}
                    </button>
                    <label>
                      Attempt action
                      <select
                        aria-label="Attempt action"
                        value={attemptAction}
                        onChange={(e) => setAttemptAction(e.target.value)}
                      >
                        <option value="reset">Reset clock</option>
                        <option value="extend">Extend time</option>
                      </select>
                    </label>
                    <button
                      disabled={
                        !attemptSelection.size || attemptSelection.size > 100
                      }
                      onClick={() =>
                        openOperation(
                          attemptAction,
                          students.flatMap((s: any) =>
                            s.attempts.filter((a: any) =>
                              attemptSelection.has(a.id),
                            ),
                          ),
                        )
                      }
                    >
                      Apply to {attemptSelection.size}{" "}
                      {attemptSelection.size === 1 ? "attempt" : "attempts"}
                    </button>
                  </div>
                </details>
                <div className="table-scroll">
                  <table aria-label="Students and attempts">
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>Student / attempt</th>
                        <th>Status</th>
                        <th>Webcam</th>
                        <th>Time remaining</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    {visible.map((s: any) => (
                      <tbody key={s.username} aria-label={s.username}>
                        <tr className="student-row">
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select student ${s.username}`}
                              disabled={!s.enrollment}
                              checked={studentSelection.has(s.username)}
                              onChange={() =>
                                toggle(
                                  s.username,
                                  studentSelection,
                                  setStudentSelection,
                                )
                              }
                            />
                          </td>
                          <td>
                            <strong>{s.username}</strong>
                            {s.enrollment?.display_name && (
                              <small>{s.enrollment.display_name}</small>
                            )}
                            <small>
                              {s.enrollment
                                ? `Future duration: ${(s.enrollment.duration ?? current?.duration) / 60} minutes${s.enrollment.duration === null ? " · exam default" : ""}`
                                : "Not enrolled"}
                            </small>
                          </td>
                          <td>
                            {s.attempts.length
                              ? `${s.attempts.length} attempts`
                              : "Not started"}
                          </td>
                          <td>
                            {s.enrollment && (
                              <>
                                <span>
                                  Future:{" "}
                                  {(
                                    s.enrollment.webcam === null
                                      ? current?.webcam
                                      : !!s.enrollment.webcam
                                  )
                                    ? "Required"
                                    : "Not required"}
                                </span>
                                {s.enrollment.webcam === null && (
                                  <small>Exam default</small>
                                )}
                              </>
                            )}
                          </td>
                          <td>—</td>
                          <td>
                            {s.enrollment && (
                              <>
                                <button
                                  onClick={() => openOperation("duration", [s])}
                                >
                                  Set duration
                                </button>
                                <button
                                  onClick={() => openOperation("webcam", [s])}
                                >
                                  Set webcam
                                </button>
                                <button
                                  className="danger"
                                  aria-label={`Remove ${s.username} from exam`}
                                  onClick={() => setRemoving(s.username)}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        {s.attempts.map((a: any, i: number) => (
                          <tr key={a.id} className="attempt-row">
                            <td>
                              {["ACTIVE", "LOCKED"].includes(a.state) && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select attempt ${a.id}`}
                                  disabled={!eligible(a)}
                                  checked={attemptSelection.has(a.id)}
                                  onChange={() =>
                                    toggle(
                                      a.id,
                                      attemptSelection,
                                      setAttemptSelection,
                                    )
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <span>Attempt {a.attempt_number}</span>
                              <small>
                                {a.start ? chicago(a.start) : "Preflight"}
                              </small>
                            </td>
                            <td>
                              <span
                                className={
                                  a.state === "LOCKED" ||
                                  a.state === "COLLECTION_FAILED"
                                    ? "badge warn"
                                    : "badge"
                                }
                              >
                                {status(a)}
                              </span>
                              {a.reason && <small>{a.reason}</small>}
                              {a.protected && (
                                <small>Submission secured on SSH server</small>
                              )}
                            </td>
                            <td>
                              {JSON.parse(a.settings).webcam
                                ? "Required"
                                : "Not required"}
                              <small>For this attempt</small>
                            </td>
                            <td>
                              {["ACTIVE", "LOCKED"].includes(a.state)
                                ? remaining(a.deadline, clock)
                                : "—"}
                              {a.deadline && (
                                <small>Deadline: {chicago(a.deadline)}</small>
                              )}
                              {a.pendingClockReset && (
                                <small className="warn">
                                  Clock change pending agent confirmation
                                </small>
                              )}
                            </td>
                            <td>
                              {["ACTIVE", "LOCKED"].includes(a.state) && (
                                <>
                                  {" "}
                                  <button
                                    disabled={!eligible(a)}
                                    aria-label={`Reset clock for ${s.username}`}
                                    onClick={() => openOperation("reset", [a])}
                                  >
                                    Reset clock
                                  </button>
                                  <button
                                    disabled={!eligible(a)}
                                    aria-label={`Extend time for ${s.username}`}
                                    onClick={() => openOperation("extend", [a])}
                                  >
                                    Extend time
                                  </button>
                                </>
                              )}
                              <button onClick={() => void openReview(a)}>
                                Review
                              </button>
                              {a.state === "LOCKED" && (
                                <button
                                  onClick={() =>
                                    action(() =>
                                      api(
                                        `/admin/attempts/${a.id}/authorize`,
                                        {},
                                      ),
                                    )
                                  }
                                >
                                  Authorize resume
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                  {!visible.length && <p>No students match this view.</p>}
                </div>
                {(offset > 0 || data.total > 100) && (
                  <div>
                    <button
                      disabled={!offset}
                      onClick={() => {
                        setOffset(Math.max(0, offset - 100));
                        setStudentSelection(new Set());
                        setAttemptSelection(new Set());
                      }}
                    >
                      Previous
                    </button>
                    <span>
                      {offset + 1}–{Math.min(offset + 100, data.total)} of{" "}
                      {data.total} students
                    </span>
                    <button
                      disabled={offset + 100 >= data.total}
                      onClick={() => {
                        setOffset(offset + 100);
                        setStudentSelection(new Set());
                        setAttemptSelection(new Set());
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
              <StudentImport
                key={exam}
                exam={exam}
                onDone={async () => {
                  setNotice(
                    "Import completed. Future attempt settings updated.",
                  );
                  await refresh();
                }}
              />
              {!!data.incidents.length && (
                <section className="card">
                  <details>
                    <summary>Exam activity</summary>
                    {data.incidents.map((i: any) => (
                      <p key={i.id}>
                        {chicago(i.opened)} · {i.attempt} ·{" "}
                        {JSON.parse(i.events)
                          .map((e: any) => e.reason)
                          .join("; ")}
                        {i.message && ` · Student: ${i.message}`}
                      </p>
                    ))}
                  </details>
                </section>
              )}
            </>
          )}
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
            setEditingExam(null);
            chooseExam(e.id);
            await refresh();
          }}
        />
      )}
      {addingStudent && current && (
        <StudentImport
          exam={exam}
          adding
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
          onClose={() => setOperation(null)}
          onDone={async (text) => {
            setNotice(text);
            setStudentSelection(new Set());
            setAttemptSelection(new Set());
            setBulkOpen(false);
            await refresh();
          }}
        />
      )}
      {removing && (
        <Modal
          title={`Remove ${removing} from this exam?`}
          onClose={() => setRemoving(null)}
        >
          <p>
            Enrollment is removed. Attempt history, monitoring and SSH-server
            submissions are kept. An exam already in progress continues.
          </p>
          <div className="actions">
            <button onClick={() => setRemoving(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() =>
                action(async () => {
                  await api(`/admin/exams/${exam}/roster/remove`, {
                    username: removing,
                    confirm: true,
                  });
                  setRemoving(null);
                  await refresh();
                })
              }
            >
              Remove student
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          wide
          title={`${selected.username} · ${selected.state}`}
          onClose={() => {
            closeReview();
          }}
        >
          <button
            onClick={() => {
              closeReview();
            }}
          >
            Close review
          </button>
          {
            <>
              {selected.state === "CANCELLED_BEFORE_START" ? (
                <p>
                  Preflight ended before activation. No exam time was consumed.
                  The student can sign in again and retry preflight.
                </p>
              ) : (
                <>
                  <p>
                    Original deadline:{" "}
                    {chicago(selected.original_deadline || selected.deadline)}
                  </p>
                  <p>
                    {accountAccess(selected)}. Finishing never reopens exam
                    access.
                  </p>
                  {selected.access_override && (
                    <p>Audited override: {selected.access_override}</p>
                  )}
                  {selected.access_error && (
                    <p className="error">
                      Access recovery: {selected.access_error}
                    </p>
                  )}
                  <p>
                    {selected.protected
                      ? "Submission secured"
                      : "Protected submission not confirmed"}{" "}
                    · Retained on the SSH server
                  </p>
                  <details>
                    <summary>Collection details</summary>
                    {selected.access_checked_at && (
                      <p>
                        Class-server access state last checked:{" "}
                        {chicago(selected.access_checked_at)}
                      </p>
                    )}
                    <p>
                      Execution ended:{" "}
                      {selected.completed_at
                        ? chicago(selected.completed_at)
                        : "Not confirmed"}{" "}
                      · Collected:{" "}
                      {selected.collected_at
                        ? chicago(selected.collected_at)
                        : "Not confirmed"}{" "}
                      · Secured:{" "}
                      {selected.secured_at
                        ? chicago(selected.secured_at)
                        : "Not confirmed"}
                    </p>
                    <p>
                      Collection: {selected.reason || "Not ended"} · protected
                      copy:{" "}
                      {selected.protected
                        ? "Verified on class server"
                        : "Not confirmed"}{" "}
                      · source: {selected.work_path || "/work"}
                    </p>
                    {selected.checksum && (
                      <p>
                        SHA-256: <code>{selected.checksum}</code>
                      </p>
                    )}
                  </details>
                </>
              )}
              {media?.manifest && (
                <details>
                  <summary>Collection manifest and omissions</summary>
                  <pre>{JSON.stringify(media.manifest, null, 2)}</pre>
                </details>
              )}
              {media && (
                <>
                  <div className="images">
                    {["screen", "webcam"].map((source) => {
                      const frames = media.frames.filter(
                        (f: any) => f.source === source,
                      );
                      if (
                        source === "webcam" &&
                        !JSON.parse(selected.settings).webcam &&
                        !frames.length
                      )
                        return null;
                      const latest = frames.at(-1);
                      return latest ? (
                        <figure key={source}>
                          <img src={`/api/admin/media/${latest.id}`} />
                          <figcaption>
                            {source} · captured {chicago(latest.captured)} ·
                            received {chicago(latest.received)}
                          </figcaption>
                        </figure>
                      ) : (
                        <p key={source}>{source}: no images</p>
                      );
                    })}
                  </div>
                  <label>
                    Image timeline
                    <select
                      onChange={(e) => {
                        const img =
                          document.querySelector<HTMLImageElement>(
                            "#timeline-image",
                          );
                        if (img) img.src = `/api/admin/media/${e.target.value}`;
                      }}
                    >
                      <option>Select image timestamp</option>
                      {media.frames.map((f: any) => (
                        <option key={f.id} value={f.id}>
                          {f.source} {chicago(f.captured)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <img id="timeline-image" className="timeline" />
                  <select
                    value={pane}
                    onChange={(e) => setPane(e.target.value)}
                  >
                    <option value="">Select terminal replay</option>
                    {media.terminals.map((r: any, index: number) => (
                      <option key={r.pane} value={r.pane}>
                        Terminal {index + 1}
                      </option>
                    ))}
                  </select>
                  {pane && <Replay id={selected.id} pane={pane} />}
                </>
              )}
              {selected.ended && (
                <details>
                  <summary>Delete monitoring</summary>
                  <button
                    className="danger"
                    onClick={() =>
                      action(async () => {
                        if (
                          !window.confirm(
                            "Permanently delete all monitoring for this attempt? The submission is kept.",
                          )
                        )
                          return;
                        await api(
                          `/admin/attempts/${selected.id}/delete-monitoring`,
                          { confirm: true },
                        );
                        setMedia(null);
                        setSelected(null);
                      })
                    }
                  >
                    Delete monitoring permanently (keeps submission)
                  </button>
                </details>
              )}
            </>
          }
        </Modal>
      )}
    </div>
  );
}
