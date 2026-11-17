import type {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
} from "@playwright/test";
import { OPERATION_TIMEOUT_MS } from "../../packages/protocol/timeouts.js";

// Exercise one ordinary student retry after a positively observed pane refusal.
// The caller retains the refusal and must fail its clean-run acceptance later.
// Never replay an uncertain/pending open or retry a policy/ownership error.
export async function recoverRefusedStressPane(options: {
  page: Pick<Page, "getByRole"> & {
    request: {
      get: (
        url: string,
        options: { timeout: number },
      ) => Promise<Pick<APIResponse, "ok" | "json">>;
    };
  };
  attempt: string;
  opened: () => number;
  expected: number;
  record: () => Promise<void>;
}) {
  const { page, attempt, opened, expected, record } = options;
  const dialog = page.getByRole("dialog", {
    name: "Terminal error",
    exact: true,
  });
  if (!(await dialog.isVisible()))
    throw Error("No confirmed terminal refusal; no retry");
  if (opened() !== expected - 1)
    throw Error("Pane ownership changed; no retry");
  await record(); // Persist failure evidence before any recovery action.
  const text = await dialog.innerText();
  if (!text.includes("This terminal could not open. Try again."))
    throw Error("Unrecognized terminal error; no retry");
  const response = await page.request.get("/api/student/exam", {
    timeout: 5000,
  });
  if (!response.ok()) throw Error("Cannot verify current attempt; no retry");
  const current = (await response.json()).attempt;
  if (
    current?.id !== attempt ||
    current.state !== "ACTIVE" ||
    current.generation !== 0
  )
    throw Error("Attempt changed or requires review; no retry");
  if (opened() !== expected - 1)
    throw Error("Pane ownership changed; no retry");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .click({ timeout: 5000 });
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .click({ timeout: 5000 });
}

export function watchStressNavigation(
  page: Page,
  working: () => boolean,
  report: (path: string) => void,
) {
  page.on("framenavigated", (frame) => {
    if (working() && frame === page.mainFrame())
      report(new URL(frame.url()).pathname);
  });
}

// Separate document startup from ongoing work: prepare every real welcome page
// before clocks, then use the existing SPA. This is not a network-error fix:
// Marco also cancelled steady HTTP/HTTPS requests without any navigation.
export async function prepareStressPages<T>(options: {
  browser: Pick<Browser, "newContext">;
  origin: string;
  students: readonly string[];
  contexts: BrowserContext[];
  initialize: (page: Page, username: string) => Promise<T>;
  note: (message: string) => void;
  spacingMs?: number;
}) {
  const { browser, origin, students, contexts, initialize, note } = options;
  if (
    origin !== "https://127.0.0.1:9444" ||
    students.length < 1 ||
    students.length > 70 ||
    new Set(students).size !== students.length
  )
    throw Error(
      "Private warmup requires1–70unique synthetic accounts on the loopback HTTPS fixture",
    );
  const spacing = options.spacingMs ?? 4000;
  if (!Number.isInteger(spacing) || spacing < 0 || spacing > 4000)
    throw Error("Invalid private welcome spacing");
  const prepared = [];
  for (const username of students) {
    const started = Date.now();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(context); // Owner can clean even a partially prepared cohort.
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const data = await initialize(page, username);
    await openUnauthenticatedStressWelcome(page, origin, note);
    await page
      .getByLabel("Username", { exact: true })
      .waitFor({ state: "visible", timeout: OPERATION_TIMEOUT_MS });
    prepared.push({ username, context, page, data });
    note(
      JSON.stringify({
        phase: "welcome-prepared",
        students: prepared.length,
        total: students.length,
      }),
    );
    if (prepared.length < students.length)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, spacing - (Date.now() - started))),
      );
  }
  return prepared;
}

// Use the existing read-recovery button only after acknowledged authentication
// and fresh read-only proof of the same signed-in, unstarted synthetic account.
// This never repeats SSH credentials, auth completion, setup or Start.
export async function waitForStressExamSummary(
  page: Pick<Page, "getByRole" | "request">,
  identity: { username: string; exam: string },
  completionAccepted: () => boolean,
  note: (message: string) => void,
) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  const remaining = () => Math.max(1, deadline - Date.now());
  const summary = page.getByRole("button", {
    name: "Check setup and practice",
    exact: true,
  });
  const retry = page.getByRole("button", {
    name: "Retry opening exam",
    exact: true,
  });
  await summary.or(retry).waitFor({ state: "visible", timeout: remaining() });
  if (await summary.isVisible()) return;
  if (!completionAccepted())
    throw Error(
      "Exam summary retry requires acknowledged authentication; no retry performed",
    );
  const session = await page.request.get("/api/session", {
    timeout: remaining(),
  });
  if (!session.ok())
    throw Error(
      "Exam summary retry could not verify the signed-in account; no retry performed",
    );
  const user = await session.json();
  if (
    user.role !== "student" ||
    user.username !== identity.username ||
    user.exam !== identity.exam
  )
    throw Error(
      "Exam summary retry account does not match; no retry performed",
    );
  const exam = await page.request.get("/api/student/exam", {
    timeout: remaining(),
  });
  if (!exam.ok() || (await exam.json()).attempt !== null)
    throw Error(
      "Exam summary retry requires a verified absent attempt; no retry performed",
    );
  note(
    JSON.stringify({
      phase: "exam-summary-read-retry",
      ...identity,
      retries: 1,
      acknowledged_authentication: true,
      no_attempt: true,
    }),
  );
  await retry.click({ timeout: remaining() });
  await summary.waitFor({ state: "visible", timeout: remaining() });
}

// Only the public welcome GET, before credentials or an attempt exist. A remote
// generator's network-change cancellation may be retried once; exam operations
// and every other failure retain their original refusal.
export async function openUnauthenticatedStressWelcome(
  page: Pick<Page, "goto" | "waitForTimeout">,
  origin: string,
  note: (message: string) => void,
) {
  try {
    return await page.goto(origin, { timeout: 10000 });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("net::ERR_NETWORK_CHANGED")
    )
      throw error;
    note(
      JSON.stringify({
        phase: "welcome-network-retry",
        error: error.message,
        retries: 1,
      }),
    );
    await page.waitForTimeout(500);
    return page.goto(origin, { timeout: 10000 });
  }
}

// Capture verification precedes the HTTP Start. Observe the two public stages
// separately, using the existing operation budget for each, without retrying Start.
export async function waitForStressStartResponse(
  page: Pick<Page, "waitForRequest">,
  note: (message: string) => void,
) {
  const started = performance.now();
  const request = await page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.endsWith("/begin") &&
      request.method() === "POST",
    { timeout: OPERATION_TIMEOUT_MS },
  );
  const requested = performance.now();
  note(
    JSON.stringify({
      phase: "start-request",
      preparation_ms: Math.round(requested - started),
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      request.response(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error("Start response exceeded the 60-second operation budget"),
            ),
          OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
    if (!response) throw Error("Start request ended without an HTTP response");
    note(
      JSON.stringify({
        phase: "start-response",
        status: response.status(),
        response_ms: Math.round(performance.now() - requested),
      }),
    );
    return response;
  } finally {
    clearTimeout(timer);
  }
}
