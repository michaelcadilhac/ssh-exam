// OSC 52 supports writes only, into the attempt-local clipboard. Never respond
// to clipboard queries or involve the browser/OS clipboard APIs.
export const MAX_TERMINAL_CLIPBOARD_BYTES = 75000;
const maxEncodedLength = Math.ceil(MAX_TERMINAL_CLIPBOARD_BYTES / 3) * 4;
export function decodeTerminalClipboard(data: string): string | null {
  if (data.length > maxEncodedLength + 4) return null;
  const separator = data.indexOf(";");
  if (separator < 0) return null;
  const selection = data.slice(0, separator);
  const encoded = data.slice(separator + 1);
  if (!/^(?:c|p|cp|pc)?$/.test(selection) || encoded === "?") return null;
  // Strict base64, including canonical padding; malformed input cannot clear
  // or partially overwrite an existing clipboard value.
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    return null;
  try {
    const binary = atob(encoded);
    if (
      binary.length > MAX_TERMINAL_CLIPBOARD_BYTES ||
      btoa(binary) !== encoded
    )
      return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}
