import React, { useLayoutEffect, useRef } from "react";

export function TerminalMenu({
  x,
  y,
  canCopy,
  canPaste,
  fontSize,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  fontSize: number;
  onAction: (action: "copy" | "paste" | "in" | "out" | "reset") => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menu.current!;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!el.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [x, y]);
  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Terminal actions"
      className="terminal-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const buttons = [
          ...menu.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        role="menuitem"
        disabled={!canCopy}
        onClick={() => onAction("copy")}
      >
        Copy
      </button>
      <button
        role="menuitem"
        disabled={!canPaste}
        onClick={() => onAction("paste")}
      >
        Paste
      </button>
      <div role="separator" />
      <button
        role="menuitem"
        disabled={fontSize >= 28}
        onClick={() => onAction("in")}
      >
        Zoom in
      </button>
      <button
        role="menuitem"
        disabled={fontSize <= 10}
        onClick={() => onAction("out")}
      >
        Zoom out
      </button>
      <button
        role="menuitem"
        disabled={fontSize === 15}
        onClick={() => onAction("reset")}
      >
        Reset zoom
      </button>
    </div>
  );
}
