import { hasProtectedFiles } from "../../../packages/protocol/admin.js";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf, socket, chicago } from "./api.js";
import { timeLimit } from "./local-date-time.js";
import { Workspace } from "./workspace.js";
import { Admin } from "./admin.js";
import {
  isSandbox,
  hasSandboxWindow,
} from "../../../packages/protocol/sandbox.js";
import {
  authMessageBlocks,
  isPhoneApprovalChallenge,
  updateAuthChallenge,
  type AuthChallenge,
} from "./auth-challenge.js";
import "./style.css";
import { browserSSH } from "./browser-ssh.js";
import { checkExamBrowser, examBrowserIssue } from "./browser-support.js";
function App() {
  const [{ user, info }, setSession] = useState<any>({
      user: null,
      info: null,
    }),
    [initialization, setInitialization] = useState<
      "loading" | "ready" | "failed"
    >("loading"),
    [authPhase, setAuthPhase] = useState<
      "idle" | "connecting" | "completing" | "failed"
    >("idle"),
    [signInNotice, setSignInNotice] = useState(""),
    [error, setError] = useState(""),
    [challenge, setChallenge] = useState<AuthChallenge | null>(null),
    [failedAuthMessages, setFailedAuthMessages] = useState<Pick<
      AuthChallenge,
      "host" | "instructions"
    > | null>(null),
    [responding, setResponding] = useState(false),
    [authSocket, setAuthSocket] = useState<WebSocket | null>(null),
    [examId, setExamId] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [reservation, setReservation] = useState<any>(null),
    [navigation, setNavigation] = useState<
      "preflight" | "restore" | "signout" | null
    >(null),
    [answers, setAnswers] = useState<string[]>([]),
    [loginTest, setLoginTest] = useState<any>(null),
    [browserCheck, setBrowserCheck] = useState(() => ({
      checking: true,
      issue: examBrowserIssue(),
    }));
  const answersRef = useRef<string[]>([]);
  const authHistory = useRef<AuthChallenge | null>(null);
  const showChallenge = (
    message: Parameters<typeof updateAuthChallenge>[1],
  ) => {
    const next = updateAuthChallenge(authHistory.current, message);
    authHistory.current = next;
    setChallenge(next);
  };
  const retainAuthMessages = () => {
    const last = authHistory.current;
    setFailedAuthMessages(
      last?.instructions?.length
        ? { host: last.host, instructions: [...last.instructions] }
        : null,
    );
    authHistory.current = null;
  };
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
  const completionAccepted = useRef(false);
  const authAttempt = useRef(0);
  const readSession = async (recoverPage = false) => {
    const user = await api("/session");
    let info = user.role === "student" ? await api("/student/exam") : null;
    if (recoverPage && ["ACTIVE", "LOCKED"].includes(info?.attempt?.state)) {
      setCsrf(user.csrf);
      await api(`/student/attempts/${info.attempt.id}/recover-page`, {});
      info = await api("/student/exam");
    }
    return { user, info };
  };
  const applySession = (next: Awaited<ReturnType<typeof readSession>>) => {
    setCsrf(next.user?.csrf || "");
    if (next.user?.role === "student") {
      setSignInNotice("");
      setExamId(next.user.exam);
      setUsername(next.user.username);
    }
    // Commit identity and its destination data together, never a partial page.
    setSession(next);
  };
  const load = async () => applySession(await readSession());
  const initialize = async () => {
    setInitialization("loading");
    setError("");
    try {
      const [next, settings] = await Promise.all([
        readSession(true).catch((e) => {
          if (e.status === 401) return { user: null, info: null };
          throw e;
        }),
        api("/login-test"),
      ]);
      applySession(next);
      setLoginTest(settings);
      setInitialization("ready");
    } catch (e) {
      setError((e as Error).message);
      setInitialization("failed");
    }
  };
  useEffect(() => {
    void initialize();
  }, []);
  const action = async (fn: () => Promise<any>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (admin) return;
    let mounted = true;
    const refresh = () => {
      void checkExamBrowser().then((issue) => {
        if (mounted) setBrowserCheck({ checking: false, issue });
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const requireExamBrowser = async () => {
    const issue = await checkExamBrowser();
    setBrowserCheck({ checking: false, issue });
    if (issue) throw Error(issue);
  };
  const browserBlocked = browserCheck.checking || !!browserCheck.issue;
  const navigationBusy = useRef(false);
  const navigate = async (
    kind: "preflight" | "restore" | "signout",
    fn: () => Promise<void>,
  ) => {
    if (navigationBusy.current) return;
    navigationBusy.current = true;
    setNavigation(kind);
    try {
      await fn();
    } finally {
      navigationBusy.current = false;
      setNavigation(null);
    }
  };
  const logout = async () =>
    navigate("signout", async () => {
      // The retained control socket must finish SSH cleanup before invalidation.
      await api(user?.role === "admin" ? "/admin/logout" : "/logout", {});
      if (user?.role === "admin") history.replaceState(null, "", "/admin");
      ++authAttempt.current;
      browserSSH.close();
      authSocket?.close();
      setCsrf("");
      setReservation(null);
      setSession({ user: null, info: null });
      setChallenge(null);
      authHistory.current = null;
      setFailedAuthMessages(null);
      setAuthSocket(null);
      clearAuthAnswers();
      setPassword("");
      setAuthPhase("idle");
    });
  const finishLogin = async () => {
    setAuthPhase("completing");
    setError("");
    try {
      if (!completionAccepted.current) {
        await api("/auth/complete", {});
        completionAccepted.current = true;
      }
      await load();
      setChallenge(null);
      authHistory.current = null;
      setFailedAuthMessages(null);
      setAuthPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setAuthPhase("failed");
    }
  };
  const login = async () => {
    await requireExamBrowser();
    const attempt = ++authAttempt.current;
    completionAccepted.current = false;
    setAuthPhase("connecting");
    setChallenge(null);
    authHistory.current = null;
    setFailedAuthMessages(null);
    clearAuthAnswers();
    setResponding(false);
    try {
      await api("/auth/start", {});
    } catch (e) {
      setAuthPhase("idle");
      throw e;
    }
    if (attempt !== authAttempt.current) return;
    let handedOff = false;
    let receivedError = false;
    const s = socket("/auth/dialogue");
    browserSSH.begin(s, (m) => {
      if (attempt !== authAttempt.current || handedOff) return;
      showChallenge(m);
      if (m.type === "challenge") {
        setResponding(false);
        replaceAnswers(m.prompts.map(() => ""));
      }
    });
    setAuthSocket(s);
    s.onopen = () =>
      s.send(JSON.stringify({ v: 1, type: "start", exam: examId, username }));
    s.onmessage = (e) => {
      if (attempt !== authAttempt.current) return;
      const m = JSON.parse(e.data);
      if (browserSSH.handle(m)) return;
      if (handedOff) return;
      if (m.type === "challenge" || m.type === "notice") {
        showChallenge(m);
      }
      if (m.type === "challenge") {
        setResponding(false);
        replaceAnswers(m.prompts.map(() => ""));
      }
      if (m.type === "authenticated") {
        handedOff = true;
        clearAuthAnswers();
        if (!browserSSH.active) s.close();
        setAuthSocket(null);
        void finishLogin();
      }
      if (m.type === "error") {
        receivedError = true;
        retainAuthMessages();
        browserSSH.close();
        clearAuthAnswers();
        setError(m.error);
        setAuthPhase("idle");
        setChallenge(null);
        setAuthSocket(null);
        s.close();
      }
    };
    s.onclose = () => {
      if (attempt !== authAttempt.current || handedOff) return;
      if (!receivedError) {
        retainAuthMessages();
        setError(
          "Sign-in did not finish. Sign in again. No new attempt was started.",
        );
      }
      setAuthPhase("idle");
      setAuthSocket(null);
      setChallenge(null);
      clearAuthAnswers();
    };
  };
  useEffect(() => {
    if (authPhase !== "connecting") return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      ++authAttempt.current;
      setAuthPhase("idle");
      authSocket?.send(JSON.stringify({ v: 1, type: "cancel" }));
      authSocket?.close();
      setChallenge(null);
      authHistory.current = null;
      setFailedAuthMessages(null);
      setAuthSocket(null);
      clearAuthAnswers();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [challenge, authSocket, authPhase]);
  const grantSelectionRequired =
    !!info && !info.attempt && info.grants?.length > 1 && !info.selected_grant;
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setFailedAuthMessages(null);
            }}
          >
            Dismiss
          </button>
          {failedAuthMessages && (
            <details>
              <summary>SSH sign-in details</summary>
              <small>{failedAuthMessages.host}</small>
              <div className="challenge" aria-label="SSH sign-in details">
                {failedAuthMessages
                  .instructions!.flatMap(authMessageBlocks)
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
            </details>
          )}
        </div>
      )}
      {initialization !== "ready" ? (
        <main
          className="session-loading"
          aria-busy={initialization === "loading"}
        >
          {initialization === "loading" ? (
            <p role="status">Loading…</p>
          ) : (
            <button onClick={() => void initialize()}>Retry loading</button>
          )}
        </main>
      ) : user?.role === "admin" ? (
        <>
          {loginTest?.functionalTest && (
            <p className="notice">
              Administrator test · server access retained.
            </p>
          )}
          {loginTest?.maintenance && (
            <p className="notice" role="status">
              Exam starts are paused for maintenance.
            </p>
          )}
          <Admin actor={user.username} onError={setError} onSignOut={logout} />
        </>
      ) : reservation ? (
        <Workspace
          reservation={{
            ...reservation,
            functionalTest: !!loginTest?.functionalTest,
          }}
          onSignOut={logout}
          onReauthenticate={(exam, name, notice) => {
            setSignInNotice(notice || "");
            setReservation(null);
            setSession({ user: null, info: null });
            setExamId(exam);
            setUsername(name);
            setCsrf("");
          }}
        />
      ) : (
        <div className="landing" aria-busy={!!navigation}>
          <nav>
            <strong>SSH exams</strong>
            {user?.role === "student" &&
              !["ACTIVE", "LOCKED"].includes(info?.attempt?.state) && (
                <button disabled={!!navigation} onClick={() => action(logout)}>
                  {navigation === "signout" ? "Signing out…" : "Sign out"}
                </button>
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
                Administrator test · server access retained.
              </p>
            )}
            {signInNotice && (
              <p role="status" className="notice">
                {signInNotice}
              </p>
            )}
            <section className="card sign-in">
              {!admin && browserCheck.issue && (
                <p className="warn" role="alert">
                  {browserCheck.issue}
                </p>
              )}
              {user && info ? (
                info.loginOnly ? (
                  <>
                    <h2>SSH sign-in succeeded</h2>
                    <p>
                      Signed in as {user.username} through {info.jump} to{" "}
                      {info.class}.
                    </p>
                    <p>Connections closed. No new attempt was started.</p>
                    <button onClick={() => action(logout)}>
                      Sign out and test again
                    </button>
                  </>
                ) : (
                  <>
                    <small>Signed in as {user.username}</small>
                    <h2>{info.settings?.name ?? info.exam.name}</h2>
                    {info.previous_attempt && (
                      <p>
                        Your earlier files are saved. This starts a separate
                        attempt.
                      </p>
                    )}
                    {!info.attempt && info.grants?.length > 1 && (
                      <label>
                        Choose an attempt
                        <select
                          value={info.selected_grant ?? ""}
                          onChange={(e) => {
                            const selected = info.grants.find(
                              (g: any) => g.id === e.target.value,
                            );
                            setSession({
                              user,
                              info: {
                                ...info,
                                selected_grant: selected?.id ?? null,
                                settings: selected?.settings ?? info.settings,
                              },
                            });
                          }}
                        >
                          <option value="">Choose an unused attempt</option>
                          {info.grants.map((g: any) => (
                            <option key={g.id} value={g.id}>
                              {g.issuance === "ADDITIONAL_TEMPLATE"
                                ? "Extra attempt"
                                : g.issuance === "PRACTICE"
                                  ? "Practice attempt"
                                  : "First attempt"}{" "}
                              · {timeLimit(g.settings.duration)} ·{" "}
                              {chicago(g.settings.earliest)} –{" "}
                              {chicago(g.settings.latest)} · Created{" "}
                              {chicago(g.issued_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {grantSelectionRequired ? (
                      <p>
                        Choose an attempt to see its time limit and start
                        window.
                      </p>
                    ) : (
                      <>
                        {info.practice_blocked && (
                          <p role="status">{info.practice_blocked.message}</p>
                        )}
                        {info.selected_grant && (
                          <details className="exam-details">
                            <summary>Starting files</summary>
                            <p>
                              {(() => {
                                const work = info.grants.find(
                                  (g: any) => g.id === info.selected_grant,
                                )?.work;
                                return work?.kind === "empty"
                                  ? "Empty folder"
                                  : work?.kind === "saved"
                                    ? "Saved work"
                                    : work
                                      ? `Starter files: ${work.name}`
                                      : "Starting files unavailable";
                              })()}
                            </p>
                          </details>
                        )}
                        {isSandbox(info.exam.id) &&
                        !hasSandboxWindow(info.exam) ? (
                          <p>
                            Practice is closed. Ask your instructor to open a
                            start window.
                          </p>
                        ) : (
                          <details className="exam-details">
                            <summary>Start window</summary>
                            <p>
                              Start window:{" "}
                              {chicago(
                                info.settings?.earliest ?? info.exam.earliest,
                              )}{" "}
                              –{" "}
                              {chicago(
                                info.settings?.latest ?? info.exam.latest,
                              )}
                            </p>
                          </details>
                        )}
                        <p>
                          {timeLimit(
                            info.settings?.duration ??
                              info.enrollment.duration ??
                              info.exam.duration,
                          )}{" "}
                          · Webcam:{" "}
                          {(info.settings?.webcam ??
                          (info.enrollment.webcam === null
                            ? info.exam.webcam
                            : info.enrollment.webcam))
                            ? "Required"
                            : "Optional"}
                        </p>
                      </>
                    )}
                    {info.attempt &&
                    ["COMPLETED", "COLLECTION_FAILED", "FINALIZING"].includes(
                      info.attempt.state,
                    ) ? (
                      <p>
                        {info.attempt.state === "COMPLETED" &&
                        hasProtectedFiles(info.attempt)
                          ? "Your exam has ended. Your files are saved."
                          : info.attempt.state === "FINALIZING"
                            ? "Your exam has ended. Files are being saved; you do not need to submit anything."
                            : "Your exam has ended. File protection is not confirmed. Ask your instructor to check."}
                      </p>
                    ) : info.attempt &&
                      !["PREPARING", "CANCELLED_BEFORE_START"].includes(
                        info.attempt.state,
                      ) ? (
                      <>
                        <p className="warn">
                          {info.attempt.monitoring_mode === "v1"
                            ? "This session cannot resume. Ask your instructor for another attempt from saved files. The original clock and server restrictions still apply."
                            : isSandbox(info.exam.id)
                              ? "Resume this practice attempt. The clock keeps running."
                              : "Resuming after a reload needs instructor approval. The clock keeps running."}
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
                                        info.attempt.monitoring_mode === "v1"
                                          ? "Page reloaded; requesting a reviewed new attempt from verified saved work"
                                          : "Page reloaded; requesting review",
                                    },
                                  ),
                                )
                              }
                            >
                              {info.attempt.monitoring_mode === "v1"
                                ? "Request another attempt"
                                : "Ask your instructor to review"}
                            </button>
                          </>
                        )}
                        {info.attempt.monitoring_mode !== "v1" &&
                          (!info.sshConnected ? (
                            <>
                              <button
                                disabled={browserBlocked || !!navigation}
                                onClick={() =>
                                  action(async () => {
                                    await requireExamBrowser();
                                    await api(
                                      `/student/attempts/${info.attempt.id}/reauth`,
                                      {},
                                    );
                                    setSession({ user: null, info: null });
                                  })
                                }
                              >
                                Reconnect SSH
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                disabled={browserBlocked || !!navigation}
                                onClick={() =>
                                  action(async () => {
                                    await navigate("restore", async () => {
                                      await requireExamBrowser();
                                      const r = await api(
                                        `/student/attempts/${info.attempt.id}/claim`,
                                        {},
                                      );
                                      setReservation(r);
                                    });
                                  })
                                }
                              >
                                {navigation === "restore"
                                  ? "Restoring exam…"
                                  : "Resume exam"}
                              </button>
                            </>
                          ))}
                      </>
                    ) : (
                      <>
                        {info.attempt?.state === "CANCELLED_BEFORE_START" && (
                          <p>
                            Setup ended before your exam started. No exam time
                            was used.
                          </p>
                        )}
                        {!info.sshConnected ? (
                          <>
                            <p>
                              Your connection has ended. Sign out and sign in
                              again to retry setup.
                            </p>
                            <button onClick={() => action(logout)}>
                              Sign out and sign in again
                            </button>
                          </>
                        ) : (
                          <button
                            className="primary"
                            disabled={
                              !!info.practice_blocked ||
                              browserBlocked ||
                              !!navigation ||
                              grantSelectionRequired
                            }
                            onClick={() =>
                              action(async () => {
                                await navigate("preflight", async () => {
                                  await requireExamBrowser();
                                  setReservation(
                                    await api(
                                      "/student/preflight",
                                      info.selected_grant
                                        ? { grant: info.selected_grant }
                                        : {},
                                    ),
                                  );
                                });
                              })
                            }
                          >
                            {navigation === "preflight"
                              ? "Opening setup…"
                              : "Check setup and practice"}
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
              ) : browserBlocked ? null : challenge || authPhase !== "idle" ? (
                <form
                  key="ssh-challenge"
                  ref={authFormRef}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      authPhase !== "connecting" ||
                      !challenge?.prompts.length ||
                      responding
                    )
                      return;
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
                  {challenge && <small>{challenge.host}</small>}
                  <h2>Server sign-in</h2>
                  {!!challenge?.instructions?.length && (
                    <div
                      className="challenge"
                      aria-label="Host authentication messages"
                    >
                      {challenge!.instructions
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
                  {(authPhase === "connecting" &&
                  !isPhoneApprovalChallenge(challenge)
                    ? challenge?.prompts || []
                    : []
                  ).map((p: any, i: number) => (
                    <label key={`${challenge!.round}-${i}`}>
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
                  {authPhase === "failed" ? (
                    <button type="button" onClick={() => void finishLogin()}>
                      Retry opening exam
                    </button>
                  ) : authPhase === "completing" ? (
                    <p role="status">Opening your exam…</p>
                  ) : challenge?.prompts.length ? (
                    <button className="primary" disabled={responding}>
                      {responding
                        ? "Waiting for server…"
                        : isPhoneApprovalChallenge(challenge)
                          ? "Continue after phone approval"
                          : "Continue"}
                    </button>
                  ) : (
                    <p>
                      {challenge
                        ? "Waiting for the server. Complete phone approval if requested…"
                        : "Connecting to the server…"}
                    </p>
                  )}
                  {authPhase === "connecting" && (
                    <button
                      type="button"
                      onClick={() => {
                        ++authAttempt.current;
                        setAuthPhase("idle");
                        authSocket?.send(
                          JSON.stringify({ v: 1, type: "cancel" }),
                        );
                        authSocket?.close();
                        clearAuthAnswers();
                        setChallenge(null);
                        authHistory.current = null;
                        setFailedAuthMessages(null);
                        setAuthSocket(null);
                      }}
                    >
                      Cancel
                    </button>
                  )}
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
                      : "Sign in to your exam"}
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
                        disabled={browserBlocked || !!navigation}
                        value={examId}
                        onChange={(e) => setExamId(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    Username
                    <input
                      required
                      disabled={browserBlocked || !!navigation}
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </label>
                  <p className="login-note">
                    Your password is used for both SSH servers and discarded
                    after sign-in. Complete phone approval when prompted.
                  </p>
                  <button
                    className="primary"
                    disabled={!!authSocket || browserBlocked}
                  >
                    Sign in
                  </button>
                </form>
              )}
              {!admin && !user && !browserBlocked && authPhase === "idle" && (
                <p className="login-note">
                  {loginTest?.loginOnly
                    ? "Sign-in test only. No exam or recording starts."
                    : "Use desktop Chrome, Edge or Chromium. Exams require fullscreen and sharing your entire screen. We record screen images every 5 seconds, webcam images when required, and terminal output. No audio or raw keystrokes. Recordings are deleted after 60 days; submissions are kept separately."}
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
