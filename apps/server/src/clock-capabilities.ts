// Shared synchronous check of the already authenticated native configuration.
export function assertClockCapabilities(
  health: any,
  extend: boolean,
  timer = false,
) {
  if (
    !health?.fixture &&
    ![
      "clock-reset",
      "deadline-timing-check",
      ...(extend ? ["clock-extend"] : []),
      ...(timer ? ["timer-clock-controls-v1"] : []),
    ].every((c) => health?.capabilities?.includes(c))
  )
    throw Error(
      "Update the class-server agent before changing clocks; inspect examctl health",
    );
}
