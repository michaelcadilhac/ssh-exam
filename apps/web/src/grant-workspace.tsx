export function workspaceChoice(mode: string, name: string, hash: string) {
  if (mode === "materials") return undefined;
  if (mode === "empty") return { kind: "empty" };
  if (mode === "saved") {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        name,
      ) ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw Error("Choose this student's saved work.");
    return { kind: "saved", attempt: name, checksum: hash };
  }
  if (
    mode !== "template" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw Error("Choose published starter files.");
  return { kind: "template", name, hash };
}
