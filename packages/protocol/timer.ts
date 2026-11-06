// Clock metadata only: never an execution permit. Callers use canonical attempt
// records or their authenticated projections, never student-supplied fields.
export function timerState(a: any): {
  timer_paused_at: number;
  timer_remaining_ms: number;
} {
  if (
    a.clock_resets === undefined &&
    Number.isSafeInteger(a.timer_paused_at) &&
    a.timer_paused_at > 0 &&
    Number.isSafeInteger(a.timer_remaining_ms) &&
    a.timer_remaining_ms > 0
  )
    return {
      timer_paused_at: a.timer_paused_at,
      timer_remaining_ms: a.timer_remaining_ms,
    };
  try {
    const records =
      typeof a.clock_resets === "string"
        ? JSON.parse(a.clock_resets)
        : a.clock_resets;
    const last = Array.isArray(records) ? records.at(-1) : undefined;
    if (
      last &&
      last.revision === a.clock_revision &&
      Number.isSafeInteger(last.timer_paused_at) &&
      last.timer_paused_at > 0 &&
      Number.isSafeInteger(last.timer_remaining_ms) &&
      last.timer_remaining_ms > 0
    )
      return {
        timer_paused_at: last.timer_paused_at,
        timer_remaining_ms: last.timer_remaining_ms,
      };
  } catch {
    /* Malformed history never invents a paused clock. */
  }
  return { timer_paused_at: 0, timer_remaining_ms: 0 };
}

export function timerPaused(a: any): boolean {
  const state = a.clock_resets === undefined ? a : timerState(a);
  return (
    a.monitoring_mode === "v1" &&
    Number.isSafeInteger(state.timer_paused_at) &&
    state.timer_paused_at > 0 &&
    Number.isSafeInteger(state.timer_remaining_ms) &&
    state.timer_remaining_ms > 0
  );
}

export function effectiveDeadline(a: any): number {
  return timerPaused(a) ? Number.MAX_SAFE_INTEGER : a.deadline || 0;
}

export function countdownMS(a: any, at: number): number {
  const state = a.clock_resets === undefined ? a : timerState(a);
  return timerPaused(a)
    ? state.timer_remaining_ms
    : Math.max(0, (a.deadline || at) - at);
}
