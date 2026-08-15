export const CALENDAR_OPEN_PROTOCOL_ACTION = "tps-calendar-open";
export const CALENDAR_OPEN_PROTOCOL_VERSION = "1";

const MAX_PROTOCOL_DATA_CHARS = 4096;
const MAX_VAULT_NAME_CHARS = 256;
const MAX_BASE_PATH_CHARS = 1024;
const MAX_VIEW_NAME_CHARS = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ALLOWED_PARAMETER_KEYS = new Set([
  "action",
  "v",
  "vault",
  "expected-vault",
  "base",
  "view",
  "date",
  "scroll",
]);

export type CalendarOpenProtocolErrorCode =
  | "unexpected-parameter"
  | "request-too-large"
  | "unsupported-action"
  | "unsupported-version"
  | "missing-expected-vault"
  | "vault-mismatch"
  | "invalid-base"
  | "invalid-view"
  | "invalid-date"
  | "invalid-scroll";

export interface CalendarOpenProtocolRequest {
  basePath: string;
  viewName: string;
  date: Date;
  dateKey: string;
  scrollToNow: boolean;
}

export type CalendarOpenProtocolParseResult =
  | { ok: true; request: CalendarOpenProtocolRequest }
  | { ok: false; code: CalendarOpenProtocolErrorCode };

export interface CalendarBaseOpenRequest {
  basePath: string;
  viewName: string;
  date: Date | string | number;
  scrollToNow?: boolean;
}

export interface CalendarProtocolViewResolution {
  ok: boolean;
  code?: "invalid-definition" | "view-not-found" | "view-ambiguous";
  view?: Record<string, unknown>;
}

export interface CalendarProtocolWaitResult<T> {
  ok: boolean;
  value?: T;
  code?: "target-timeout" | "target-ambiguous" | "request-superseded";
  attempts: number;
}

export interface CalendarProtocolBaseCandidate<T> {
  file: T;
  definition: unknown;
}

export type CalendarProtocolBaseWaitResult<T> =
  | {
      ok: true;
      file: T;
      view: Record<string, unknown>;
      attempts: number;
    }
  | {
      ok: false;
      code:
        | "base-missing"
        | "base-read-failed"
        | "invalid-definition"
        | "view-not-found"
        | "view-ambiguous"
        | "request-superseded";
      attempts: number;
    };

export interface CalendarProtocolFocusSettlementResult {
  ok: boolean;
  code?: "focus-timeout" | "target-changed" | "request-superseded";
  attempts: number;
}

export function isCalendarProtocolRenderedRangeCommit(
  expectedViewType: string,
  actualViewType: string,
  requestedDate: Date,
  expectedStart: Date,
  actualStart: Date,
  actualRangeStart: Date,
  actualRangeEnd: Date,
): boolean {
  const dates = [requestedDate, expectedStart, actualStart, actualRangeStart, actualRangeEnd];
  if (expectedViewType !== actualViewType || dates.some((date) => Number.isNaN(date.getTime()))) {
    return false;
  }
  const localDayNumber = (date: Date): number => {
    const normalized = new Date(0);
    normalized.setUTCHours(0, 0, 0, 0);
    normalized.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    return normalized.getTime();
  };
  const requestedDay = localDayNumber(requestedDate);
  return localDayNumber(expectedStart) === localDayNumber(actualStart)
    && requestedDay >= localDayNumber(actualRangeStart)
    && requestedDay < localDayNumber(actualRangeEnd);
}

export type CalendarProtocolDateChangeSource =
  | "render"
  | "programmatic"
  | "automatic"
  | "user";

export function canApplyAutomaticCalendarDate(
  transientDateKey: string | null,
): boolean {
  return transientDateKey === null;
}

export function resolveCalendarProtocolNavigationBounds(
  transientDateKey: string | null,
  navigationBoundsStart: Date | null,
  navigationBoundsEnd: Date | null,
): { start?: Date; end?: Date } {
  if (transientDateKey !== null) {
    return {};
  }
  return {
    start: navigationBoundsStart ?? undefined,
    end: navigationBoundsEnd ?? undefined,
  };
}

export function isCalendarProtocolRendererReady(
  identityMatches: boolean,
  dataRangeReady: boolean,
  updateInFlight: boolean,
): boolean {
  return identityMatches && dataRangeReady && !updateInFlight;
}

