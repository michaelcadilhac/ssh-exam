import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { api, chicago, remaining, socket } from "./api.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { Modal } from "./modal.js";
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
    [exam, setExam] = useState(""),
    [data, setData] = useState<any>({
      attempts: [],
      incidents: [],
      outbox: [],
    }),
    [csv, setCsv] = useState("username,require_webcam\n"),
    [mode, setMode] = useState("csv"),
    [preview, setPreview] = useState<any>(null),
    [roster, setRoster] = useState<any[]>([]),
    [studentUsername, setStudentUsername] = useState(""),
    [studentWebcam, setStudentWebcam] = useState("inherit"),
    [resetting, setResetting] = useState<any>(null),
    [resetMinutes, setResetMinutes] = useState(90),
    [resetBusy, setResetBusy] = useState(false),
    [removing, setRemoving] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [offset, setOffset] = useState(0),
    [stale, setStale] = useState(false),
    [clock, setClock] = useState(Date.now()),
    [notice, setNotice] = useState(""),
    [media, setMedia] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [pane, setPane] = useState(""),
    [permission, setPermission] = useState(
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    ),
    [sound, setSound] = useState(false),
    [form, setForm] = useState<any>({
      id: "",
      name: "Programming exam",
      earliest: Date.now() - 60000,
      latest: Date.now() + 7 * 86400000,
      duration: 5400,
      webcam: true,
      terminals: 4,
      template: "sample-exam",
    });
  const serverOffset = useRef(0);
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const currentExam = useRef(exam);
  currentExam.current = exam;
  const reloadRoster = async () => {
    const rows = await api(`/admin/exams/${exam}/roster`);
    if (currentExam.current === exam) setRoster(rows);
  };
  const refresh = async () => {
    const [e, d] = await Promise.all([
      api("/admin/exams"),
      api(
        `/admin/attempts?q=${encodeURIComponent(search)}&state=${["camera", "no-camera"].includes(filter) ? "" : filter}&webcam=${filter === "camera" ? "1" : filter === "no-camera" ? "0" : ""}&offset=${offset}`,
      ),
    ]);
    setExams(e);
    if (!initialized.current && e.length) {
      initialized.current = true;
      setExam(e[0].id);
      setForm(e[0]);
    }
    serverOffset.current = d.serverNow - Date.now();
    setClock(d.serverNow);
    setData(d);
    if (currentExam.current) {
      const selectedExam = currentExam.current;
      const rows = await api(`/admin/exams/${selectedExam}/roster`);
      if (currentExam.current === selectedExam) setRoster(rows);
    }
    setStale(false);
    for (const i of d.incidents) {
      if (!seen.current.has(i.id) && seen.current.size) {
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        )
          new Notification("Exam needs attention", {
            body: `Attempt ${i.attempt}: instructor review requested`,
          });
        if (sound) {
          const context = new AudioContext();
          const osc = context.createOscillator();
          osc.connect(context.destination);
          osc.start();
          osc.stop(context.currentTime + 0.2);
        }
      }
      seen.current.add(i.id);
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
    const timer = setInterval(
      () => setClock(Date.now() + serverOffset.current),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setStale(true));
    const timer = setInterval(
      () => void refresh().catch(() => setStale(true)),
      5000,
    );
    return () => clearInterval(timer);
  }, [search, filter, offset, sound]);
  useEffect(() => {
    let current = true;
    if (exam)
      api(`/admin/exams/${exam}/roster`)
        .then((rows) => {
          if (current) setRoster(rows);
        })
        .catch((e) => {
          if (current) onError(e.message);
        });
    return () => {
      current = false;
    };
  }, [exam, preview]);
  const openClockReset = (a: any) => {
    setResetting({ ...a, requestID: crypto.randomUUID() });
    setResetMinutes(
      (exams.find((e: any) => e.id === a.exam)?.duration ||
        JSON.parse(a.settings).duration) / 60,
    );
  };
  const resetButton = (a: any) =>
    a && ["ACTIVE", "LOCKED"].includes(a.state) && a.deadline > clock ? (
      <button
        disabled={!!a.pendingClockReset}
        aria-label={`Reset clock for ${a.username}`}
        onClick={() => openClockReset(a)}
      >
        Reset clock
      </button>
    ) : null;
  return (
    <div className="admin">
      <header>
        <div>
          <h1>Exams</h1>
        </div>
        <span className={stale ? "status warn" : "status"}>
          {stale ? "Data stale · connection lost" : "Live"}
        </span>
        <details
          className="alert-settings"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.open = false;
              e.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>Alerts</summary>
          <div>
            <button
              onClick={() =>
                action(async () => {
                  setPermission(await Notification.requestPermission());
                  new Notification("Exam alert test", {
                    body: "Desktop notifications are enabled while this dashboard is open.",
                  });
                })
              }
            >
              Enable alerts ({permission})
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
      <section className="metrics">
        <div>
          <b>{data.attempts.filter((a: any) => a.state === "ACTIVE").length}</b>
          Active
        </div>
        <div>
          <b>{data.attempts.filter((a: any) => a.state === "LOCKED").length}</b>
          Need review
        </div>
        <div>
          <b>
            {data.attempts.filter((a: any) => a.state === "COMPLETED").length}
          </b>
          Collected
        </div>
        <div>
          <b>{data.outbox.filter((a: any) => a.status === "failed").length}</b>
          Email failures
        </div>
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Attempts</h2>
          <input
            placeholder="Search username"
            aria-label="Search username"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
          <select
            aria-label="Filter attempts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All states</option>
            <option value="camera">Webcam required</option>
            <option value="no-camera">Webcam not required</option>
            {[
              "ACTIVE",
              "LOCKED",
              "FINALIZING",
              "COMPLETED",
              "COLLECTION_FAILED",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table aria-label="Exam attempts">
            <thead>
              <tr>
                <th>Student / exam</th>
                <th>Status</th>
                <th>Monitoring</th>
                <th>Deadline · Chicago</th>
                <th>Submission / actions</th>
              </tr>
            </thead>
            <tbody>
              {data.attempts.map((a: any) => {
                const settings = JSON.parse(a.settings);
                return (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.username}</strong>
                      <small>{a.exam}</small>
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
                        {a.working
                          ? "Working"
                          : a.state === "ACTIVE"
                            ? "Disconnected"
                            : a.state}
                      </span>
                      <small>{a.reason}</small>
                      {["ACTIVE", "LOCKED"].includes(a.state) && (
                        <small>{a.terminalCount || 0} terminals</small>
                      )}
                    </td>
                    <td>
                      {settings.webcam ? "Screen + webcam" : "Screen only"}
                      <small>{accountAccess(a)}</small>
                      {["ACTIVE", "LOCKED"].includes(a.state) && (
                        <small>
                          Last contact:{" "}
                          {a.last_contact
                            ? Math.floor((clock - a.last_contact) / 1000) +
                              "s ago"
                            : "—"}
                        </small>
                      )}
                    </td>
                    <td>
                      {chicago(a.deadline)}
                      {a.pendingClockReset && (
                        <small className="warn">
                          Reset pending ·{" "}
                          {remaining(
                            a.pendingClockReset.requested_at +
                              a.pendingClockReset.remaining_seconds * 1000,
                            clock,
                          )}{" "}
                          requested
                        </small>
                      )}
                      {["ACTIVE", "LOCKED"].includes(a.state) && (
                        <small>{remaining(a.deadline, clock)}</small>
                      )}
                    </td>
                    <td>
                      {resetButton(a)}
                      <button
                        onClick={() =>
                          action(async () => {
                            setSelected(a);
                            setMedia(
                              await api(`/admin/attempts/${a.id}/recordings`),
                            );
                          })
                        }
                      >
                        Review
                      </button>
                      {a.state === "LOCKED" && (
                        <button
                          onClick={() =>
                            action(() =>
                              api(`/admin/attempts/${a.id}/authorize`, {}),
                            )
                          }
                        >
                          Authorize resume
                        </button>
                      )}
                      {a.export_status === "ready" && (
                        <a
                          className="button"
                          href={`/api/admin/attempts/${a.id}/submission`}
                        >
                          Download
                        </a>
                      )}
                      <small>
                        {a.protected
                          ? `Submission secured · transfer ${a.export_status || "pending"}`
                          : ["FINALIZING", "COLLECTION_FAILED"].includes(
                                a.state,
                              )
                            ? "Collection pending / failed"
                            : ""}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(offset > 0 || data.attempts.length >= 100) && (
          <div>
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </button>
            <button
              disabled={data.attempts.length < 100}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </button>
          </div>
        )}
      </section>
      <div className="admin-columns">
        <section className="card">
          <h2>Exams & settings</h2>
          <small>Changes apply to future attempts.</small>
          <label htmlFor="selected-exam">Selected exam</label>
          <select
            id="selected-exam"
            value={exam}
            onChange={(e) => {
              if (e.target.value === exam) return;
              setExam(e.target.value);
              setPreview(null);
              setNotice("");
              setRoster([]);
              const found = exams.find((x) => x.id === e.target.value);
              if (found) setForm(found);
              else setForm({ ...form, id: "", name: "Programming exam" });
            }}
          >
            <option value="">Create a new exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <label>
            Exam ID
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
            />
          </label>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Template ID
            <input
              value={form.template}
              onChange={(e) => setForm({ ...form, template: e.target.value })}
            />
          </label>
          {!isSandbox(form.id) && (
            <>
              <label>
                Earliest start
                <input
                  type="datetime-local"
                  value={new Date(
                    form.earliest -
                      new Date(form.earliest).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      earliest: new Date(e.target.value).getTime(),
                    })
                  }
                />
              </label>
              <label>
                Latest start
                <input
                  type="datetime-local"
                  value={new Date(
                    form.latest -
                      new Date(form.latest).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      latest: new Date(e.target.value).getTime(),
                    })
                  }
                />
              </label>
              <small>
                Start-window inputs use your device timezone; dashboard times
                are America/Chicago.
              </small>
            </>
          )}
          {isSandbox(form.id) && (
            <p>
              Repeatable · 5 minutes · no start window · automatic recovery
              approval
            </p>
          )}
          <label>
            Duration (minutes)
            <input
              type="number"
              disabled={isSandbox(form.id)}
              min="1"
              max="360"
              value={form.duration / 60}
              onChange={(e) =>
                setForm({ ...form, duration: Number(e.target.value) * 60 })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.webcam}
              onChange={(e) => setForm({ ...form, webcam: e.target.checked })}
            />{" "}
            Default webcam requirement
          </label>
          <label>
            Terminal limit
            <input
              type="number"
              min="1"
              max="4"
              value={form.terminals}
              onChange={(e) =>
                setForm({ ...form, terminals: Number(e.target.value) })
              }
            />
          </label>
          <button
            className="primary"
            onClick={() =>
              action(async () => {
                await api("/admin/exams", form);
                setExam(form.id);
              })
            }
          >
            Save exam
          </button>
        </section>
        <section className="card">
          <h2>Students in this exam</h2>
          <p>
            {exam
              ? exams.find((e) => e.id === exam)?.name || exam
              : "Save or select an exam to manage its students."}
          </p>
          <form
            className="add-student"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`/admin/exams/${exam}/roster/add`, {
                  username: studentUsername.trim(),
                  webcam:
                    studentWebcam === "inherit"
                      ? null
                      : studentWebcam === "true",
                });
                setNotice(`${studentUsername.trim()} added.`);
                setStudentUsername("");
                await reloadRoster();
              });
            }}
          >
            <label>
              Student username
              <input
                required
                pattern="[a-z][a-z0-9_-]{0,31}"
                value={studentUsername}
                onChange={(e) => setStudentUsername(e.target.value)}
              />
            </label>
            <label>
              Webcam for this student
              <select
                value={studentWebcam}
                onChange={(e) => setStudentWebcam(e.target.value)}
              >
                <option value="inherit">Exam default</option>
                <option value="true">Required</option>
                <option value="false">Not required</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={!exam || !studentUsername.trim()}
            >
              Add student
            </button>
          </form>
          <small>Use existing course-server accounts.</small>
          {notice && <p role="status">{notice}</p>}
          <div className="table-scroll roster-list">
            <table aria-label="Exam roster">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Webcam</th>
                  <th>Status</th>
                  <th>Time remaining</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.username}>
                    <td>
                      {r.username}
                      {r.display_name && <small>{r.display_name}</small>}
                    </td>
                    <td>
                      {(
                        r.webcam === null
                          ? exams.find((e) => e.id === exam)?.webcam
                          : !!r.webcam
                      )
                        ? "Required"
                        : "Not required"}
                      {r.webcam === null && <small>Exam default</small>}
                    </td>
                    <td>
                      {r.attempt
                        ? r.attempt.working
                          ? "Working"
                          : r.attempt.state === "ACTIVE"
                            ? "Disconnected"
                            : r.attempt.state === "PREPARING"
                              ? "Preflight"
                              : r.attempt.state
                        : "Not started"}
                    </td>
                    <td>
                      {r.attempt &&
                      ["ACTIVE", "LOCKED"].includes(r.attempt.state)
                        ? remaining(r.attempt.deadline, clock)
                        : "—"}
                    </td>
                    <td>
                      {resetButton(r.attempt)}
                      {r.attempt?.pendingClockReset && (
                        <small>Clock reset pending</small>
                      )}
                      <button
                        className="danger"
                        aria-label={`Remove ${r.username} from exam`}
                        onClick={() => setRemoving(r.username)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!roster.length && <p>No students enrolled.</p>}
          </div>
          <a
            className="button"
            href={exam ? `/api/admin/exams/${exam}/submissions` : "#"}
          >
            Download exam submissions
          </a>
          <details className="bulk-import">
            <summary>Import multiple students (CSV)</summary>
            <p>
              Import updates enrolled accounts; it never creates Unix accounts
              or removes omitted students.
            </p>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="csv">CSV with headers</option>
              <option value="lines">One username per line</option>
            </select>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size <= 10485760) void f.text().then(setCsv);
                else onError("File exceeds 10 MiB");
              }}
            />
            <textarea
              className="csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              aria-label="Roster CSV"
            />
            <button
              disabled={!exam}
              onClick={() =>
                action(async () =>
                  setPreview(
                    await api(`/admin/exams/${exam}/roster/import-preview`, {
                      text: csv,
                      mode,
                    }),
                  ),
                )
              }
            >
              Validate & preview
            </button>
            <a
              className="button"
              href={exam ? `/api/admin/exams/${exam}/roster/export` : "#"}
            >
              Export roster / template
            </a>
            {preview && (
              <>
                <p>
                  {preview.total} validated rows. Current attempts are
                  unchanged.
                </p>
                <div className="preview">
                  {preview.rows.slice(0, 100).map((r: any) => (
                    <p key={r.username}>
                      {r.action}: {r.username}
                      {r.activeAttempt ? " (current attempt unchanged)" : ""} ·
                      webcam{" "}
                      {r.webcam === undefined
                        ? "unchanged"
                        : r.webcam === null
                          ? "inherit"
                          : String(r.webcam)}{" "}
                      ·{" "}
                      {r.duration === undefined
                        ? "duration unchanged"
                        : r.duration === null
                          ? "default duration"
                          : r.duration / 60 + " minutes"}
                    </p>
                  ))}
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    action(async () => {
                      await api(`/admin/exams/${exam}/roster/import-confirm`, {
                        id: preview.id,
                      });
                      setPreview(null);
                      setRoster(await api(`/admin/exams/${exam}/roster`));
                      setNotice("Import completed.");
                    })
                  }
                >
                  Confirm import
                </button>
              </>
            )}
          </details>
        </section>
      </div>
      <section className="card">
        <details>
          <summary>Activity & alert delivery</summary>
          {data.incidents.slice(0, 20).map((i: any) => (
            <p key={i.id}>
              {chicago(i.opened)} · {i.attempt} ·{" "}
              {JSON.parse(i.events)
                .map((e: any) => e.reason)
                .join("; ")}{" "}
              {i.message && `· Student: ${i.message}`}
            </p>
          ))}
          {data.outbox.map((r: any) => (
            <small key={r.id}>
              {r.subject} · {r.status} · tries {r.tries}
            </small>
          ))}
        </details>
      </section>
      {resetting && (
        <Modal
          title={`Reset clock · ${resetting.username}`}
          onClose={() => {
            if (!resetBusy) setResetting(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setResetBusy(true);
              try {
                const result = await api(
                  `/admin/attempts/${resetting.id}/reset-clock`,
                  {
                    minutes: resetMinutes,
                    revision: resetting.clock_revision || 0,
                    requestID: resetting.requestID,
                  },
                );
                setNotice(
                  result.confirmed
                    ? "Clock updated."
                    : "Clock reset pending agent confirmation.",
                );
                setResetting(null);
                await refresh();
              } catch (error) {
                onError((error as Error).message);
              } finally {
                setResetBusy(false);
              }
            }}
          >
            <label>
              Minutes remaining
              <input
                type="number"
                min="1"
                max="360"
                step="1"
                required
                value={resetMinutes}
                onChange={(e) => setResetMinutes(Number(e.target.value))}
              />
            </label>
            <p>
              Counted from when you apply this reset. The student stays signed
              in. A disconnected agent confirms the change before collection.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={resetBusy}
                onClick={() => setResetting(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={resetBusy}>
                {resetBusy ? "Applying…" : "Apply reset"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title={`Remove ${removing} from this exam?`}
          onClose={() => setRemoving(null)}
        >
          <p>
            This removes enrollment only. Saved submissions, monitoring and
            attempt history are kept. An exam that has already started continues
            to its current deadline. A server administrator can end it locally.
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
                  setNotice(`${removing} removed.`);
                  setRemoving(null);
                  await reloadRoster();
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
            setSelected(null);
            setMedia(null);
            setPane("");
          }}
        >
          <button
            onClick={() => {
              setSelected(null);
              setMedia(null);
              setPane("");
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
                    · Transfer: {selected.export_status || "pending"}
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
                      · transfer: {selected.export_status || "Not available"} ·
                      source: {selected.work_path || "/work"}
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
              {selected.state === "COMPLETED" &&
                selected.export_status !== "deleted" && (
                  <details>
                    <summary>Delete web copy</summary>
                    <button
                      className="danger"
                      onClick={() =>
                        action(async () => {
                          if (
                            !window.confirm(
                              "Delete the web download copy? The protected class-server original and monitoring are kept.",
                            )
                          )
                            return;
                          await api(
                            `/admin/attempts/${selected.id}/delete-submission`,
                            { confirm: true },
                          );
                          setSelected(null);
                          setMedia(null);
                        })
                      }
                    >
                      Delete web copy
                    </button>
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
