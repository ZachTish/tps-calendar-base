/**
 * Pure utility functions for parsing and evaluating filter date expressions.
 * Extracted from CalendarView to keep the class lean.
 */

export function isLowerBoundOperator(operator: string): boolean {
  const op = String(operator || "").toLowerCase().replace(/\s+/g, "");
  return op.includes(">") || op.includes("after") || op.includes("greater");
}

export function isUpperBoundOperator(operator: string): boolean {
  const op = String(operator || "").toLowerCase().replace(/\s+/g, "");
  return op.includes("<") || op.includes("before") || op.includes("less");
}

export function isStrictUpperBoundOperator(operator: string): boolean {
  const op = String(operator || "").toLowerCase().replace(/\s+/g, "");
  if (!op) return false;
  if (op.includes("<=") || op.includes("onorbefore") || op.includes("lessthanorequal")) {
    return false;
  }
  return op === "<" || op.includes("before") || op.includes("lessthan") || op === "less";
}

export function isPositiveEqualityOperator(operator: string): boolean {
  const op = String(operator || "").toLowerCase().replace(/\s+/g, "");
  if (!op) return true;
  if (op.includes("not") || op.includes("!=") || op.includes("<") || op.includes(">")) {
    return false;
  }
  return op === "=" || op === "==" || op === "is" || op === "equal" || op === "equals";
}

export function parseCalendarDateInput(value: Date | string | number): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = String(value || "").trim();
  if (!normalized) return null;

  // A bare ISO date is a calendar day, not a UTC instant. JavaScript parses
  // `new Date("YYYY-MM-DD")` at UTC midnight, which displays as the prior day
  // west of UTC. Construct it in local time and reject rolled-over dates.
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    if (
      local.getFullYear() !== year
      || local.getMonth() !== month - 1
      || local.getDate() !== day
    ) {
      return null;
    }
    return local;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatLocalCalendarDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function normalizeFilterUpperBound(date: Date, operator: string): Date {
  return isStrictUpperBoundOperator(operator)
    ? new Date(date.getTime() - 1)
    : new Date(date.getTime());
}

export interface FilterDateBounds {
  start: Date | null;
  end: Date | null;
  hasDateFilter: boolean;
  isImpossible: boolean;
}

export function createEmptyFilterDateBounds(hasDateFilter = false): FilterDateBounds {
  return { start: null, end: null, hasDateFilter, isImpossible: false };
}

export function createImpossibleFilterDateBounds(): FilterDateBounds {
  return {
    start: null,
    end: null,
    hasDateFilter: true,
    isImpossible: true,
  };
}

export function intersectFilterDateBounds(bounds: FilterDateBounds[]): FilterDateBounds {
  if (bounds.some((bound) => bound.isImpossible)) {
    // Empty AND anything is still empty. Keep this state distinct from an
    // unrepresentable constraint such as NOT(date), which has no safe range
    // but can still match entries.
    return createImpossibleFilterDateBounds();
  }

  let start: Date | null = null;
  let end: Date | null = null;
  let hasDateFilter = false;

  for (const bound of bounds) {
    hasDateFilter = hasDateFilter || bound.hasDateFilter;
    if (bound.start && (!start || bound.start.getTime() > start.getTime())) {
      start = new Date(bound.start);
    }
    if (bound.end && (!end || bound.end.getTime() < end.getTime())) {
      end = new Date(bound.end);
    }
  }

  if (start && end && start.getTime() > end.getTime()) {
    // The conjunction is empty, not a valid contiguous Calendar window.
    return createImpossibleFilterDateBounds();
  }

  // An opaque AND branch may narrow the result further, but it cannot make a
  // representable bound from another conjunct less safe as an outer envelope.
  // Keep those endpoints so additive filters such as `is not empty` plus a
  // future lower bound still anchor the Calendar correctly.
  return { start, end, hasDateFilter, isImpossible: false };
}

