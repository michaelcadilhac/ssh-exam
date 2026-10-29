import { useState } from "react";
import { api, chicago } from "./api.js";
import { Modal } from "./modal.js";
import { beginTime } from "./attempt-grants.js";
import { GrantWorkspaceFields, workspaceChoice } from "./grant-workspace.js";

export function GrantIssuanceDialog({
  initial,
  additional = false,
  onClose,
  onChanged,
}: {
  initial: any;
  additional?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const practice = initial.id === "sandbox";
  const [definition, setDefinition] = useState(initial),
    [usernames, setUsernames] = useState(""),
    [earliest, setEarliest] = useState(
      new Date(initial.earliest).toISOString(),
    ),
    [latest, setLatest] = useState(new Date(initial.latest).toISOString()),
    [reason, setReason] = useState(""),
    [duration, setDuration] = useState(String(initial.duration)),
    [webcam, setWebcam] = useState("effective"),
    [workMode, setWorkMode] = useState("materials"),
    [workName, setWorkName] = useState(initial.template),
    [workHash, setWorkHash] = useState(initial.template_version ?? ""),
    [savedSources, setSavedSources] = useState<
      Record<string, { attempt: string; checksum: string }>
    >({}),
    [individual, setIndividual] = useState(false),
    [individualSettings, setIndividualSettings] = useState<
      Record<string, { duration: string; webcam: string }>
    >({}),
    [review, setReview] = useState<any>(null),
    [previewID, setPreviewID] = useState(""),
    [pending, setPending] = useState<{
      operation: string;
      path: string;
      body: any;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selectedStudents = usernames
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean),
    bulkSaved =
      additional && workMode === "saved" && selectedStudents.length > 1;
  const perform = async (operation: "preview" | "confirm" | "cancel") => {
    if (busy) return;
    setError("");
    try {
      let sourceSelection: Record<string, unknown> = {};
      if (!pending && operation === "preview") {
        if (
          additional &&
          (!Number.isSafeInteger(Number(duration)) ||
            Number(duration) < 60 ||
            Number(duration) > 21600)
        )
          throw Error(
            "Choose an explicit additional allowance of60..21600 seconds",
          );
        const names = usernames
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean);
        if (
          !names.length ||
          names.length > 200 ||
          new Set(names).size !== names.length ||
          names.some((n) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(n))
        )
          throw Error(
            "Name 1..200 valid enrolled students, each once, to preview NEW grants",
          );
        if (reason.trim().length < 8 || reason.length > 1000)
          throw Error(
            "Give a concrete 8..1000 character reason for NEW issuance",
          );
        if (beginTime(latest) <= beginTime(earliest))
          throw Error(
            "Latest Begin must be after earliest Begin; use an explicit finite window",
          );
        if (additional) {
          if (bulkSaved) {
            sourceSelection = {
              saved_sources: names.map((username) => {
                const selected = savedSources[username] ?? {
                  attempt: "",
                  checksum: "",
                };
                try {
                  workspaceChoice("saved", selected.attempt, selected.checksum);
                } catch (e) {
                  throw Error(`${username}: ${(e as Error).message}`);
                }
                return { username, ...selected };
              }),
            };
          } else {
            const work = workspaceChoice(workMode, workName, workHash);
            sourceSelection = work ? { work } : {};
          }
          if (individual && !practice) {
            const settings = names.flatMap((username) => {
              const selected = individualSettings[username];
              if (!selected) return [];
              const row: {
                username: string;
                duration?: number;
                webcam?: boolean;
              } = { username };
              if (selected.duration !== "") {
                const seconds = Number(selected.duration);
                if (
                  !Number.isSafeInteger(seconds) ||
                  seconds < 60 ||
                  seconds > 21600
                )
                  throw Error(
                    `${username}: choose60..21600 explicit allowance seconds`,
                  );
                row.duration = seconds;
              }
              if (selected.webcam !== "shared")
                row.webcam = selected.webcam === "required";
              return row.duration !== undefined || row.webcam !== undefined
                ? [row]
                : [];
            });
            if (settings.length) sourceSelection.student_settings = settings;
          }
        }
      }
      const intent =
        pending ??
        (operation === "preview"
          ? {
              operation,
              path: `/admin/exams/${encodeURIComponent(definition.id)}/grants/${additional ? "additional-preview" : "issue-preview"}`,
              body: {
                definition_revision: definition.revision,
                template_version: definition.template_version,
                earliest: beginTime(earliest),
                latest: beginTime(latest),
                usernames: usernames
                  .trim()
                  .split(/[\s,]+/)
                  .filter(Boolean),
                reason,
                ...(additional
                  ? {
                      duration: Number(duration),
                      ...sourceSelection,
                      ...(webcam !== "effective"
                        ? { webcam: webcam === "required" }
                        : {}),
                    }
                  : {}),
                request: crypto.randomUUID(),
              },
            }
          : {
              operation,
              path: `/admin/grant-issuance/${review.id}/${operation}`,
              body: { revision: review.revision, request: crypto.randomUUID() },
            });
      setPending(intent);
      setBusy(true);
      const result = await api(intent.path, intent.body);
      setReview(result);
      setPreviewID(result.id);
      setPending(null);
      if (result.status === "CONFIRMED") await onChanged();
    } catch (e) {
      if ([400, 403, 404, 409].includes((e as any).status)) setPending(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/admin/grant-issuance/${encodeURIComponent(previewID.trim())}`,
      );
      if (result.exam !== initial.id)
        throw Error(
          "This review belongs to another exam; select that exam to inspect it",
        );
      if (
        result.kind !==
        (practice
          ? "NEW_SANDBOX_PRACTICE_GRANTS"
          : additional
            ? "NEW_ADDITIONAL_TEMPLATE_GRANTS"
            : "NEW_LEGACY_INITIAL_GRANTS")
      )
        throw Error(
          "Select the matching initial/additional grant workflow to inspect this review; no new authorization confirmed",
        );
      setReview(result);
      setPending(null);
      if (result.status === "CONFIRMED") await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    setError("");
    try {
      const exams = await api("/admin/exams"),
        current = exams.find((e: any) => e.id === initial.id);
      if (!current)
        throw Error("Exam definition unavailable; inspect the selected exam");
      setDefinition(current);
      setEarliest(new Date(current.earliest).toISOString());
      setLatest(new Date(current.latest).toISOString());
      setReview(null);
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      title={
        practice
          ? "Authorize practice grant"
          : additional
            ? "Authorize additional attempts"
            : "Issue legacy grants"
      }
      onClose={close}
      wide
    >
      {additional ? (
        <p>
          {practice && (
            <>
              Practice is fixed at five minutes, no webcam and four terminals.
              Use this explicit NEW review after revocation or to authorize
              another finite window; automatic practice never replaces
              revoked/expired authority.{" "}
            </>
          )}
          Authorize separate attempts under the same exam, with a chosen
          allowance and exact template. Earlier submissions, clocks and account
          restrictions remain protected. Preview reserves no account or time.
          Reuse the saved review ID to inspect a lost confirmation reply; a new
          confirmed review authorizes another attempt.
        </p>
      ) : (
        <p>
          Create NEW initial grants for enrolled students with no grant or
          attempt history. These use selected current settings; they do not
          reconstruct historical enrollment settings. Preview reserves no
          account or allowance.
        </p>
      )}
      <p>
        Exam: {definition.name} · {definition.id}. Current materials:{" "}
        {definition.template}
      </p>
      <p style={{ overflowWrap: "anywhere" }}>
        Selected exact source:{" "}
        {definition.template_version ||
          "Choose an exact attested version in Exam settings first"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!review && (
        <fieldset disabled={busy || !!pending}>
          <label>
            {additional
              ? "Additional attempt students"
              : "Legacy unused students"}{" "}
            (one per line, up to200)
            <textarea
              aria-label={
                additional
                  ? "Additional attempt students"
                  : "Legacy unused students"
              }
              value={usernames}
              onChange={(e) => setUsernames(e.target.value)}
              rows={4}
            />
          </label>
          {additional && (
            <>
              <GrantWorkspaceFields
                materials
                perStudentSaved={bulkSaved}
                mode={workMode}
                name={workName}
                hash={workHash}
                onChange={(mode, name, hash) => {
                  setWorkMode(mode);
                  setWorkName(name);
                  setWorkHash(hash);
                }}
              />
              {bulkSaved && (
                <fieldset>
                  <legend>Protected saved source for each student</legend>
                  <p>
                    Choose each student's exact attempt and checksum. No source
                    is selected automatically.
                  </p>
                  {Array.from(new Set(selectedStudents))
                    .slice(0, 200)
                    .map((username) => (
                      <div key={username}>
                        <h3>{username}</h3>
                        <label>
                          Protected source attempt for {username}
                          <input
                            value={savedSources[username]?.attempt ?? ""}
                            onChange={(e) => {
                              const attempt = e.target.value;
                              setSavedSources((previous) => ({
                                ...previous,
                                [username]: {
                                  attempt,
                                  checksum: previous[username]?.checksum ?? "",
                                },
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Protected source checksum for {username}
                          <input
                            value={savedSources[username]?.checksum ?? ""}
                            onChange={(e) => {
                              const checksum = e.target.value;
                              setSavedSources((previous) => ({
                                ...previous,
                                [username]: {
                                  attempt: previous[username]?.attempt ?? "",
                                  checksum,
                                },
                              }));
                            }}
                          />
                        </label>
                      </div>
                    ))}
                </fieldset>
              )}
              <label>
                Additional allowance seconds
                <input
                  type="number"
                  min={60}
                  max={21600}
                  step={1}
                  value={duration}
                  readOnly={practice}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              {!practice && (
                <label>
                  Webcam requirement
                  <select
                    value={webcam}
                    onChange={(e) => setWebcam(e.target.value)}
                  >
                    <option value="effective">
                      Preserve each student's effective requirement
                    </option>
                    <option value="required">Explicitly require webcam</option>
                    <option value="optional">
                      Explicitly make webcam optional
                    </option>
                  </select>
                </label>
              )}
              {!practice && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={individual}
                      disabled={busy || !!pending}
                      onChange={(e) => setIndividual(e.target.checked)}
                    />
                    Set individual student settings
                  </label>
                  {individual && (
                    <fieldset>
                      <legend>
                        Individual allowances and webcam overrides
                      </legend>
                      <p>
                        Blank allowances and shared webcam choices use the
                        settings above. Review each saved setting before
                        confirming.
                      </p>
                      {Array.from(new Set(selectedStudents))
                        .slice(0, 200)
                        .map((username) => (
                          <div key={username}>
                            <label>
                              Allowance seconds for {username}
                              <input
                                type="number"
                                min={60}
                                max={21600}
                                step={1}
                                placeholder="Use shared allowance"
                                value={
                                  individualSettings[username]?.duration ?? ""
                                }
                                disabled={busy || !!pending}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setIndividualSettings((old) => ({
                                    ...old,
                                    [username]: {
                                      duration: value,
                                      webcam: old[username]?.webcam ?? "shared",
                                    },
                                  }));
                                }}
                              />
                            </label>
                            <label>
                              Webcam override for {username}
                              <select
                                value={
                                  individualSettings[username]?.webcam ??
                                  "shared"
                                }
                                disabled={busy || !!pending}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setIndividualSettings((old) => ({
                                    ...old,
                                    [username]: {
                                      duration: old[username]?.duration ?? "",
                                      webcam: value,
                                    },
                                  }));
                                }}
                              >
                                <option value="shared">
                                  Use shared webcam choice
                                </option>
                                <option value="required">
                                  Explicitly require webcam
                                </option>
                                <option value="optional">
                                  Explicitly make webcam optional
                                </option>
                              </select>
                            </label>
                          </div>
                        ))}
                    </fieldset>
                  )}
                </>
              )}
            </>
          )}
          <label>
            Earliest Begin (RFC3339 with zone)
            <input
              value={earliest}
              onChange={(e) => setEarliest(e.target.value)}
            />
          </label>
          <label>
            Latest Begin (RFC3339 with zone)
            <input value={latest} onChange={(e) => setLatest(e.target.value)} />
          </label>
          <label>
            {additional
              ? "Reason for additional attempt"
              : "Reason for NEW issuance"}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </label>
          <p>
            Each student's current effective allowance and webcam requirement
            will be shown for review. The chosen Begin window can be outside the
            exam defaults.
          </p>
        </fieldset>
      )}
      {review && (
        <section aria-label="Reviewed new grants">
          <p>
            Status: <strong>{review.status}</strong> · Review expires{" "}
            {chicago(review.expires)}
          </p>
          <p style={{ overflowWrap: "anywhere" }}>Review ID: {review.id}</p>
          <p>{review.reason}</p>
          {review.rows.map((row: any) => (
            <article key={row.username}>
              <h3>{row.username}</h3>
              {row.existing_grants !== undefined && (
                <p>
                  At review time: {row.existing_grants} existing unused or
                  pending grants. This confirmation authorizes another separate
                  attempt.
                </p>
              )}
              <p>
                {row.settings.name} · {row.settings.duration / 60} minutes ·
                Webcam {row.settings.webcam ? "required" : "not required"} ·{" "}
                {row.settings.terminals} terminals
              </p>
              <p>
                Begin from {new Date(row.settings.earliest).toISOString()} until{" "}
                {new Date(row.settings.latest).toISOString()}. Full allowance
                starts only at actual Begin.
              </p>
              <p>
                Collection: {row.settings.collection_file_mib} MiB per file,{" "}
                {row.settings.collection_total_mib} MiB total.
              </p>
              <p style={{ overflowWrap: "anywhere" }}>
                Materials: {row.settings.template} ·{" "}
                {row.settings.template_version}
                <br />
                Workspace:{" "}
                {row.work.kind === "empty"
                  ? "Empty workspace"
                  : row.work.kind === "saved"
                    ? `Protected attempt ${row.work.attempt} · ${row.work.checksum}`
                    : `${row.work.name} · ${row.work.hash}`}
              </p>
              {review.issued.find((g: any) => g.username === row.username) && (
                <p style={{ overflowWrap: "anywhere" }}>
                  Issued grant:{" "}
                  {
                    review.issued.find((g: any) => g.username === row.username)
                      .grant
                  }
                </p>
              )}
            </article>
          ))}
          <p>
            Native saved-work authorizations remain protected and may prevent
            preparation. This review does not convert them or bypass account
            restrictions.
          </p>
        </section>
      )}
      <div className="actions">
        {pending ? (
          <button
            disabled={busy}
            onClick={() =>
              void perform(
                pending.operation as "preview" | "confirm" | "cancel",
              )
            }
          >
            Retry {pending.operation}
          </button>
        ) : review?.status === "REVIEW" ? (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void perform("confirm")}
            >
              {practice
                ? "Confirm practice grant"
                : additional
                  ? "Confirm additional grants"
                  : "Confirm NEW grants"}
            </button>
            <button disabled={busy} onClick={() => void perform("cancel")}>
              Cancel review
            </button>
          </>
        ) : !review ? (
          <button
            className="primary"
            disabled={busy || !definition.template_version}
            onClick={() => void perform("preview")}
          >
            {practice
              ? "Preview practice grant"
              : additional
                ? "Preview additional grants"
                : "Preview NEW grants"}
          </button>
        ) : null}
        {!pending && (
          <button disabled={busy} onClick={() => void reload()}>
            Reload current settings
          </button>
        )}
        <button disabled={busy} onClick={close}>
          Close
        </button>
      </div>
      <label>
        Saved review ID
        <input
          value={previewID}
          onChange={(e) => setPreviewID(e.target.value)}
          disabled={busy || pending?.operation === "preview"}
        />
      </label>
      <button
        disabled={busy || !previewID.trim() || pending?.operation === "preview"}
        onClick={() => void inspect()}
      >
        Inspect saved review
      </button>
    </Modal>
  );
}
