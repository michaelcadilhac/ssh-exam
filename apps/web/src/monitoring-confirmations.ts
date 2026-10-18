// Socket liveness is independent of the ordering of exam-state snapshots. A
// one-use echo proves a recent round trip on this connection; stale state, HTTP
// replies and replayed/late socket messages cannot manufacture confirmation.
export const MONITORING_TIMEOUT_MS = 15_000;
export class MonitoringConfirmations {
  private pending = new Map<string, number>();
  constructor(private now = () => performance.now()) {}
  issue(id: string = crypto.randomUUID()): string {
    const time = this.now();
    for (const [key, at] of this.pending)
      if (time - at >= MONITORING_TIMEOUT_MS) this.pending.delete(key);
    this.pending.set(id, time);
    if (this.pending.size > 16)
      this.pending.delete(this.pending.keys().next().value!);
    return id;
  }
  confirm(id: unknown): boolean {
    if (typeof id !== "string") return false;
    const at = this.pending.get(id);
    this.pending.delete(id);
    if (at === undefined) return false;
    const elapsed = this.now() - at;
    return elapsed >= 0 && elapsed < MONITORING_TIMEOUT_MS;
  }
  clear() {
    this.pending.clear();
  }
}
