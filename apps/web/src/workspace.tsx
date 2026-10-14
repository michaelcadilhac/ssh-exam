import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import WinBox from "winbox/src/js/winbox.js";
import { api, socket, remaining, chicago } from "./api.js";
import { Capture } from "./capture.js";
import { Modal } from "./modal.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { TerminalMenu } from "./terminal-menu.js";
import { readinessMessage } from "../../../packages/protocol/readiness.js";
import { browserSSH } from "./browser-ssh.js";
import "@xterm/xterm/css/xterm.css";
import "winbox/dist/css/winbox.min.css";
type Pane = {
  id: string;
  name: string;
  term: Terminal;
  fit: FitAddon;
  box: any;
  observer: ResizeObserver;
};
export function Workspace({
  reservation,
  onError,
  onSignOut,
  onReauthenticate,
}: {
  reservation: any;
  onError: (s: string) => void;
  onSignOut: () => Promise<void>;
  onReauthenticate: (exam: string, username: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    area = useRef<HTMLDivElement>(null),
    tools = useRef<HTMLDetailsElement>(null),
    attemptRef = useRef<any>(
      reservation.attempt || {
        id: reservation.id,
        state: "PREPARING",
        generation: 0,
        settings: JSON.stringify(reservation.settings),
      },
    ),
    ws = useRef<WebSocket | null>(null),
    panes = useRef(new Map<string, Pane>()),
    active = useRef<string>(""),
    nextTerminal = useRef(1),
    clipboard = useRef(""),
    capture = useRef<Capture | null>(null),
    armed = useRef(false),
    keyboard = useRef(false),
    localLocked = useRef(false),
    lastAck = useRef(Date.now()),
    reconnectTimer = useRef<any>(null);
  const serverClock = useRef({ now: Date.now(), at: performance.now() });
  const warnings = useRef(new Set<number>());
  const [attempt, setAttempt] = useState(attemptRef.current),
    [connected, setConnected] = useState(false),
    [locked, setLocked] = useState(false),
    [screen, setScreen] = useState(false),
    [camera, setCamera] = useState(false),
    [keys, setKeys] = useState(false),
    [isFullscreen, setFullscreen] = useState(false),
    [, redrawPanes] = useState(0),
    [count, setCount] = useState(0),
    [clock, setClock] = useState(Date.now()),
    [message, setMessage] = useState(""),
    [dialog, setDialog] = useState<any>(null),
    [review, setReview] = useState(""),
    [terminalMenu, setTerminalMenu] = useState<{
      pane: string;
      x: number;
      y: number;
      selection: string;
    } | null>(null),
    [serverOffset, setServerOffset] = useState(0),
    [restoring, setRestoring] = useState<string | null>(null),
    [recoveryFeedback, setRecoveryFeedback] = useState<{
      error: boolean;
      text: string;
    } | null>(null),
    [authenticationGap, setAuthenticationGap] = useState(false),
    [recoveryExpired, setRecoveryExpired] = useState(false);
  const settings = reservation.settings;
  const sandbox = isSandbox(settings.id);
  const id = reservation.id;
  const page = reservation.page;
  const directory = attempt.work_path || reservation.work_path || "/work";
  const ended = [
    "COMPLETED",
    "COLLECTION_FAILED",
    "CANCELLED_BEFORE_START",
  ].includes(attempt.state);
  const preflightRecovery =
    attempt.state === "PREPARING" && (authenticationGap || recoveryExpired);
  const covered =
    !!dialog ||
    locked ||
    preflightRecovery ||
    ended ||
    attempt.state === "FINALIZING" ||
    (!connected && attempt.state === "ACTIVE");
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const closeTerminalMenu = () => {
    const pane = terminalMenu && panes.current.get(terminalMenu.pane);
    setTerminalMenu(null);
    if (pane && !coveredRef.current) pane.term.focus();
  };
  useEffect(() => {
    for (const pane of panes.current.values()) pane.box.dom.inert = covered;
  }, [covered, count]);
  const send = (data: any) => {
    if (browserSSH.terminal(data)) return;
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify({ v: 1, ...data }));
  };
  const conditions = () => ({
    fullscreen: document.fullscreenElement === root.current,
    focus: document.hasFocus(),
    visible: document.visibilityState === "visible",
    keyboard: keyboard.current,
    screen: !!capture.current?.healthy("screen"),
    webcam: !!capture.current?.healthy("webcam"),
  });
  const incident = (reason: string) => {
    if (!armed.current) return;
    localLocked.current = true;
    armed.current = false;
    setLocked(true);
    setMessage(reason);
    send({ type: "incident", reason });
    void capture.current?.sample("screen");
  };
  const interaction = () =>
    !localLocked.current &&
    ws.current?.readyState === WebSocket.OPEN &&
    ["ACTIVE", "PREPARING"].includes(attemptRef.current.state);
  const addPane = (paneId: string) => {
    if (panes.current.has(paneId)) return;
    const el = document.createElement("div");
    el.className = "terminal";
    const term = new Terminal({
      scrollback: 3000,
      fontSize: 15,
      allowProposedApi: false,
      theme: { background: "#0d1420", foreground: "#dbe5f2" },
      disableStdin: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    term.onSelectionChange(() => {
      if (coveredRef.current || !interaction()) return;
      const selection = term.getSelection();
      if (selection) clipboard.current = selection;
    });
    const showMenu = (x: number, y: number) => {
      if (coveredRef.current || !interaction()) return;
      active.current = paneId;
      setTerminalMenu({ pane: paneId, x, y, selection: term.getSelection() });
    };
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY);
    });
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "v"
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (
          e.type === "keydown" &&
          !e.repeat &&
          !coveredRef.current &&
          interaction() &&
          clipboard.current
        )
          term.paste(clipboard.current);
        return false;
      }
      if (
        e.type === "keydown" &&
        (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
      ) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        showMenu(rect.left + 24, rect.top + 24);
        return false;
      }
      return !(
        ["ACTIVE", "LOCKED"].includes(attemptRef.current.state) &&
        (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") ||
          (e.shiftKey && e.key === "Insert"))
      );
    });
    const name = `Terminal ${nextTerminal.current++}`;
    let box: any;
    const resize = () => {
      if (
        !box ||
        !panes.current.has(paneId) ||
        !el.clientWidth ||
        !el.clientHeight ||
        box.min
      )
        return;
      try {
        fit.fit();
        if (term.cols > 1 && term.rows > 1)
          send({
            type: "resize",
            pane: paneId,
            cols: term.cols,
            rows: term.rows,
          });
      } catch {}
    };
    const updateControls = () => {
      if (!box) return;
      for (const control of box.dom.querySelectorAll("[data-action]")) {
        const label = `${control.dataset.action} ${pane.name}`;
        control.setAttribute("aria-label", label);
        control.title = label;
      }
      for (const [selector, label] of [
        [".wb-max", `${box.max ? "Restore" : "Maximize"} ${pane.name}`],
        [".wb-min", `Minimize ${pane.name}`],
        [".wb-close", `Close ${pane.name}`],
      ]) {
        const control = box.dom.querySelector(selector) as HTMLElement;
        control.setAttribute("aria-label", label);
        control.title = label;
      }
    };
    box = new WinBox(name, {
      root: root.current,
      top: area.current!.getBoundingClientRect().top,
      bottom: window.innerHeight - area.current!.getBoundingClientRect().bottom,
      mount: el,
      x: 30 + panes.current.size * 32,
      y:
        area.current!.getBoundingClientRect().top +
        25 +
        panes.current.size * 28,
      width: "70%",
      height: "75%",
      minwidth: 320,
      minheight: 180,
      class: ["no-full", "no-animation"],
      onfocus: () => {
        active.current = paneId;
        requestAnimationFrame(() => {
          if (
            panes.current.has(paneId) &&
            !dialogRef.current &&
            !coveredRef.current
          )
            term.focus();
        });
      },
      onclose: () => {
        setDialog({ kind: "close", pane: paneId });
        return true;
      },
      onrestore: () =>
        requestAnimationFrame(() => {
          updateControls();
          resize();
        }),
      onmaximize: () =>
        requestAnimationFrame(() => {
          updateControls();
          resize();
        }),
      onminimize: () => requestAnimationFrame(updateControls),
      onresize: () => requestAnimationFrame(resize),
    });
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const pane = { id: paneId, name, term, fit, box, observer };
    panes.current.set(paneId, pane);
    term.open(el);
    term.onData((data) => {
      if (!coveredRef.current && interaction())
        send({
          type: "input",
          pane: paneId,
          data,
          generation: attemptRef.current.generation,
        });
    });
    for (const [classname, symbol, label, click] of [
      [
        "wb-rename",
        "✎",
        "Rename",
        () => setDialog({ kind: "rename", pane: paneId, name: pane.name }),
      ],
      ["wb-snap-right", "⇥", "Snap right", () => snap(pane, "right")],
      ["wb-snap-left", "⇤", "Snap left", () => snap(pane, "left")],
    ] as const) {
      box.addControl({
        class: classname,
        click: (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          click();
        },
      });
      const control = box.dom.querySelector(`.${classname}`) as HTMLElement;
      control.textContent = symbol;
      control.dataset.action = label;
    }
    box.dom.inert = coveredRef.current;
    updateControls();
    for (const control of box.dom.querySelectorAll(".wb-control span")) {
      control.setAttribute("role", "button");
      control.tabIndex = 0;
      control.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          control.click();
        }
      });
    }
    requestAnimationFrame(() => term.focus());
    active.current = paneId;
    resize();
    setCount(panes.current.size);
  };
  const open = () => {
    if (coveredRef.current || !interaction()) return;
    const pane = crypto.randomUUID();
    send({ type: "open", pane });
    addPane(pane);
  };
  const remove = (pane: string) => {
    const p = panes.current.get(pane);
    if (!p) return;
    p.box.onclose = undefined;
    p.box.close();
    p.observer.disconnect();
    p.term.dispose();
    panes.current.delete(pane);
    if (active.current === pane) {
      const next = [...panes.current.values()].at(-1);
      active.current = next?.id || "";
      requestAnimationFrame(() => next?.term.focus());
    }
    setCount(panes.current.size);
  };
  const snap = (pane: Pane, side: "left" | "right") => {
    pane.box
      .restore()
      .resize(area.current!.clientWidth / 2, area.current!.clientHeight)
      .move(
        side === "left" ? 0 : area.current!.clientWidth / 2,
        area.current!.getBoundingClientRect().top,
      );
    pane.box.focus();
    pane.term.focus();
    active.current = pane.id;
  };
  const arrange = () => {
    const list = [...panes.current.values()];
    const cols = list.length <= 2 ? list.length : 2;
    for (const [i, p] of list.entries()) {
      p.box.restore();
      p.box
        .resize(
          area.current!.clientWidth / cols,
          area.current!.clientHeight / Math.ceil(list.length / cols),
        )
        .move(
          ((i % cols) * area.current!.clientWidth) / cols,
          area.current!.getBoundingClientRect().top +
            (Math.floor(i / cols) * area.current!.clientHeight) /
              Math.ceil(list.length / cols),
        );
    }
  };
  const action = async (fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  useEffect(() => {
    capture.current = new Capture(id, page, incident);
    for (const pane of reservation.panes || []) addPane(pane);
    let mounted = true;
    let retryDelay = 1000;
    const updateAuthenticationGap = (gap: boolean) => {
      setAuthenticationGap(gap);
      if (gap) {
        capture.current?.stop();
        setScreen(false);
        setCamera(false);
        (navigator as any).keyboard?.unlock?.();
        keyboard.current = false;
        setKeys(false);
      }
    };
    const connect = () => {
      if (
        !mounted ||
        ["COMPLETED", "COLLECTION_FAILED", "CANCELLED_BEFORE_START"].includes(
          attemptRef.current.state,
        )
      )
        return;
      const s = socket("/student/session");
      ws.current = s;
      s.onopen = () => {
        send({ type: "bind", attempt: id, page });
      };
      s.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "state") {
          lastAck.current = Date.now();
          retryDelay = 1000;
          setConnected(true);
          setRecoveryExpired(false);
          updateAuthenticationGap(!!m.authenticationGap);
          attemptRef.current = m.attempt;
          setAttempt(m.attempt);
          setServerOffset(m.serverNow - Date.now());
          serverClock.current = { now: m.serverNow, at: performance.now() };
          if (m.attempt.state === "LOCKED") {
            armed.current = false;
            localLocked.current = true;
            setLocked(true);
            setMessage(m.attempt.reason || "Instructor review required");
          }
          if (
            [
              "FINALIZING",
              "COMPLETED",
              "COLLECTION_FAILED",
              "CANCELLED_BEFORE_START",
            ].includes(m.attempt.state)
          ) {
            armed.current = false;
            capture.current?.stop();
            (navigator as any).keyboard?.unlock?.();
            clipboard.current = "";
            for (const p of panes.current.values())
              p.term.options.disableStdin = true;
          }
          if (m.attempt.state === "ACTIVE" && !localLocked.current) {
            setLocked(false);
            armed.current = true;
          }
        }
        if (m.type === "output") {
          const p = panes.current.get(m.pane);
          if (p && interaction())
            p.term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
        }
        if (m.type === "closed") remove(m.pane);
        if (m.type === "error") {
          if (m.pane) remove(m.pane);
          setMessage(m.error);
          if (!m.error.includes("Page") && !m.error.includes("owns"))
            setDialog({ kind: "error", message: m.error });
          if (m.error.includes("Page") || m.error.includes("owns"))
            incident(m.error);
        }
      };
      s.onclose = () => {
        setConnected(false);
        if (!mounted) return;
        if (Date.now() - lastAck.current > 15000) {
          setRecoveryExpired(true);
          if (attemptRef.current.state === "ACTIVE")
            incident("Network recovery grace expired");
        }
        reconnectTimer.current = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
    };
    connect();
    const unsubscribe = browserSSH.subscribe((m) => {
      if (m.type === "output") {
        const p = panes.current.get(m.pane);
        if (p && interaction())
          p.term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
      }
      if (m.type === "closed") remove(m.pane);
      if (m.type === "loss") {
        updateAuthenticationGap(true);
        setMessage("SSH disconnected. Sign in again to reconnect.");
      }
    });
    const heartbeat = setInterval(() => {
      const r = conditions();
      setScreen(r.screen);
      setCamera(r.webcam);
      if (
        armed.current &&
        (!r.fullscreen ||
          !r.focus ||
          !r.visible ||
          !r.screen ||
          (settings.webcam && !r.webcam))
      )
        incident("Required focus/fullscreen/capture condition lost");
      if (attemptRef.current.state === "PREPARING")
        send({ type: "preflight-contact" });
      else if (r.fullscreen && r.focus && r.visible && r.keyboard && r.screen)
        send({ type: "heartbeat", ready: r });
      if (armed.current && Date.now() - lastAck.current > 15000)
        incident("Network recovery grace expired");
      if (
        attemptRef.current.state === "PREPARING" &&
        Date.now() - lastAck.current > 15000
      ) {
        setConnected(false);
        setRecoveryExpired(true);
        // An open but unresponsive socket also needs a fresh bind.
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.close();
      }
    }, 2000);
    const timer = setInterval(() => {
      setClock(
        serverClock.current.now + performance.now() - serverClock.current.at,
      );
      if (
        ["ACTIVE", "LOCKED"].includes(attemptRef.current.state) &&
        attemptRef.current.deadline &&
        serverClock.current.now + performance.now() - serverClock.current.at >=
          attemptRef.current.deadline
      ) {
        armed.current = false;
        localLocked.current = true;
        capture.current?.stop();
        clipboard.current = "";
        setLocked(false);
        const pending = { ...attemptRef.current, state: "FINALIZING" };
        attemptRef.current = pending;
        setAttempt(pending);
        setMessage(
          "Time expired. Saved work is being protected automatically.",
        );
      }
      const left =
        (attemptRef.current.deadline || Infinity) -
        (serverClock.current.now + performance.now() - serverClock.current.at);
      for (const seconds of [600, 300, 60])
        if (
          armed.current &&
          left <= seconds * 1000 &&
          !warnings.current.has(seconds)
        ) {
          warnings.current.add(seconds);
          setMessage(
            `${seconds / 60} minute warning: save your work in /work.`,
          );
        }
    }, 250);
    const statusTimer = setInterval(() => {
      void api(`/student/attempts/${id}/status`)
        .then((result) => {
          attemptRef.current = result.attempt;
          setAttempt(result.attempt);
          setServerOffset(result.serverNow - Date.now());
          serverClock.current = {
            now: result.serverNow,
            at: performance.now(),
          };
          updateAuthenticationGap(!!result.authenticationGap);
          if (result.attempt.state === "LOCKED") {
            armed.current = false;
            localLocked.current = true;
            setLocked(true);
            setMessage(result.attempt.reason);
          }
          if (
            [
              "FINALIZING",
              "COMPLETED",
              "COLLECTION_FAILED",
              "CANCELLED_BEFORE_START",
            ].includes(result.attempt.state)
          ) {
            armed.current = false;
            capture.current?.stop();
            (navigator as any).keyboard?.unlock?.();
            clipboard.current = "";
          }
        })
        .catch(() => {});
    }, 2000);
    const blur = () => incident("Browser focus lost"),
      full = () => {
        setFullscreen(document.fullscreenElement === root.current);
        if (!document.fullscreenElement) {
          keyboard.current = false;
          setKeys(false);
          incident("Workspace exited fullscreen");
        }
      },
      visibility = () => {
        if (document.hidden) incident("Document became hidden");
      };
    window.addEventListener("blur", blur);
    document.addEventListener("fullscreenchange", full);
    document.addEventListener("visibilitychange", visibility);
    const closeTools = (event: PointerEvent) => {
      if (tools.current && !tools.current.contains(event.target as Node))
        tools.current.open = false;
    };
    document.addEventListener("pointerdown", closeTools);
    const leave = () => {
      if (armed.current) incident("Page closing or reloading");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      unsubscribe();
      mounted = false;
      clearInterval(heartbeat);
      clearInterval(timer);
      clearInterval(statusTimer);
      clearTimeout(reconnectTimer.current);
      capture.current?.stop();
      (navigator as any).keyboard?.unlock?.();
      ws.current?.close();
      for (const p of panes.current.values()) {
        p.box.onclose = undefined;
        p.box.close();
        p.observer.disconnect();
        p.term.dispose();
      }
      window.removeEventListener("blur", blur);
      document.removeEventListener("fullscreenchange", full);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("pointerdown", closeTools);
    };
  }, []);
  useEffect(() => {
    if (covered) setTerminalMenu(null);
  }, [covered]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!area.current) return;
      const rect = area.current.getBoundingClientRect();
      for (const p of panes.current.values()) {
        p.box.top = rect.top;
        p.box.bottom = window.innerHeight - rect.bottom;
        if (p.box.max) p.box.resize(rect.width, rect.height).move(0, rect.top);
      }
    });
    observer.observe(area.current!);
    return () => observer.disconnect();
  }, []);
  const fullscreen = async () => {
    if (
      !/Chrome|Chromium/.test(navigator.userAgent) ||
      !navigator.mediaDevices?.getDisplayMedia ||
      !(navigator as any).keyboard?.lock
    )
      throw Error(
        "A desktop Chrome/Chromium browser with screen capture and Keyboard Lock is required.",
      );
    await root.current!.requestFullscreen();
    setFullscreen(true);
  };
  const lockKeyboard = async () => {
    if (document.fullscreenElement !== root.current)
      throw Error("Enter fullscreen before locking the keyboard.");
    await (navigator as any).keyboard.lock();
    keyboard.current = true;
    setKeys(true);
  };
  const begin = async () => {
    const r = conditions();
    const result = await api(`/student/attempts/${id}/begin`, r, page);
    serverClock.current = {
      now: result.serverNow || result.attempt.start || Date.now(),
      at: performance.now(),
    };
    setClock(serverClock.current.now);
    attemptRef.current = result.attempt;
    setAttempt(result.attempt);
    armed.current = result.attempt.state === "ACTIVE";
    if (armed.current) {
      localLocked.current = false;
      setLocked(false);
      for (const p of [...panes.current.values()]) remove(p.id);
      nextTerminal.current = 1;
      open();
    }
  };
  const recoveryAction = async (
    name: string,
    success: string,
    fn: () => Promise<any>,
  ) => {
    setRestoring(name);
    setRecoveryFeedback({ error: false, text: `${name}…` });
    try {
      await fn();
      setRecoveryFeedback({ error: false, text: success });
    } catch (e) {
      const error = e as Error;
      const text =
        error.name === "NotAllowedError"
          ? "Permission was cancelled or denied. Try the restore action again and approve the browser permission."
          : error.message;
      setRecoveryFeedback({ error: true, text });
    } finally {
      setRestoring(null);
    }
  };
  const continueExam = async () => {
    const readiness = readinessMessage(conditions(), settings.webcam);
    if (readiness) throw Error(readiness);
    const result = await api(
      `/student/attempts/${id}/continue`,
      conditions(),
      page,
    );
    serverClock.current = {
      now: result.serverNow || result.attempt.start || Date.now(),
      at: performance.now(),
    };
    setClock(serverClock.current.now);
    attemptRef.current = result.attempt;
    setAttempt(result.attempt);
    localLocked.current = false;
    setLocked(false);
    armed.current = true;
    for (const p of panes.current.values()) {
      p.fit.fit();
      send({
        type: "resize",
        pane: p.id,
        cols: p.term.cols,
        rows: p.term.rows,
      });
    }
  };
  const restricted = armed.current || attempt.state === "LOCKED";
  const functionalTest = !!reservation.functionalTest;
  const block = (e: any) => {
    if (restricted) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <div
      ref={root}
      className="workspace"
      onPasteCapture={block}
      onCopyCapture={block}
      onCutCapture={block}
      onDropCapture={block}
      onDragOverCapture={block}
      onAuxClickCapture={(e) => {
        if (e.button === 1) block(e);
      }}
      onContextMenu={block}
    >
      {terminalMenu && !covered && panes.current.has(terminalMenu.pane) && (
        <TerminalMenu
          x={terminalMenu.x}
          y={terminalMenu.y}
          canCopy={!!terminalMenu.selection && interaction()}
          canPaste={!!clipboard.current && interaction()}
          fontSize={
            panes.current.get(terminalMenu.pane)!.term.options.fontSize || 15
          }
          onClose={closeTerminalMenu}
          onAction={(action) => {
            const p = panes.current.get(terminalMenu.pane);
            if (!p || !interaction()) {
              closeTerminalMenu();
              return;
            }
            if (action === "copy") {
              clipboard.current = terminalMenu.selection;
            } else if (action === "paste") p.term.paste(clipboard.current);
            else {
              const size = p.term.options.fontSize || 15;
              p.term.options.fontSize =
                action === "reset"
                  ? 15
                  : Math.max(
                      10,
                      Math.min(28, size + (action === "in" ? 1 : -1)),
                    );
              p.fit.fit();
              send({
                type: "resize",
                pane: p.id,
                cols: p.term.cols,
                rows: p.term.rows,
              });
            }
            closeTerminalMenu();
          }}
        />
      )}
      <header className="exam-toolbar" inert={covered}>
        <div>
          <strong>{settings.name}</strong>
          <small className="toolbar-status">
            {(functionalTest || reservation.administratorSandbox) && (
              <span className="status warn">
                {reservation.administratorSandbox
                  ? "Administrator sandbox"
                  : "Administrator test"}{" "}
                · ordinary access retained
              </span>
            )}
            <span
              className={
                connected && !authenticationGap ? "status" : "status warn"
              }
            >
              {authenticationGap
                ? "SSH sign-in required"
                : connected
                  ? "Connected"
                  : recoveryExpired
                    ? "Connection unavailable · retrying"
                    : "Reconnecting · input blocked"}
            </span>
            <span className="status">
              Screen {screen ? "on" : "off"}
              {settings.webcam ? ` · Camera ${camera ? "on" : "off"}` : ""}
            </span>
            <span
              title={`Saved files in ${directory} are collected automatically when time expires or you finish the exam. Unsaved editor buffers are not included.`}
            >
              <code>{directory}</code>
            </span>
          </small>
        </div>
        <div className="time" hidden={!attempt.start}>
          <span>Remaining</span>
          <b>{remaining(attempt.deadline, clock)}</b>
        </div>
        <button
          onClick={open}
          disabled={
            locked ||
            authenticationGap ||
            !connected ||
            count >= settings.terminals ||
            ended ||
            attempt.state === "FINALIZING"
          }
        >
          {attempt.state === "PREPARING" ? "Practice terminal" : "New terminal"}
        </button>
        <button onClick={arrange} disabled={!count} hidden={!count}>
          Arrange terminals
        </button>
        <details
          ref={tools}
          hidden={!count}
          className="workspace-tools"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              tools.current!.open = false;
              tools.current!.querySelector("summary")!.focus();
            }
          }}
        >
          <summary>Terminals</summary>
          <div className="tool-menu">
            <div className="terminal-switcher" aria-label="Open terminals">
              {[...panes.current.values()].map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    if (p.box.min) p.box.restore();
                    p.box.focus();
                    p.term.focus();
                    active.current = p.id;
                    tools.current!.open = false;
                  }}
                >
                  {p.name}
                  {p.box.min ? " (minimized)" : ""}
                </button>
              ))}
            </div>
          </div>
        </details>
        <button
          className="danger"
          hidden={attempt.state === "PREPARING"}
          onClick={() => setDialog({ kind: "finish" })}
          disabled={attempt.state !== "ACTIVE" || !connected || ended}
        >
          Finish exam
        </button>
        <button onClick={() => setDialog({ kind: "signout" })}>Sign out</button>
      </header>
      {attempt.state === "PREPARING" && (
        <div className="preflight" inert={covered}>
          <button
            aria-pressed={screen}
            onClick={() =>
              action(async () => {
                await capture.current!.setup("screen");
                setScreen(true);
              })
            }
          >
            1. Share entire display
          </button>
          {settings.webcam && (
            <button
              aria-pressed={camera}
              onClick={() =>
                action(async () => {
                  const s = await capture.current!.setup("webcam");
                  setCamera(true);
                  const video =
                    document.querySelector<HTMLVideoElement>("#camera-preview");
                  if (video) {
                    video.srcObject = s!;
                    await video.play();
                  }
                })
              }
            >
              2. Enable webcam
            </button>
          )}
          <button
            onClick={() => action(fullscreen)}
            aria-pressed={isFullscreen}
            disabled={isFullscreen}
          >
            {settings.webcam ? 3 : 2}. Enter fullscreen
          </button>
          <button
            onClick={() => action(lockKeyboard)}
            aria-pressed={keys}
            disabled={!isFullscreen || keys}
          >
            {settings.webcam ? 4 : 3}. Lock keyboard
          </button>
          <button
            className="primary"
            disabled={
              !connected ||
              authenticationGap ||
              !screen ||
              (settings.webcam && !camera) ||
              !keys ||
              !isFullscreen
            }
            onClick={() => setDialog({ kind: "begin" })}
          >
            Begin exam
          </button>
          {settings.webcam && (
            <video id="camera-preview" muted autoPlay playsInline />
          )}
        </div>
      )}
      <main
        ref={area}
        className="window-area"
        aria-label="Terminal windows"
        inert={covered}
      >
        {count === 0 && !ended && (
          <div className="empty-workspace">
            <p>
              Open a{" "}
              {attempt.state === "PREPARING" ? "practice terminal" : "terminal"}{" "}
              to start working.
            </p>
          </div>
        )}
      </main>
      {preflightRecovery && (
        <div className="lock-overlay">
          <div className="card">
            <h1>Preflight connection lost</h1>
            <p>
              {authenticationGap
                ? "Your SSH connection has ended. Sign in again to reconnect."
                : "The server connection is unavailable. Retrying automatically; you can also sign in again."}
            </p>
            <p>Your exam has not started. No exam time has elapsed.</p>
            <button
              className="primary"
              onClick={() =>
                action(async () => {
                  await api("/logout", {});
                  capture.current?.stop();
                  onReauthenticate(settings.id, attemptRef.current.username);
                })
              }
            >
              Reconnect SSH
            </button>
          </div>
        </div>
      )}
      {(locked || (!connected && attempt.state === "ACTIVE")) &&
        !ended &&
        attempt.state !== "FINALIZING" && (
          <div className="lock-overlay">
            <div className="card">
              <h1>
                {locked
                  ? sandbox
                    ? "Exam paused"
                    : "Instructor review required"
                  : "Reconnecting"}
              </h1>
              <p>
                {message || "Terminal input is disabled while reconnecting."}
              </p>
              <b>
                {remaining(attempt.deadline, clock)} remaining · clock continues
              </b>

              {locked && (
                <>
                  {!sandbox && (
                    <details className="review-request">
                      <summary>Request instructor review</summary>
                      <label>
                        Message for your instructor
                        <textarea
                          rows={2}
                          maxLength={1000}
                          value={review}
                          onChange={(e) => setReview(e.target.value)}
                        />
                      </label>
                      <button
                        onClick={() =>
                          action(() =>
                            api(`/student/attempts/${id}/review-request`, {
                              message: review,
                            }),
                          )
                        }
                      >
                        Request instructor review
                      </button>
                    </details>
                  )}
                  <div
                    className="recovery-checks"
                    hidden={authenticationGap}
                    aria-label="Recovery conditions"
                  >
                    <div>
                      <span>Fullscreen</span>
                      <b className={isFullscreen ? "status" : "warn"}>
                        {isFullscreen ? "Active" : "Missing"}
                      </b>
                    </div>
                    <div>
                      <span>Keyboard lock</span>
                      <b className={keys ? "status" : "warn"}>
                        {keys ? "Active" : "Missing"}
                      </b>
                    </div>
                    <div>
                      <span>Screen sharing</span>
                      <b className={screen ? "status" : "warn"}>
                        {screen ? "Active" : "Missing"}
                      </b>
                    </div>
                    {settings.webcam && (
                      <div>
                        <span>Camera</span>
                        <b className={camera ? "status" : "warn"}>
                          {camera ? "Active" : "Missing"}
                        </b>
                      </div>
                    )}
                  </div>
                  {authenticationGap && (
                    <p className="warn">
                      SSH disconnected. Reconnect
                      {sandbox ? "" : " after instructor authorization"} to
                      resume. Saved files remain; unsaved editor buffers are
                      lost.
                    </p>
                  )}
                  <div className="restore-actions" hidden={authenticationGap}>
                    <button
                      aria-pressed={screen}
                      disabled={!!restoring || authenticationGap}
                      onClick={() =>
                        void recoveryAction(
                          "Restoring screen sharing",
                          "Screen sharing is active.",
                          async () => {
                            await capture.current!.setup("screen");
                            setScreen(capture.current!.healthy("screen"));
                          },
                        )
                      }
                    >
                      Restore screen sharing
                    </button>
                    {settings.webcam && (
                      <button
                        aria-pressed={camera}
                        disabled={!!restoring || authenticationGap}
                        onClick={() =>
                          void recoveryAction(
                            "Restoring camera",
                            "Camera sharing is active.",
                            async () => {
                              await capture.current!.setup("webcam");
                              setCamera(capture.current!.healthy("webcam"));
                            },
                          )
                        }
                      >
                        Restore camera
                      </button>
                    )}
                    <button
                      aria-pressed={isFullscreen}
                      disabled={
                        isFullscreen || !!restoring || authenticationGap
                      }
                      onClick={() =>
                        void recoveryAction(
                          "Restoring fullscreen",
                          "Fullscreen is active. Restore keyboard lock next.",
                          fullscreen,
                        )
                      }
                    >
                      Restore fullscreen
                    </button>
                    <button
                      aria-pressed={keys}
                      disabled={keys || !!restoring || authenticationGap}
                      onClick={() =>
                        void recoveryAction(
                          "Restoring keyboard lock",
                          "Keyboard lock is active.",
                          lockKeyboard,
                        )
                      }
                    >
                      Restore keyboard lock
                    </button>
                  </div>
                  {recoveryFeedback && (
                    <p
                      className={`recovery-feedback ${recoveryFeedback.error ? "warn" : "status"}`}
                      role={recoveryFeedback.error ? "alert" : "status"}
                    >
                      {recoveryFeedback.text}
                    </p>
                  )}
                  <button onClick={() => setDialog({ kind: "signout" })}>
                    Sign out
                  </button>
                  <button
                    className="primary"
                    disabled={!!restoring}
                    hidden={authenticationGap}
                    onClick={() =>
                      void recoveryAction(
                        "Checking continuation",
                        "Exam resumed.",
                        continueExam,
                      )
                    }
                  >
                    {sandbox
                      ? "Continue exam"
                      : "Continue exam after authorization"}
                  </button>
                  <button
                    hidden={!authenticationGap}
                    onClick={() =>
                      void recoveryAction(
                        "Opening SSH sign-in",
                        "",
                        async () => {
                          await api(`/student/attempts/${id}/reauth`, {});
                          armed.current = false;
                          capture.current?.stop();
                          onReauthenticate(
                            settings.id,
                            attemptRef.current.username,
                          );
                        },
                      )
                    }
                  >
                    Reconnect SSH
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      {attempt.state === "FINALIZING" && (
        <div className="lock-overlay">
          <div className="card">
            <h1>Protecting your submission</h1>
            <p>
              Terminal access has ended. Saved files are being collected; wait
              for confirmation.
            </p>
          </div>
        </div>
      )}
      {ended && (
        <div className="lock-overlay">
          <div className="card">
            <h1>
              {attempt.state === "COMPLETED"
                ? "Submission secured"
                : attempt.state === "CANCELLED_BEFORE_START"
                  ? "Preflight ended before starting"
                  : attempt.protected
                    ? "Submission secured; cleanup requires recovery"
                    : "Collection requires recovery"}
            </h1>
            <p>
              {attempt.state === "COMPLETED"
                ? "Your saved files have been protected on the class server."
                : attempt.state === "CANCELLED_BEFORE_START"
                  ? "Your exam has not started and no exam time was consumed. Sign out and sign in again to retry preflight."
                  : attempt.protected
                    ? "Your saved files are protected. The instructor must review workload cleanup or transfer status."
                    : "Your attempt has ended. Automatic collection is pending or failed. Your instructor has been alerted; no submission action is required from you."}
            </p>
            {attempt.start && !functionalTest && (
              <p>
                Finishing does not restore ordinary server access before the
                original deadline, {chicago(attempt.deadline)}, and secured
                collection. This attempt cannot be reopened.
              </p>
            )}
            <button onClick={() => action(onSignOut)}>Sign out</button>
            {attempt.state !== "CANCELLED_BEFORE_START" && (
              <details>
                <summary>Submission details</summary>
                <p>
                  Attempt <code>{id}</code>
                </p>
                <p>
                  Checksum <code>{attempt.checksum || "Pending"}</code>
                </p>
                <p>
                  {attempt.export_status === "ready"
                    ? "Export verified"
                    : "Transfer pending; the protected copy is retained."}
                </p>
              </details>
            )}
          </div>
        </div>
      )}
      {dialog && (
        <Modal
          onClose={() => setDialog(null)}
          title={
            dialog.kind === "begin"
              ? "Begin your timed exam?"
              : dialog.kind === "finish"
                ? "Finish exam?"
                : dialog.kind === "close"
                  ? "Close this terminal?"
                  : dialog.kind === "rename"
                    ? "Rename terminal"
                    : dialog.kind === "signout"
                      ? "Sign out of the workspace?"
                      : "Terminal error"
          }
        >
          {dialog.kind === "signout" && (
            <p>
              {["ACTIVE", "LOCKED"].includes(attempt.state)
                ? sandbox
                  ? "Signing out disconnects your terminals. You can sign back in without approval; the original clock continues and saved files are collected automatically at the deadline."
                  : "Signing out disconnects your terminals and requires instructor approval to return. The clock continues. Saved files are still collected automatically at the deadline, even while signed out."
                : "Your SSH terminals will disconnect. You can sign in again when you are ready."}
            </p>
          )}
          {dialog.kind === "close" && (
            <p>
              Save your files before closing{" "}
              {panes.current.get(dialog.pane)?.name || "this terminal"}. Running
              programs in this pane will end. Saved files remain available and
              are collected automatically when time expires or you finish the
              exam.
            </p>
          )}
          {dialog.kind === "begin" && (
            <p>
              {!functionalTest &&
                "Starting closes other server sessions and processes; save their work first. "}
              You have {settings.duration / 60} minutes; the clock never pauses.
              Saved files in {directory} are collected automatically when time
              expires or you finish the exam. Unsaved editor buffers are not
              included.
            </p>
          )}
          {dialog.kind === "finish" && (
            <p>
              Finishing is irreversible. Save your files first: this ends
              terminal access and automatically collects saved files in{" "}
              {directory}. Unsaved editor buffers are not included. You can also
              let time expire for automatic collection.
              {!functionalTest &&
                " Ordinary server access stays blocked until the original deadline and secured collection."}
            </p>
          )}
          {dialog.kind === "error" && <p>{dialog.message}</p>}
          {dialog.kind === "rename" && (
            <input
              aria-label="Terminal name"
              value={dialog.name}
              maxLength={60}
              onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
            />
          )}
          <div className="actions">
            <button onClick={() => setDialog(null)}>
              {dialog.kind === "error" ? "Close" : "Cancel"}
            </button>
            {dialog.kind !== "error" && (
              <button
                className="primary"
                disabled={dialog.kind === "rename" && !dialog.name.trim()}
                onClick={() =>
                  action(async () => {
                    const d = dialog;
                    setDialog(null);
                    if (d.kind === "signout") await onSignOut();
                    if (d.kind === "begin") await begin();
                    if (d.kind === "finish") {
                      armed.current = false;
                      capture.current?.stop();
                      clipboard.current = "";
                      const pending = {
                        ...attemptRef.current,
                        state: "FINALIZING",
                      };
                      attemptRef.current = pending;
                      setAttempt(pending);
                      const result = await api(
                        `/student/attempts/${id}/finish`,
                        {},
                        page,
                      );
                      setAttempt(result.attempt);
                      attemptRef.current = result.attempt;
                      armed.current = false;
                      capture.current?.stop();
                      clipboard.current = "";
                    }
                    if (d.kind === "close") {
                      send({ type: "close", pane: d.pane });
                      remove(d.pane);
                    }
                    if (d.kind === "rename") {
                      const p = panes.current.get(d.pane)!;
                      p.name = d.name.trim();
                      p.box.setTitle(p.name);
                      for (const [selector, label] of [
                        [
                          ".wb-max",
                          `${p.box.max ? "Restore" : "Maximize"} ${p.name}`,
                        ],
                        [".wb-min", `Minimize ${p.name}`],
                        [".wb-close", `Close ${p.name}`],
                      ]) {
                        const control = p.box.dom.querySelector(selector);
                        control.setAttribute("aria-label", label);
                        control.title = label;
                      }
                      redrawPanes((v) => v + 1);
                    }
                  })
                }
              >
                {dialog.kind === "begin"
                  ? "Begin exam"
                  : dialog.kind === "finish"
                    ? "Finish exam"
                    : dialog.kind === "close"
                      ? "Close terminal"
                      : dialog.kind === "signout"
                        ? "Sign out"
                        : "Save name"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
