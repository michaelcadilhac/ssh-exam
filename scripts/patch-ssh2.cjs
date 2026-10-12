// ssh2 1.17.0 suppresses zero-prompt instructions. Deliver every round to the existing
// keyboard-interactive callback; our handler supplies [] for zero-prompt rounds.
// No wire protocol is changed. Refuse to apply blindly to a different library version.
const fs = require("node:fs");
const path = require("node:path");
const pkg = require("ssh2/package.json");
if (pkg.version !== "1.17.0")
  throw Error("Review the zero-prompt patch before changing ssh2");
const file = path.join(path.dirname(require.resolve("ssh2")), "client.js");
let text = fs.readFileSync(file, "utf8");
const original = `            if (nprompts === 0) {
              debug && debug(
                'Client: Sending automatic USERAUTH_INFO_RESPONSE'
              );
              proto.authInfoRes();
              return;
            }`;
const replacement =
  "            // SSH-EXAM: expose zero-prompt instructions via curAuth.prompt below.";
if (text.includes(replacement)) process.exit(0);
if (!text.includes(original))
  throw Error("ssh2 source changed; zero-prompt patch requires review");
fs.writeFileSync(file, text.replace(original, replacement));