export function shouldApplyCalendarProtocolDateChange(
  transientDateKey: string | null,
  observedDateKey: string,
  source: CalendarProtocolDateChangeSource,
): boolean {
  return transientDateKey === null
    || source === "user"
    || observedDateKey === transientDateKey;
}

export function resolveCalendarProtocolDatePersistence(
  transientDateKey: string | null,
  source: CalendarProtocolDateChangeSource,
): { shouldPersist: boolean; nextTransientDateKey: string | null } {
  if (transientDateKey === null) {
    return { shouldPersist: true, nextTransientDateKey: null };
  }
  if (source === "user") {
    return { shouldPersist: true, nextTransientDateKey: null };
  }
  return { shouldPersist: false, nextTransientDateKey: transientDateKey };
}

function readStringParameter(
  params: Record<string, unknown>,
  key: string,
): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function hasUnsafeText(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}

function isSafeVaultName(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_VAULT_NAME_CHARS
    && !hasUnsafeText(value);
}

export function isSafeCalendarBasePath(value: string): boolean {
  if (!value || value.length > MAX_BASE_PATH_CHARS || value !== value.trim()) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("//")) return false;
  if (hasUnsafeText(value) || value.includes("#") || value.includes("|")) return false;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return /\.base$/i.test(value);
}

export function isSafeCalendarViewName(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_VIEW_NAME_CHARS
    && value === value.trim()
    && !hasUnsafeText(value)
    && !value.includes("#")
    && !value.includes("|");
}

export function parseStrictLocalCalendarDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return null;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseCalendarOpenProtocolParams(
  params: Record<string, unknown>,
  currentVaultName: string,
): CalendarOpenProtocolParseResult {
  const entries = Object.entries(params);
  if (entries.some(([key]) => !ALLOWED_PARAMETER_KEYS.has(key))) {
    return { ok: false, code: "unexpected-parameter" };
  }
  const requestSize = entries.reduce((total, [key, value]) => (
    total + key.length + (typeof value === "string" ? value.length : MAX_PROTOCOL_DATA_CHARS + 1)
  ), 0);
  if (requestSize > MAX_PROTOCOL_DATA_CHARS) {
    return { ok: false, code: "request-too-large" };
  }

  const action = readStringParameter(params, "action");
  if (action !== CALENDAR_OPEN_PROTOCOL_ACTION) {
    return { ok: false, code: "unsupported-action" };
  }
  if (readStringParameter(params, "v") !== CALENDAR_OPEN_PROTOCOL_VERSION) {
    return { ok: false, code: "unsupported-version" };
  }

  const expectedVault = readStringParameter(params, "expected-vault");
  if (!expectedVault || !isSafeVaultName(expectedVault)) {
    return { ok: false, code: "missing-expected-vault" };
  }
  if (expectedVault !== currentVaultName) {
    return { ok: false, code: "vault-mismatch" };
  }
  const routedVault = params["vault"] === undefined
    ? null
    : readStringParameter(params, "vault");
  if (routedVault !== null && (!isSafeVaultName(routedVault) || routedVault !== currentVaultName)) {
    return { ok: false, code: "vault-mismatch" };
  }

  const basePath = readStringParameter(params, "base");
  if (!basePath || !isSafeCalendarBasePath(basePath)) {
    return { ok: false, code: "invalid-base" };
  }
  const viewName = readStringParameter(params, "view");
  if (!viewName || !isSafeCalendarViewName(viewName)) {
    return { ok: false, code: "invalid-view" };
  }
  const dateKey = readStringParameter(params, "date");
  const date = dateKey ? parseStrictLocalCalendarDate(dateKey) : null;
  if (!dateKey || !date) {
    return { ok: false, code: "invalid-date" };
  }
  const scroll = params["scroll"] === undefined
    ? null
    : readStringParameter(params, "scroll");
  if (scroll !== null && scroll !== "now") {
    return { ok: false, code: "invalid-scroll" };
  }

  return {
    ok: true,
    request: {
      basePath,
      viewName,
      date,
      dateKey,
      scrollToNow: scroll === "now",
    },
  };
}

