/** One login attempt only. Strings/transport copies cannot be securely erased by JS. */
export class LoginPassword {
  private value?: Buffer;
  private closed = false;
  get available() {
    return !!this.value;
  }
  capture(answers: string[]) {
    try {
      if (
        this.closed ||
        this.value ||
        answers.length !== 1 ||
        !answers[0] ||
        answers[0].length > 4096
      )
        throw Error("Shared password unavailable");
      this.value = Buffer.from(answers[0], "utf8");
    } finally {
      answers.fill("");
    }
  }
  copy() {
    if (this.closed || !this.value)
      throw Error("Login credentials no longer available");
    return Buffer.from(this.value);
  }
  clear() {
    this.closed = true;
    this.value?.fill(0);
    this.value = undefined;
  }
}
export function isPasswordPrompt(
  prompt: { prompt: string; echo: boolean },
  username: string,
  host: string,
) {
  if (prompt.echo) return false;
  const text = prompt.prompt.trim().replace(/:\s*$/, "").toLowerCase();
  return [
    "password",
    "ssh password",
    "account password",
    "login password",
    "unix password",
    "jump password",
    "entra id password",
    "class password",
    `${username}'s password`,
    `${username}@${host}'s password`,
  ]
    .map((s) => s.toLowerCase())
    .includes(text);
}
export function wipeAuthPacket(data: Buffer | ArrayBuffer | Buffer[]) {
  if (Buffer.isBuffer(data)) data.fill(0);
  else if (Array.isArray(data)) for (const part of data) part.fill(0);
  else new Uint8Array(data).fill(0);
}
