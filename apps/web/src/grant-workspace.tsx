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
      throw Error(
        "Choose the student's protected attempt UUID and exact archive checksum; native retention confirmation is required before use",
      );
    return { kind: "saved", attempt: name, checksum: hash };
  }
  if (
    mode !== "template" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw Error(
      "Choose an exact attested starter name and version; no mutable/latest fallback",
    );
  return { kind: "template", name, hash };
}

// Used by actual additional issuance and explicit unused-grant revision forms.
export function GrantWorkspaceFields({
  mode,
  name,
  hash,
  onChange,
  materials = false,
  perStudentSaved = false,
}: {
  mode: string;
  name: string;
  hash: string;
  materials?: boolean;
  perStudentSaved?: boolean;
  onChange: (mode: string, name: string, hash: string) => void;
}) {
  return (
    <>
      <label>
        Workspace initialization
        <select
          value={mode}
          onChange={(e) => onChange(e.target.value, name, hash)}
        >
          {materials && (
            <option value="materials">Materials template's starter</option>
          )}
          <option value="empty">Empty workspace</option>
          <option value="template">Exact template starter</option>
          <option value="saved">Protected saved work</option>
        </select>
      </label>
      {(mode === "template" || (mode === "saved" && !perStudentSaved)) && (
        <>
          <label>
            {mode === "saved"
              ? "Protected source attempt UUID"
              : "Starter template name"}
            <input
              value={name}
              onChange={(e) => onChange(mode, e.target.value, hash)}
            />
          </label>
          <label>
            {mode === "saved"
              ? "Protected source archive checksum"
              : "Starter template version"}
            <input
              value={hash}
              onChange={(e) => onChange(mode, name, e.target.value)}
            />
          </label>
        </>
      )}
      <p>
        Writable starter files are independent of read-only materials. Each
        attempt receives its own copy.
      </p>
    </>
  );
}
