import { installRelaySocketDiagnostics } from "./relay-socket-diagnostics.js";

const queued: any[] = [];
let ready = false;
const scope = globalThis as any;
const nativePost = scope.postMessage.bind(scope);
const relayDiagnostics = installRelaySocketDiagnostics(scope, (diagnostic) =>
  nativePost({ type: "transport-diagnostic", diagnostic }),
);
const deliver = (data: any) => {
  try {
    if (data.op === "connect") relayDiagnostics.select(data.args?.url);
    scope.examSSHrequest(JSON.stringify(data));
  } finally {
    if (data.op === "answers") {
      data.args?.answers?.fill("");
      data.args = undefined;
    }
  }
};
scope.onmessage = (event: MessageEvent) => {
  if (!ready) queued.push(event.data);
  else deliver(event.data);
};
scope.postMessage = (value: any) => {
  if (value.type === "ready") {
    ready = true;
    for (const m of queued) deliver(m);
    queued.length = 0;
  }
  nativePost(value);
};
void (async () => {
  const runtime = "/ssh/wasm_exec.js";
  await import(/* @vite-ignore */ runtime);
  const go = new scope.Go();
  const response = await fetch("/ssh/client.wasm");
  if (!response.ok) throw Error("Browser SSH module unavailable");
  const module = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    go.importObject,
  );
  await go.run(module.instance);
})().catch(() =>
  nativePost({
    type: "fatal",
    error: "Browser SSH module failed to initialize",
  }),
);
