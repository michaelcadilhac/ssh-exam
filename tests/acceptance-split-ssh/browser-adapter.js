// Owned acceptance browser only. Never import from shipped web/server code.
// Pass to Playwright page.addInitScript; this function must remain self-contained.
export function installSplitSSH(settings) {
  if (
    location.origin !== settings.origin ||
    !Number.isSafeInteger(settings.expires) ||
    Date.now() >= settings.expires ||
    settings.username === settings.jumpUsername ||
    !settings.privateKey?.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")
  ) throw Error("Invalid or expired acceptance browser setup");
  let privateKey = settings.privateKey;
  delete settings.privateKey;
  const BaseWorker = globalThis.Worker;
  const sameHost = (actual, expected) => actual?.host === expected.host &&
    actual?.port === expected.port &&
    JSON.stringify(actual?.pins) === JSON.stringify(expected.pins);
  globalThis.Worker = class extends BaseWorker {
    postMessage(message, ...options) {
      if (message?.op !== "connect") return super.postMessage(message, ...options);
      const args = message.args;
      if (
        Date.now() >= settings.expires || !privateKey ||
        args?.username !== settings.username || args?.url !== settings.relay ||
        !sameHost(args.jump, settings.jump) || !sameHost(args.class, settings.class) ||
        args.jump.acceptance_username || args.jump.acceptance_private_key ||
        args.class.acceptance_username || args.class.acceptance_private_key
      ) throw Error("Acceptance SSH destination/identity refused");
      const next = {
        ...message,
        args: {
          ...args,
          jump: { ...args.jump, acceptance_username: settings.jumpUsername },
          class: { ...args.class, acceptance_private_key: privateKey },
        },
      };
      try {
        // Structured clone completes synchronously. No institutional answers are
        // inspected, copied, logged or changed by this adapter.
        return super.postMessage(next, ...options);
      } finally {
        privateKey = "";
        next.args.class.acceptance_private_key = "";
      }
    }
  };
}
