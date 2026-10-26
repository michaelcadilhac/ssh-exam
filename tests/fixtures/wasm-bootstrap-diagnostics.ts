// Private observers only: no protocol, credentials, timing budget or authority changes.
import type { Page } from "@playwright/test";

export async function observeWasmBootstrap(page: Page) {
  const network: { path: string; event: string; status?: number }[] = [];
  const path = (url: string) => {
    const value = new URL(url).pathname;
    return value === "/ssh/client.wasm" || value === "/ssh/wasm_exec.js"
      ? value
      : null;
  };
  page.on("response", (response) => {
    const value = path(response.url());
    if (value && network.length < 24)
      network.push({ path: value, event: "response", status: response.status() });
  });
  page.on("requestfinished", (request) => {
    const value = path(request.url());
    if (value && network.length < 24)
      network.push({ path: value, event: "finished" });
  });
  page.on("requestfailed", (request) => {
    const value = path(request.url());
    if (value && network.length < 24)
      network.push({ path: value, event: "failed" });
  });
  await page.addInitScript(() => {
    const events: { event: string; worker?: number }[] = [];
    (window as any).__examBootstrapEvents = events;
    const Base = window.Worker;
    let next = 0;
    window.Worker = class extends Base {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const worker = ++next;
        const note = (event: string) => {
          if (events.length < 24) events.push({ event, worker });
        };
        note("created");
        this.addEventListener("message", ({ data }) => {
          if (["ready", "fatal", "loss"].includes(data?.type)) note(data.type);
        });
        this.addEventListener("error", () => note("worker-error"));
      }
    };
  });
  return async () => ({
    network,
    worker: await page
      .evaluate(() => (window as any).__examBootstrapEvents ?? [])
      .catch(() => [{ event: "page-unavailable" }]),
  });
}
