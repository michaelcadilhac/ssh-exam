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
      network.push({
        path: value,
        event: "response",
        status: response.status(),
      });
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
  // Raw browser source is deliberate: tsx's keep-names transform can otherwise
  // inject an outer __name helper into the serialized Worker constructor.
  await page.addInitScript(`(() => {
    const events = [];
    window.__examBootstrapEvents = events;
    const admissions = [];
    window.__examPaneRefusals = admissions;
    const Base = window.Worker;
    let next = 0;
    window.Worker = class extends Base {
      constructor(url, options) {
        super(url, options);
        const worker = ++next;
        const note = (event) => {
          if (events.length < 24) events.push({ event, worker });
        };
        note("created");
        this.addEventListener("message", ({ data }) => {
          if (["ready", "fatal", "loss"].includes(data?.type)) note(data.type);
          // Synthetic observer only. Never retain connect/auth requests, replies,
          // tokens or MFA answers. The production control channel deliberately
          // exposes only a fixed category; retain this local pane-only cause.
          if (
            data?.type === "rpc-result" &&
            data.diagnostic?.stage === "open" &&
            typeof data.error === "string" &&
            admissions.length < 8
          )
            admissions.push({ worker, error: data.error.slice(0, 256) });
        });
        this.addEventListener("error", () => note("worker-error"));
      }
    };
  })();`);
  return async () => ({
    network,
    worker: await page
      .evaluate(() => (window as any).__examBootstrapEvents ?? [])
      .catch(() => [{ event: "page-unavailable" }]),
    paneRefusals: await page
      .evaluate(() => (window as any).__examPaneRefusals ?? [])
      .catch(() => [{ unavailable: true }]),
  });
}