export function unionFilterDateBounds(bounds: FilterDateBounds[]): FilterDateBounds {
  if (bounds.length === 0) {
    return createEmptyFilterDateBounds();
  }

  const possibleBounds = bounds.filter((bound) => !bound.isImpossible);
  if (possibleBounds.length === 0) {
    return createImpossibleFilterDateBounds();
  }

  if (possibleBounds.some((bound) => !bound.hasDateFilter)) {
    // A branch without a date constraint makes the OR group unrestricted in
    // the date dimension.
    return createEmptyFilterDateBounds();
  }

  if (possibleBounds.some((bound) => !bound.start && !bound.end)) {
    // An opaque/non-contiguous branch makes the union opaque as well.
    return createEmptyFilterDateBounds(true);
  }

  const hasCompleteStarts = possibleBounds.every((bound) => bound.start !== null);
  const hasCompleteEnds = possibleBounds.every((bound) => bound.end !== null);
  let start: Date | null = null;
  let end: Date | null = null;

  if (hasCompleteStarts) {
    for (const bound of possibleBounds) {
      if (bound.start && (!start || bound.start.getTime() < start.getTime())) {
        start = new Date(bound.start);
      }
    }
  }
  if (hasCompleteEnds) {
    for (const bound of possibleBounds) {
      if (bound.end && (!end || bound.end.getTime() > end.getTime())) {
        end = new Date(bound.end);
      }
    }
  }

  return { start, end, hasDateFilter: true, isImpossible: false };
}

export interface FilterDateTreeResolver<TCondition> {
  parseStringCondition: (source: string) => TCondition | null;
  extractObjectCondition: (source: Record<string, unknown>) => TCondition | null;
  resolveCondition: (condition: TCondition) => FilterDateBounds;
}

export function evaluateFilterDateBoundsTree<TCondition>(
  source: unknown,
  resolver: FilterDateTreeResolver<TCondition>,
  visited = new WeakSet<object>(),
): FilterDateBounds {
  if (source === null || source === undefined) {
    return createEmptyFilterDateBounds();
  }
  if (typeof source === "string") {
    const condition = resolver.parseStringCondition(source);
    return condition
      ? resolver.resolveCondition(condition)
      : createEmptyFilterDateBounds();
  }
  if (Array.isArray(source)) {
    return intersectFilterDateBounds(
      source.map((child) => evaluateFilterDateBoundsTree(child, resolver, visited)),
    );
  }
  if (typeof source !== "object") {
    return createEmptyFilterDateBounds();
  }

  const record = source as Record<string, unknown>;
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) {
    return createEmptyFilterDateBounds();
  }
  if (visited.has(record)) {
    return createEmptyFilterDateBounds();
  }
  visited.add(record);

  const visit = (value: unknown): FilterDateBounds =>
    evaluateFilterDateBoundsTree(value, resolver, visited);
  const toBranches = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : value == null ? [] : [value];

  if ("data" in record) {
    return visit(record.data);
  }
  if ("not" in record) {
    const child = visit(record.not);
    if (child.isImpossible) {
      return createEmptyFilterDateBounds();
    }
    return createEmptyFilterDateBounds(child.hasDateFilter);
  }

  const orBranches = [...toBranches(record.or), ...toBranches(record.any)];
  if (orBranches.length > 0) {
    return unionFilterDateBounds(orBranches.map(visit));
  }

  const andBranches = [
    ...toBranches(record.and),
    ...toBranches(record.all),
    ...toBranches(record.filters),
  ];
  if (andBranches.length > 0) {
    return intersectFilterDateBounds(andBranches.map(visit));
  }

  if (Array.isArray(record.children)) {
    const mode = String(record.type ?? record.operator ?? "").toLowerCase();
    const childBounds = record.children.map(visit);
    return mode.includes("or") || mode.includes("any")
      ? unionFilterDateBounds(childBounds)
      : intersectFilterDateBounds(childBounds);
  }

  const condition = resolver.extractObjectCondition(record);
  if (condition) {
    return resolver.resolveCondition(condition);
  }

  const inlineCandidates: unknown[] = [
    record.expression,
    record.expr,
    record.query,
    record.code,
    record.source,
    record.text,
    record.raw,
  ];
  const rawInlineValue = record.value;
  if (typeof rawInlineValue === "string") {
    inlineCandidates.push(rawInlineValue);
  } else if (rawInlineValue && typeof rawInlineValue === "object") {
    const valueRecord = rawInlineValue as Record<string, unknown>;
    inlineCandidates.push(
      valueRecord.value,
      valueRecord.text,
      valueRecord.raw,
      valueRecord.expression,
      valueRecord.expr,
      valueRecord.query,
      valueRecord.code,
      valueRecord.source,
    );
  }
  for (const inline of inlineCandidates) {
    if (typeof inline !== "string") continue;
    const parsed = resolver.parseStringCondition(inline);
    if (parsed) return resolver.resolveCondition(parsed);
  }

  // Accommodate unknown JSON wrapper keys without flattening logical groups.
  const skipKeys = new Set([
    "property", "field", "key", "column", "left", "lhs", "operand",
    "op", "operator", "comparison", "type", "condition",
    "value", "pattern", "match", "right", "rhs", "target", "literal",
    "expression", "expr", "query", "code", "source", "text", "raw",
  ]);
  const nestedValues = Object.entries(record)
    .filter(([key, value]) =>
      !skipKeys.has(key)
      && value !== null
      && value !== undefined
      && (Array.isArray(value) || typeof value === "object"))
    .map(([, value]) => value);
  if (nestedValues.length === 0) {
    return createEmptyFilterDateBounds();
  }
  if (nestedValues.length === 1) {
    return visit(nestedValues[0]);
  }

  // Multiple unknown wrapper children have ambiguous Boolean semantics. Fail
  // open instead of accidentally intersecting a runtime OR structure.
  const nestedBounds = nestedValues.map(visit);
  return createEmptyFilterDateBounds(
    nestedBounds.some((bound) => bound.hasDateFilter),
  );
}

