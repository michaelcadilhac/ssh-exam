import type { DisplayObservation } from "../../../packages/protocol/display-policy.js";

type ScreenDetails = EventTarget & {
  screens: readonly object[];
  currentScreen: object;
};
type DisplayWindow = Window & {
  getScreenDetails?: () => Promise<ScreenDetails>;
};

// One owner per workspace. No background permission prompts, HTTP polling or
// inference from screen.isExtended=false. A disposed/older prompt cannot win.
export class DisplayVerification {
  private details?: ScreenDetails;
  private permission?: PermissionStatus;
  private generation = 0;
  private disposed = false;
  private last: DisplayObservation = "unavailable";
  private changed = () => {
    if (this.permission?.state !== "granted") {
      this.details?.removeEventListener("screenschange", this.changed);
      this.details?.removeEventListener("currentscreenchange", this.changed);
      this.details = undefined;
    }
    this.publish();
  };
  constructor(
    private notify: (value: DisplayObservation) => void,
    private browser: DisplayWindow = window,
  ) {}
  status(): DisplayObservation {
    if (this.disposed || this.permission?.state !== "granted" || !this.details)
      return "unavailable";
    const { screens, currentScreen } = this.details;
    if (!Array.isArray(screens) || !screens.includes(currentScreen))
      return "unavailable";
    return screens.length === 1
      ? "single"
      : screens.length > 1
        ? "multiple"
        : "unavailable";
  }
  private publish() {
    const value = this.status();
    if (value !== this.last) {
      this.last = value;
      this.notify(value);
    }
    return value;
  }
  private detach() {
    this.details?.removeEventListener("screenschange", this.changed);
    this.details?.removeEventListener("currentscreenchange", this.changed);
    this.permission?.removeEventListener("change", this.changed);
    this.details = undefined;
    this.permission = undefined;
  }
  async verify() {
    if (this.disposed) return "unavailable" as const;
    const generation = ++this.generation;
    this.detach();
    this.publish();
    if (!this.browser.getScreenDetails) return "unavailable" as const;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Invoke before the first await: this call requires a real user gesture.
      const request = this.browser.getScreenDetails();
      const result = await Promise.race([
        Promise.all([
          request,
          this.browser.navigator.permissions.query({
            name: "window-management" as PermissionName,
          }),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Display check timed out")),
            60_000,
          );
        }),
      ]);
      if (this.disposed || generation !== this.generation)
        return "unavailable" as const;
      [this.details, this.permission] = result;
      this.details.addEventListener("screenschange", this.changed);
      this.details.addEventListener("currentscreenchange", this.changed);
      this.permission.addEventListener("change", this.changed);
      return this.publish();
    } catch {
      return "unavailable" as const;
    } finally {
      clearTimeout(timer);
    }
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.detach();
  }
}
