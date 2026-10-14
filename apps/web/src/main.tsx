import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf, socket, chicago } from "./api.js";
import { Workspace } from "./workspace.js";
import { Admin } from "./admin.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import {
  authMessageBlocks,
  updateAuthChallenge,
  type AuthChallenge,
} from "./auth-challenge.js";
import "./style.css";
import { browserSSH } from "./browser-ssh.js";
function App() {
  const [user, setUser] = useState<any>(null),
    [error, setError] = useState(""),
    [challenge, setChallenge] = useState<AuthChallenge | null>(null),
    [responding, setResponding] = useState(false),
    [authSocket, setAuthSocket] = useState<WebSocket | null>(null),
    [examId, setExamId] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [info, setInfo] = useState<any>(null),
    [reservation, setReservation] = useState<any>(null),
    [answers, setAnswers] = useState<string[]>([]),
    [loginTest, setLoginTest] = useState<any>(null);
  const answersRef = useRef<string[]>([]);
  const authFormRef = useRef<HTMLFormElement>(null);
  const replaceAnswers = (next: string[]) => {
    answersRef.current.fill("");
    answersRef.current = next;
    setAnswers(next);
  };
  const clearAuthAnswers = () => {
    replaceAnswers([]);
    authFormRef.current?.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });
  };
  const admin = location.pathname.startsWith("/admin");
  const load = async () => {
    const session = await api("/session");
    setCsrf(session.csrf);
    setUser(session);
    if (session.role === "student") {
      setExamId(session.exam);
      setUsername(session.username);
      setInfo(await api("/student/exam"));
    }
  };
  useEffect(() => {
    void load().catch(() => {});
    void api("/login-test")
      .then(setLoginTest)
      .catch(() => {});
  }, []);
  const action = async (fn: () => Promise<any>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const logout = async () => {
    await api("/logout", {});
    browserSSH.close();
    authSocket?.close();
    setCsrf("");
    setReservation(null);
    setUser(null);
    setInfo(null);
    setChallenge(null);
    setAuthSocket(null);
    clearAuthAnswers();
    setPassword("");
  };
  const login = async () => {
    setChallenge(null);
    clearAuthAnswers();
    setResponding(false);
    await api("/auth/start", {});
    const s = socket("/auth/dialogue");
    browserSSH.begin(s, (m) => {
      setChallenge((current) => updateAuthChallenge(current, m));
      if (m.type === "challenge") {
        setResponding(false);
        replaceAnswers(m.prompts.map(() => ""));
      }
    });
    setAuthSocket(s);
    s.onopen = () =>
      s.send(JSON.stringify({ v: 1, type: "start", exam: examId, username }));
    s.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (browserSSH.handle(m)) return;
      if (m.type === "challenge" || m.type === "notice") {
        setChallenge((current) => updateAuthChallenge(current, m));
      }
      if (m.type === "challenge") {
        setResponding(false);
        replaceAnswers(m.prompts.map(() => ""));
      }
      if (m.type === "authenticated") {
        setChallenge(null);
        clearAuthAnswers();
        if (!browserSSH.active) s.close();
        setAuthSocket(null);
        void action(async () => {
          await api("/auth/complete", {});
          await load();
        });
      }
      if (m.type === "error") {
        browserSSH.close();
        clearAuthAnswers();
        setError(m.error);
        setChallenge(null);
        setAuthSocket(null);
        s.close();
      }
    };
    s.onclose = () => {
      setAuthSocket(null);
      setChallenge(null);
      clearAuthAnswers();
    };
  };
  useEffect(() => {
    if (!challenge) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      authSocket?.send(JSON.stringify({ v: 1, type: "cancel" }));
      authSocket?.close();
      setChallenge(null);
      setAuthSocket(null);
      clearAuthAnswers();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [challenge, authSocket]);
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {user?.role === "admin" ? (
        <>
          {loginTest?.functionalTest && (
            <p className="notice">
              Administrator test · ordinary server access retained.
            </p>
          )}
          {loginTest?.maintenance && (
            <p className="notice" role="status">
              Exam starts are paused for maintenance.
            </p>
          )}
          <Admin onError={setError} />
        </>
      ) : reservation ? (
        <Workspace
          reservation={{
            ...reservation,
            functionalTest: !!loginTest?.functionalTest,
          }}
          onError={setError}
          onSignOut={logout}
          onReauthenticate={(exam, name) => {
            setReservation(null);
            setUser(null);
            setInfo(null);
            setExamId(exam);
            setUsername(name);
            setCsrf("");
          }}
        />
      ) : (
        <div className="landing">
          <nav>
            <strong>SSH exams</strong>
            {user?.role === "student" &&
              !["ACTIVE", "LOCKED"].includes(info?.attempt?.state) && (
                <button onClick={() => action(logout)}>Sign out</button>
              )}
            <a href={admin ? "/" : "/admin"}>
              {admin ? "Student sign-in" : "Instructor sign-in"}
            </a>
          </nav>
          <main>
            {loginTest?.maintenance && (
              <p className="notice" role="status">
                Exam starts are paused for maintenance. Instructor sign-in
                remains available.
              </p>
            )}
            {loginTest?.functionalTest && (
              <p className="notice">
                Administrator test · ordinary server access retained.
              </p>
            )}
            <section className="card sign-in">
              {user && info ? (
                info.loginOnly ? (
                  <>
                    <h2>Both SSH hosts authenticated</h2>
                    <p>
                      Signed in as {user.username} through {info.jump} to{" "}
                      {info.class}.
                    </p>
                    <p>
                      The SSH connections have been closed. No exam was started.
                    </p>
                    <button onClick={() => action(logout)}>
                      Sign out and test again
                    </button>
                  </>
                ) : (
                  <>
                    <small>Signed in as {user.username}</small>
                    <h2>{info.exam.name}</h2>
                    {!isSandbox(info.exam.id) && (
                      <details className="exam-details">
                        <summary>Start window</summary>
                        <p>
                          Start window: {chicago(info.exam.earliest)} –{" "}
                          {chicago(info.exam.latest)}
                        </p>
                      </details>
                    )}
                    <p>
                      {(info.enrollment.duration ?? info.exam.duration) / 60}{" "}
                      minutes · Webcam:{" "}
                      {(
                        info.enrollment.webcam === null
                          ? info.exam.webcam
                          : info.enrollment.webcam
                      )
                        ? "Required"
                        : "Not required"}
                    </p>

                    {info.attempt &&
                    ["COMPLETED", "COLLECTION_FAILED", "FINALIZING"].includes(
                      info.attempt.state,
                    ) ? (
                      <p>
                        {info.attempt.state === "COMPLETED"
                          ? "Your exam has ended and your saved work was collected."
                          : info.attempt.state === "FINALIZING"
                            ? "Your exam has ended. Automatic collection is in progress; no submission action is required."
                            : "Your exam has ended. Automatic collection needs instructor recovery; no submission action is required."}
                      </p>
                    ) : info.attempt &&
                      !["PREPARING", "CANCELLED_BEFORE_START"].includes(
                        info.attempt.state,
                      ) ? (
                      <>
                        <p className="warn">
                          {isSandbox(info.exam.id)
                            ? "Resume this sandbox attempt; its original clock continues."
                            : `Attempt ${info.attempt.state}. A reload requires instructor approval. The clock continues.`}
                        </p>
                        {!isSandbox(info.exam.id) && (
                          <>
                            <button
                              onClick={() =>
                                action(() =>
                                  api(
                                    `/student/attempts/${info.attempt.id}/review-request`,
                                    {
                                      message:
                                        "Page reloaded; requesting review",
                                    },
                                  ),
                                )
                              }
                            >
                              Request instructor review
                            </button>
                          </>
                        )}
                        {!info.sshConnected ? (
                          <>
                            <button
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    `/student/attempts/${info.attempt.id}/reauth`,
                                    {},
                                  );
                                  setUser(null);
                                  setInfo(null);
                                })
                              }
                            >
                              Reconnect SSH
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                action(async () => {
                                  const r = await api(
                                    `/student/attempts/${info.attempt.id}/claim`,
                                    {},
                                  );
                                  setReservation(r);
                                })
                              }
                            >
                              {isSandbox(info.exam.id)
                                ? "Restore page"
                                : "Restore page after instructor authorization"}
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {info.attempt?.state === "CANCELLED_BEFORE_START" && (
                          <p>
                            Preflight ended before your exam started. You can
                            retry without consuming exam time.
                          </p>
                        )}
                        {!info.sshConnected ? (
                          <>
                            <p>
                              Your SSH connection has ended. Sign out and sign
                              in again to reopen preflight.
                            </p>
                            <button onClick={() => action(logout)}>
                              Sign out and sign in again
                            </button>
                          </>
                        ) : (
                          <button
                            className="primary"
                            onClick={() =>
                              action(async () =>
                                setReservation(
                                  await api("/student/preflight", {}),
                                ),
                              )
                            }
                          >
                            Open preflight & practice
                          </button>
                        )}
                      </>
                    )}
                  </>
                )
              ) : admin ? (
                <form
                  key="instructor-login"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const session = await api("/admin/login", {
                        username,
                        password,
                      });
                      setPassword("");
                      setCsrf(session.csrf);
                      await load();
                    });
                  }}
                >
                  <h2>Instructor sign-in</h2>
                  <label>
                    Username
                    <input
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button className="primary">Sign in</button>
                </form>
              ) : challenge ? (
                <form
                  key="ssh-challenge"
                  ref={authFormRef}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!challenge.prompts.length || responding) return;
                    setResponding(true);
                    try {
                      if (browserSSH.usingBrowser)
                        browserSSH.answers(challenge.round, [
                          ...answersRef.current,
                        ]);
                      else
                        authSocket?.send(
                          JSON.stringify({
                            v: 1,
                            type: "answers",
                            round: challenge.round,
                            answers: answersRef.current,
                          }),
                        );
                    } finally {
                      clearAuthAnswers();
                    }
                  }}
                >
                  <small>{challenge.host}</small>
                  <h2>SSH authentication</h2>
                  {!!challenge.instructions?.length && (
                    <div
                      className="challenge"
                      aria-label="Host authentication messages"
                    >
                      {challenge.instructions
                        .flatMap(authMessageBlocks)
                        .map((block, i) =>
                          block.kind === "separator" ? (
                            <hr key={i} />
                          ) : block.kind === "formatted" ? (
                            <pre key={i}>{block.text}</pre>
                          ) : (
                            <p key={i}>{block.text}</p>
                          ),
                        )}
                    </div>
                  )}
                  {challenge.prompts.map((p: any, i: number) => (
                    <label key={`${challenge.round}-${i}`}>
                      {p.prompt}
                      <input
                        type={p.echo ? "text" : "password"}
                        autoComplete="off"
                        disabled={responding}
                        autoFocus
                        value={answers[i] || ""}
                        onChange={(e) =>
                          replaceAnswers(
                            answersRef.current.map((v, j) =>
                              i === j ? e.target.value : v,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  {challenge.prompts.length ? (
                    <button className="primary" disabled={responding}>
                      {responding
                        ? "Waiting for host…"
                        : "Respond to this host"}
                    </button>
                  ) : (
                    <p>
                      Waiting for this host. Complete phone approval if
                      requested above…
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      authSocket?.send(
                        JSON.stringify({ v: 1, type: "cancel" }),
                      );
                      authSocket?.close();
                      clearAuthAnswers();
                      setChallenge(null);
                      setAuthSocket(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <form
                  key="student-login"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(login);
                  }}
                >
                  <h2>
                    {loginTest?.loginOnly
                      ? "Test your SSH login"
                      : "Connect to your exam"}
                  </h2>
                  {loginTest?.loginOnly && (
                    <p>
                      {loginTest.jump} → {loginTest.class}. Enter your actual
                      account username and respond to each host's prompts.
                    </p>
                  )}
                  {!loginTest?.loginOnly && (
                    <label>
                      Exam ID
                      <input
                        required
                        value={examId}
                        onChange={(e) => setExamId(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    {loginTest?.loginOnly
                      ? "SSH username"
                      : "Enrolled username"}
                    <input
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <p className="login-note">
                    Enter your SSH password once. It is held temporarily in
                    {loginTest?.browserSSH ? " browser" : " server"} memory,
                    reused for both servers, then discarded. Phone MFA is
                    unchanged.
                  </p>
                  <button className="primary" disabled={!!authSocket}>
                    Start SSH sign-in
                  </button>
                </form>
              )}
              {!admin && !user && (
                <p className="login-note">
                  {loginTest?.loginOnly
                    ? "Login test only; no exam or recording starts."
                    : "Chrome/Chromium required, with fullscreen and entire-display sharing. During the exam: screen images every five seconds, webcam when required, and terminal output. No audio or raw keystrokes. Monitoring is deleted after 60 days; submissions are retained separately."}
                </p>
              )}
            </section>
          </main>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
