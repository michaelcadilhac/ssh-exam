import React, { useEffect, useId, useRef } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      [
        ...root.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
    (root.current!.querySelector<HTMLElement>("[data-initial-focus]") ||
      root.current!.querySelector<HTMLElement>(
        'input:not(:disabled):not([type="hidden"]), textarea:not(:disabled)',
      ) ||
      controls()[0] ||
      root.current)!.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === "Tab") {
        const items = controls();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? index - 1 : index + 1;
        if (index < 0 || next < 0 || next >= items.length) {
          event.preventDefault();
          (items[event.shiftKey ? items.length - 1 : 0] ||
            root.current)!.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, []);
  return (
    <div className="dialog-backdrop">
      <div
        ref={root}
        className={`card${wide ? " review" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
