export const TPS_FORMULA_API_VERSION = 1 as const;
export const TPS_LINE_METADATA_API_VERSION = 1 as const;

export type CalendarFormulaDefinitions = Record<string, string>;

export type CalendarFormulaResult = {
  status: "value" | "empty" | "unsupported" | "error";
  value: unknown;
  formula: string;
  code?: string;
  message?: string;
};

export type CalendarFormulaSession = {
  get: (formula: string) => CalendarFormulaResult;
  getAll?: () => Record<string, CalendarFormulaResult>;
  evaluateExpression: (expression: string, label?: string) => CalendarFormulaResult;
};

export type CalendarFormulaApi = {
  version: number;
  compile: (definitions: CalendarFormulaDefinitions, sourceId?: string) => unknown;
  createSession: (compiled: unknown, context: Record<string, unknown>) => CalendarFormulaSession;
  evaluate?: (compiled: unknown, formula: string, context: Record<string, unknown>) => CalendarFormulaResult;
  evaluateAll?: (compiled: unknown, context: Record<string, unknown>) => Record<string, CalendarFormulaResult>;
  evaluateExpression: (compiled: unknown, expression: string, context: Record<string, unknown>) => CalendarFormulaResult;
  format: (value: unknown) => string;
  comparableValues: (value: unknown) => unknown[];
  compare: (left: unknown, right: unknown) => number;
  groupValues: (value: unknown) => string[];
  hasReference: (value: unknown) => boolean;
  sortKey?: (value: unknown) => string;
  isTruthy: (value: unknown) => boolean;
};

export type CalendarFormulaApiResolution =
  | { ok: true; api: CalendarFormulaApi }
  | { ok: false; code: "formula-api-missing" | "formula-api-incompatible"; message: string };

export type CalendarLineMetadataField = {
  key: string;
  value: string;
};

export type CalendarLineMetadataApi = {
  version: number;
  readInlineFields: (line: string) => CalendarLineMetadataField[];
  readInlineFieldValue: (line: string, key: string) => string | null;
  readTags: (line: string) => string[];
  parseStringList: (value: unknown) => string[];
  parseTags: (value: unknown) => string[];
  getDisplayTitle: (line: string) => string;
  parseLine: (line: string) => {
    fields: CalendarLineMetadataField[];
    tags: string[];
    displayTitle: string;
  };
};

export type CalendarLineMetadataApiResolution =
  | { ok: true; api: CalendarLineMetadataApi }
  | { ok: false; code: "line-metadata-api-missing" | "line-metadata-api-incompatible"; message: string };

export function extractCalendarFormulaDefinitions(baseDefinition: unknown): CalendarFormulaDefinitions {
  if (!baseDefinition || typeof baseDefinition !== "object" || Array.isArray(baseDefinition)) return {};
  const raw = (baseDefinition as Record<string, unknown>).formulas;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const definitions: CalendarFormulaDefinitions = {};
  for (const [rawName, rawExpression] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(rawName || "").trim().replace(/^formula\./i, "");
    if (!name || typeof rawExpression !== "string" || !rawExpression.trim()) continue;
    definitions[name] = rawExpression.trim();
  }
  return definitions;
}

export function getCalendarFormulaName(propertyId: unknown): string | null {
  if (typeof propertyId !== "string") return null;
  const match = propertyId.trim().match(/^formula\.(.+)$/i);
  const name = match?.[1]?.trim();
  return name || null;
}

export function isCalendarFormulaProperty(propertyId: unknown): boolean {
  return getCalendarFormulaName(propertyId) !== null;
}

export function resolveCalendarFormulaApi(candidate: unknown): CalendarFormulaApiResolution {
  if (!candidate || typeof candidate !== "object") {
    return {
      ok: false,
      code: "formula-api-missing",
      message: "TPS Global Context Menu formula API is unavailable",
    };
  }

  const api = candidate as Partial<CalendarFormulaApi>;
  if (
    api.version !== TPS_FORMULA_API_VERSION
    || typeof api.compile !== "function"
    || typeof api.createSession !== "function"
    || typeof api.evaluateExpression !== "function"
    || typeof api.format !== "function"
    || typeof api.comparableValues !== "function"
    || typeof api.compare !== "function"
    || typeof api.groupValues !== "function"
    || typeof api.hasReference !== "function"
    || typeof api.isTruthy !== "function"
  ) {
    return {
      ok: false,
      code: "formula-api-incompatible",
      message: `TPS formula API version ${TPS_FORMULA_API_VERSION} is required`,
    };
  }

  return { ok: true, api: api as CalendarFormulaApi };
}

export function resolveCalendarLineMetadataApi(candidate: unknown): CalendarLineMetadataApiResolution {
  if (!candidate || typeof candidate !== "object") {
    return {
      ok: false,
      code: "line-metadata-api-missing",
      message: "TPS Global Context Menu line metadata API is unavailable",
    };
  }

  const api = candidate as Partial<CalendarLineMetadataApi>;
  if (
    api.version !== TPS_LINE_METADATA_API_VERSION
    || typeof api.readInlineFields !== "function"
    || typeof api.readInlineFieldValue !== "function"
    || typeof api.readTags !== "function"
    || typeof api.parseStringList !== "function"
    || typeof api.parseTags !== "function"
    || typeof api.getDisplayTitle !== "function"
    || typeof api.parseLine !== "function"
  ) {
    return {
      ok: false,
      code: "line-metadata-api-incompatible",
      message: `TPS line metadata API version ${TPS_LINE_METADATA_API_VERSION} is required`,
    };
  }

  return { ok: true, api: api as CalendarLineMetadataApi };
}

export function readCalendarFormulaResult(
  session: CalendarFormulaSession | null,
  propertyId: unknown,
): CalendarFormulaResult {
  const formula = getCalendarFormulaName(propertyId) || String(propertyId ?? "").trim();
  if (!session) {
    return {
      status: "unsupported",
      value: null,
      formula,
      code: "formula-session-unavailable",
      message: "No compatible TPS formula session is available for this synthetic row",
    };
  }

  try {
    const result = session.get(formula);
    if (
      result
      && ["value", "empty", "unsupported", "error"].includes(result.status)
    ) {
      return result;
    }
    return {
      status: "error",
      value: null,
      formula,
      code: "invalid-formula-result",
      message: "TPS formula API returned an invalid result",
    };
  } catch (error) {
    return {
      status: "error",
      value: null,
      formula,
      code: "formula-evaluation-threw",
      message: error instanceof Error ? error.message : String(error || "Formula evaluation failed"),
    };
  }
}