export function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeFilterValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeFilterValue(item);
      if (normalized !== null) return normalized;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidateKeys = [
      "value", "text", "raw", "expression", "expr",
      "query", "code", "source", "literal",
    ];
    for (const key of candidateKeys) {
      if (!(key in record)) continue;
      const normalized = normalizeFilterValue(record[key]);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

export type RelativeDurationUnit = "day" | "week" | "month" | "hour" | "minute";

export interface RelativeDuration {
  amount: number;
  unit: RelativeDurationUnit;
}

export function parseRelativeDuration(expression: string): RelativeDuration | null {
  let normalized = expression.trim();
  if (!normalized) return null;

  const durationFnMatch = normalized.match(/^(duration|date)\((.+)\)$/i);
  if (durationFnMatch) {
    normalized = durationFnMatch[2].trim();
  }
  normalized = stripOuterQuotes(normalized);
  if (!normalized) return null;

  const match = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s*(day|days|d|week|weeks|w|month|months|mo|hour|hours|hr|hrs|minute|minutes|min|mins)$/i
  );
  if (!match) return null;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = match[2].toLowerCase();
  const canonicalUnit: RelativeDurationUnit =
    unit === "day" || unit === "days" || unit === "d"
      ? "day"
      : unit === "week" || unit === "weeks" || unit === "w"
        ? "week"
        : unit === "month" || unit === "months" || unit === "mo"
          ? "month"
          : unit === "hour" || unit === "hours" || unit === "hr" || unit === "hrs"
            ? "hour"
            : "minute";

  return { amount, unit: canonicalUnit };
}

function relativeDurationToElapsedMs(duration: RelativeDuration): number {
  const { amount, unit } = duration;
  const unitMs =
    unit === "day"
      ? 24 * 60 * 60 * 1000
      : unit === "week"
        ? 7 * 24 * 60 * 60 * 1000
        : unit === "month"
          ? 30 * 24 * 60 * 60 * 1000
          : unit === "hour"
            ? 60 * 60 * 1000
            : 60 * 1000;

  return amount * unitMs;
}

