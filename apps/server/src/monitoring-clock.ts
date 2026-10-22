import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Internal evidence clock only. No live route/lease/recovery calls it yet.
// Never substitute performance.now, hrtime, wall time or coarse os.uptime.
const require = createRequire(import.meta.url);
export class MonitoringBootClockUnavailable extends Error {
  constructor() {
    super(
      "Monitoring boot clock unavailable; rebuild the Linux native clock and verify runtime compatibility; no monitoring evidence authorized",
    );
    this.name = "MonitoringBootClockUnavailable";
  }
}
type ClockModule = { kind: "linux-boottime-ms-v1"; now: () => unknown };

// Loader injection is a private programming/test boundary, not config/env/IPC.
export function createMonitoringBootClock(
  load: () => unknown = () =>
    require(
      fileURLToPath(
        new URL("../native/monitoring_clock.node", import.meta.url),
      ),
    ),
): () => number {
  let module: ClockModule | undefined;
  return () => {
    try {
      if (!module) {
        const candidate = load() as Partial<ClockModule> | null;
        if (
          !candidate ||
          candidate.kind !== "linux-boottime-ms-v1" ||
          typeof candidate.now !== "function"
        )
          throw new MonitoringBootClockUnavailable();
        module = Object.freeze({
          kind: candidate.kind,
          now: candidate.now.bind(candidate),
        });
      }
      const now = module.now();
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0)
        throw new MonitoringBootClockUnavailable();
      return now;
    } catch {
      // A loader/syscall/ABI failure never exposes paths or native exception data.
      throw new MonitoringBootClockUnavailable();
    }
  };
}
export const monitoringBootTimeMS = createMonitoringBootClock();