export function resolveExactCalendarProtocolView(
  baseDefinition: unknown,
  requestedViewName: string,
): CalendarProtocolViewResolution {
  if (!baseDefinition || typeof baseDefinition !== "object" || Array.isArray(baseDefinition)) {
    return { ok: false, code: "invalid-definition" };
  }
  const views = (baseDefinition as { views?: unknown }).views;
  if (!Array.isArray(views)) {
    return { ok: false, code: "invalid-definition" };
  }
  const matches = views.filter((candidate): candidate is Record<string, unknown> => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    return record.type === "calendar"
      && String(record.name ?? "") === requestedViewName;
  });
  if (matches.length === 0) return { ok: false, code: "view-not-found" };
  if (matches.length !== 1) return { ok: false, code: "view-ambiguous" };
  return { ok: true, view: matches[0] };
}

/**
 * Gives a just-activated mobile vault a short, bounded opportunity to
 * materialize the exact Base definition that TishOS already authorized.
 * Every attempt still performs the same strict named Calendar-view check.
 */
export async function waitForCalendarProtocolBaseView<T>(
  readCandidate: () => Promise<CalendarProtocolBaseCandidate<T> | null>,
  requestedViewName: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    isCancelled?: () => boolean;
  } = {},
): Promise<CalendarProtocolBaseWaitResult<T>> {
  const maxAttempts = Math.max(1, Math.min(80, Math.floor(options.maxAttempts ?? 16)));
  const intervalMs = Math.max(0, Math.min(1000, Math.floor(options.intervalMs ?? 125)));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs)));
  let lastCode: Exclude<CalendarProtocolBaseWaitResult<T>, { ok: true }>["code"] = "base-missing";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.isCancelled?.()) {
      return { ok: false, code: "request-superseded", attempts: attempt - 1 };
    }
    try {
      const candidate = await readCandidate();
      if (!candidate) {
        lastCode = "base-missing";
      } else {
        const resolved = resolveExactCalendarProtocolView(
          candidate.definition,
          requestedViewName,
        );
        if (resolved.ok && resolved.view) {
          return {
            ok: true,
            file: candidate.file,
            view: resolved.view,
            attempts: attempt,
          };
        }
        lastCode = resolved.code ?? "invalid-definition";
      }
    } catch {
      lastCode = "base-read-failed";
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  return { ok: false, code: lastCode, attempts: maxAttempts };
}

export async function waitForUniqueCalendarProtocolView<T>(
  findMatches: () => T[],
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    isCancelled?: () => boolean;
  } = {},
): Promise<CalendarProtocolWaitResult<T>> {
  const maxAttempts = Math.max(1, Math.min(200, Math.floor(options.maxAttempts ?? 80)));
  const intervalMs = Math.max(0, Math.min(1000, Math.floor(options.intervalMs ?? 125)));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs)));
  let lastMatchCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.isCancelled?.()) {
      return {
        ok: false,
        code: "request-superseded",
        attempts: attempt - 1,
      };
    }
    const matches = findMatches();
    lastMatchCount = matches.length;
    if (matches.length === 1) {
      return { ok: true, value: matches[0], attempts: attempt };
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  return {
    ok: false,
    code: lastMatchCount > 1 ? "target-ambiguous" : "target-timeout",
    attempts: maxAttempts,
  };
}

export async function waitForCalendarProtocolFocusSettlement(
  isSettled: () => boolean,
  retryFocus: () => boolean,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    retryEveryAttempts?: number;
    sleep?: (delayMs: number) => Promise<void>;
    isCancelled?: () => boolean;
  } = {},
): Promise<CalendarProtocolFocusSettlementResult> {
  const maxAttempts = Math.max(1, Math.min(100, Math.floor(options.maxAttempts ?? 20)));
  const intervalMs = Math.max(0, Math.min(1000, Math.floor(options.intervalMs ?? 75)));
  const retryEveryAttempts = Math.max(
    1,
    Math.min(20, Math.floor(options.retryEveryAttempts ?? 3)),
  );
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.isCancelled?.()) {
      return { ok: false, code: "request-superseded", attempts: attempt - 1 };
    }
    if (isSettled()) return { ok: true, attempts: attempt };
    if (attempt === maxAttempts) break;
    if (attempt % retryEveryAttempts === 0 && !retryFocus()) {
      return { ok: false, code: "target-changed", attempts: attempt };
    }
    await sleep(intervalMs);
  }

  return { ok: false, code: "focus-timeout", attempts: maxAttempts };
}