export function parseRelativeDurationMs(expression: string): number | null {
  const duration = parseRelativeDuration(expression);
  return duration ? relativeDurationToElapsedMs(duration) : null;
}

export function applyRelativeDuration(
  baseDate: Date,
  duration: RelativeDuration,
  direction: 1 | -1 = 1,
): Date {
  const result = new Date(baseDate);
  const signedAmount = duration.amount * direction;

  // Whole calendar units preserve the user's local wall-clock time across DST.
  // Fractional calendar units remain elapsed durations because a fraction of a
  // calendar month/day has no stable wall-calendar definition.
  if (Number.isInteger(signedAmount)) {
    if (duration.unit === "day" || duration.unit === "week") {
      const days = duration.unit === "week" ? signedAmount * 7 : signedAmount;
      result.setDate(result.getDate() + days);
      return result;
    }
    if (duration.unit === "month") {
      const originalDay = result.getDate();
      result.setDate(1);
      result.setMonth(result.getMonth() + signedAmount);
      const targetMonthLastDay = new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0,
      ).getDate();
      result.setDate(Math.min(originalDay, targetMonthLastDay));
      return result;
    }
  }

  result.setTime(
    result.getTime()
      + relativeDurationToElapsedMs({ ...duration, amount: signedAmount }),
  );
  return result;
}

export function resolveFilterDateAtom(expression: string): Date | null {
  const lowered = expression.toLowerCase();
  if (lowered === "today()") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }
  if (lowered === "now()") {
    return new Date();
  }

  const dateFnMatch = expression.match(/^date\((.+)\)$/i);
  if (dateFnMatch) {
    const inner = stripOuterQuotes(dateFnMatch[1].trim());
    if (!inner) return null;
    const relativeDuration = parseRelativeDuration(inner);
    if (relativeDuration) {
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      return applyRelativeDuration(base, relativeDuration);
    }
    const innerExpr = resolveFilterDateExpression(inner);
    if (innerExpr) {
      return innerExpr;
    }
    return parseCalendarDateInput(inner);
  }

  return parseCalendarDateInput(expression);
}

export function resolveFilterDateExpression(value: unknown): Date | null {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;

  const expression = stripOuterQuotes(normalized.trim());
  if (!expression) return null;

  const direct = resolveFilterDateAtom(expression);
  if (direct) return direct;

  const arithmetic = splitTopLevelArithmetic(expression);
  if (!arithmetic) return null;

  const { leftExpr, op, rightExpr } = arithmetic;
  const baseDate = resolveFilterDateExpression(leftExpr.trim());
  const duration = parseRelativeDuration(rightExpr.trim());
  if (!baseDate || !duration) return null;

  return applyRelativeDuration(baseDate, duration, op === "+" ? 1 : -1);
}

function splitTopLevelArithmetic(
  expression: string,
): { leftExpr: string; op: "+" | "-"; rightExpr: string } | null {
  const text = String(expression || "").trim();
  if (!text) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && (ch === "+" || ch === "-")) {
      const leftExpr = text.slice(0, i).trim();
      const rightExpr = text.slice(i + 1).trim();
      if (!leftExpr || !rightExpr) continue;
      return { leftExpr, op: ch as "+" | "-", rightExpr };
    }
  }

  return null;
}

export function getAutoRangeViewDayCount(diffDays: number): number {
  if (diffDays <= 1) return 1;
  if (diffDays <= 3) return 3;
  if (diffDays <= 4) return 4;
  if (diffDays <= 5) return 5;
  if (diffDays <= 7) return 7;
  return 30;
}

export function getInclusiveCalendarDayCount(startDate: Date, endDate: Date): number {
  const startMs = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endMs = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const diffDays = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Number.isFinite(diffDays) && diffDays > 0 ? diffDays : 1;
}
