import type { ButtonHTMLAttributes } from "react";

type RefreshButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label" | "aria-busy" | "title" | "type"
> & {
  label: string;
  loading?: boolean;
  type?: "button";
};

export function RefreshButton({
  label,
  loading = false,
  disabled = false,
  className = "",
  type = "button",
  ...props
}: RefreshButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`refresh-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20 7v5h-5M19.1 12a7.2 7.2 0 1 0-1.7 4.7M20 12a8 8 0 0 0-2-5.3" />
      </svg>
    </button>
  );
}
