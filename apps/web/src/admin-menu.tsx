import React, { useLayoutEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
export type MenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};
export function AdminMenu({
  label,
  children = "Actions",
  actions,
  disabled = false,
}: {
  label: string;
  children?: React.ReactNode;
  actions: MenuAction[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({
      top: Math.min(
        rect.bottom + 6,
        Math.max(8, window.innerHeight - actions.length * 42 - 20),
      ),
      left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)),
    });
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const dismiss = (event: Event) => {
      if (event.type === "scroll") {
        const current = trigger.current?.getBoundingClientRect();
        // Opening a menu can follow browser auto-scroll of its trigger. That
        // queued event is not a later movement of this already-positioned menu.
        if (
          current &&
          current.top === rect.top &&
          current.left === rect.left &&
          current.bottom === rect.bottom &&
          current.right === rect.right
        )
          return;
      }
      setOpen(false);
      if (menu.current?.contains(document.activeElement))
        trigger.current?.focus();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "Tab") {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      const buttons = [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || []),
      ];
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
        buttons.length
      ) {
        e.preventDefault();
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (current + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                buttons.length;
        buttons[next].focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        disabled={disabled}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            className="admin-action-menu"
            style={position}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                disabled={a.disabled}
                className={a.danger ? "danger" : ""}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  a.onSelect();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
