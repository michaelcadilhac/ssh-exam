export interface AuthChallenge {
  host: string;
  instruction: string;
  prompts: { prompt: string; echo: boolean }[];
  round: string;
  instructions?: string[];
}

export type AuthMessageBlock = {
  kind: "paragraph" | "formatted" | "separator";
  text: string;
};

// SSH banners often wrap prose for an 80-column terminal. Reflow that prose
// for the login panel, retaining paragraph boundaries and structured output.
export function authMessageBlocks(instruction: string): AuthMessageBlock[] {
  const blocks: AuthMessageBlock[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (!lines.length) return;
    const formatted = lines.some((line) =>
      /^(?:\s{2,}\S|\t|\s*(?:[-*•]|\d+[.)])\s+)/.test(line),
    );
    blocks.push({
      kind: formatted ? "formatted" : "paragraph",
      text: formatted
        ? lines.join("\n")
        : lines.map((line) => line.trim()).join(" "),
    });
    lines = [];
  };
  for (const line of instruction.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) flush();
    else if (/^\s*[-=_*─━]{3,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "separator", text: line.trim() });
    } else lines.push(line);
  }
  flush();
  return blocks;
}

export function updateAuthChallenge(
  current: AuthChallenge | null,
  message: AuthChallenge & { type: "challenge" | "notice" },
): AuthChallenge {
  if (message.type === "notice" && current && current.host !== message.host)
    return current;
  const history =
    current?.host === message.host ? current.instructions || [] : [];
  const text = message.instruction.trim();
  const instructions =
    text && !history.includes(text) ? [...history, text] : history;
  return {
    ...(message.type === "notice" && current ? current : message),
    instructions,
  };
}
