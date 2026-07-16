import { normalizeFilterValue, stripOuterQuotes } from "./filter-date-utils";
import { normalizeCalendarTaskTargetPath } from "./task-target-path";

export type CalendarCreationMode = "note" | "task";

export type PositiveFilterCondition = {
  property: string;
  operator: string;
  value: unknown;
};

export type CalendarTaskLineDefaults = {
  tags: string[];
  status: string | null;
  targetPath: string | null;
};

export type CalendarTaskDefaultSourceInfo = {
  sourceIndex: number;
  matched: boolean;
  conditionCount?: number;
};

export function extractCalendarCreationModeFromFilters(filters: unknown[]): CalendarCreationMode | null {
  for (const source of filters) {
    const modes = new Set<CalendarCreationMode>();
    for (const condition of collectFirstMatchPositiveFilterConditions(source)) {
      const rawProperty = String(condition.property || "").trim().toLowerCase();
      const property = rawProperty
        .replace(/^(?:note|task|file)\./i, "")
        .toLowerCase();
      if (property !== "kind" && property !== "type" && property !== "itemtype" && property !== "itemkind") continue;
      const value = normalizeFilterValue(condition.value)?.trim().toLowerCase();
      if (!value) continue;
      if (rawProperty.startsWith("task.")) {
        modes.add("task");
        continue;
      }
      if (rawProperty.startsWith("note.") || rawProperty.startsWith("file.")) {
        modes.add("note");
        continue;
      }
      if (value.startsWith("task") || value.startsWith("bullet")) {
        modes.add("task");
      } else if (value !== "all" && value !== "mixed") {
        // Bare semantic kinds (for example run, workout, food, or log) describe
        // vault records. Only structural task/bullet kinds select task-line mode.
        modes.add("note");
      }
    }
    if (modes.size === 1) return Array.from(modes)[0] ?? null;
  }
  return null;
}

export function extractCalendarTaskLineDefaultsFromFilters(
  filters: unknown[],
  options?: { onSource?: (info: CalendarTaskDefaultSourceInfo) => void },
): CalendarTaskLineDefaults {
  const tags = new Set<string>();
  let status: string | null = null;
  let targetPath: string | null = null;

  for (const [sourceIndex, source] of filters.entries()) {
    const conditions = collectFirstMatchPositiveFilterConditions(source);
    if (conditions.length === 0) {
      options?.onSource?.({ sourceIndex, matched: false });
      continue;
    }

    options?.onSource?.({ sourceIndex, matched: true, conditionCount: conditions.length });

    const sourceTags = new Set<string>();
    const sourceStatuses = new Set<string>();
    const sourceTargetPaths = new Set<string>();

    for (const condition of conditions) {
      const propertyRaw = String(condition.property || "");
      const normalizedProperty = propertyRaw.trim().toLowerCase();
      const isTaskProperty = /^task\./i.test(normalizedProperty);
      const isTaskLikeProperty = isTaskProperty && !normalizedProperty.startsWith("note.");
      const prop = normalizedProperty
        .replace(/^task\./i, "")
        .replace(/^note\./i, "")
        .replace(/^file\./i, "")
        .toLowerCase();
      const value = normalizeFilterValue(condition.value);
      if (!value) continue;
      const isImplicitTaskProperty = ["tag", "tags", "status", "checkboxstatus", "path", "filepath"].includes(prop);
      const isAllowedTaskField = isTaskLikeProperty || (isImplicitTaskProperty && !normalizedProperty.startsWith("note."));
      if ((prop === "tag" || prop === "tags") && isAllowedTaskField) {
        const tag = normalizeInlineTaskTag(value);
        if (tag) sourceTags.add(tag);
      } else if ((prop === "status" || prop === "checkboxstatus") && isAllowedTaskField) {
        sourceStatuses.add(value.trim().toLowerCase());
      } else if ((prop === "path" || prop === "filepath") && isAllowedTaskField) {
        const normalizedTargetPath = normalizeCalendarTaskTargetPath(value);
        if (normalizedTargetPath) sourceTargetPaths.add(normalizedTargetPath);
      }
    }

    if (!status && sourceStatuses.size === 1) {
      status = Array.from(sourceStatuses)[0] ?? null;
    }
    if (!targetPath && sourceTargetPaths.size === 1) {
      targetPath = Array.from(sourceTargetPaths)[0] ?? null;
    }
    if (tags.size === 0 && sourceTags.size > 0) {
      for (const value of sourceTags) {
        tags.add(value);
      }
    }
  }

  return {
    tags: Array.from(tags).filter(Boolean),
    status,
    targetPath,
  };
}

export function collectFirstMatchPositiveFilterConditions(filters: unknown): PositiveFilterCondition[] {
  const conditions: PositiveFilterCondition[] = [];
  const visited = new WeakSet<object>();
  const visit = (node: any): boolean => {
    if (!node) return false;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (!trimmed || trimmed.startsWith("!")) return false;
      const parsed = parseInlineFilterCondition(trimmed);
      if (parsed && isPositiveEqualityOp(parsed.operator)) {
        conditions.push(parsed);
        return true;
      }
      return false;
    }
    if (typeof node === "object" && "data" in node) {
      return visit((node as any).data);
    }
    if (Array.isArray(node)) {
      let found = false;
      for (const child of node) {
        found = visit(child) || found;
      }
      return found;
    }
    if (typeof node !== "object") return false;
    const record = node as Record<string, any>;
    if (!record || visited.has(record)) return false;
    visited.add(record);
    const orBranches = getFilterBranchNodes(record, "or");
    if (orBranches.length) {
      for (const child of orBranches) {
        const before = conditions.length;
        if (visit(child) || conditions.length > before) return true;
      }
      return false;
    }
    const anyBranches = getFilterBranchNodes(record, "any");
    if (anyBranches.length) {
      for (const child of anyBranches) {
        const before = conditions.length;
        if (visit(child) || conditions.length > before) return true;
      }
      return false;
    }
    if ("not" in record) return false;

    let found = false;
    for (const key of ["and", "all", "filters"]) {
      if (key in record) {
        found = visit(record[key]) || found;
      }
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) found = visit(child) || found;
    }
    const inline = record.expression ?? record.expr ?? record.query ?? record.code ?? record.source ?? record.text ?? record.raw;
    if (typeof inline === "string") {
      const parsed = parseInlineFilterCondition(inline);
      if (parsed && isPositiveEqualityOp(parsed.operator)) {
        conditions.push(parsed);
        return true;
      }
    }

    const property = normalizeConditionProperty(record);
    if (!property) return found;

    const operator = normalizeConditionOperator(record);
    if (!isPositiveEqualityOp(operator)) return found;

    let value = record.value ?? record.pattern ?? record.match ?? record.right ?? record.rhs ?? record.target ?? record.literal;
    if (value && typeof value === "object" && "value" in value) value = value.value;
    conditions.push({ property, operator, value });
    return true;
  };

  visit(filters);
  return conditions;
}

export function collectPositiveFilterConditions(filters: unknown): PositiveFilterCondition[] {
  const conditions: PositiveFilterCondition[] = [];
  const visit = (node: any) => {
    if (!node) return;
    if (typeof node === "string") {
      if (node.trim().startsWith("!")) return;
      const parsed = parseInlineFilterCondition(node.trim());
      if (parsed && isPositiveEqualityOp(parsed.operator)) conditions.push(parsed);
      return;
    }
    if (typeof node === "object" && "data" in node) {
      visit(node.data);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    if ("not" in node) return;
    for (const key of ["and", "or", "all", "any", "filters"]) {
      if (key in node) visit((node as any)[key]);
    }
    if (Array.isArray((node as any).children)) (node as any).children.forEach(visit);

    const property = normalizeConditionProperty(node);
    if (!property) return;
    const operator = normalizeConditionOperator(node);
    if (!isPositiveEqualityOp(operator)) return;
    let value =
      (node as any).value ??
      (node as any).pattern ??
      (node as any).match ??
      (node as any).right ??
      (node as any).rhs ??
      (node as any).target ??
      (node as any).literal;
    if (value && typeof value === "object" && "value" in value) value = (value as any).value;
    conditions.push({ property, operator, value });
  };
  visit(filters);
  return conditions;
}

export function parseInlineFilterCondition(expression: string): PositiveFilterCondition | null {
  const trimmed = String(expression || "").trim();
  if (!trimmed) return null;

  const negContainsMatch = trimmed.match(/^!\s*([\w.]+)\.contains\((.+)\)\s*$/i);
  if (negContainsMatch) {
    return {
      property: negContainsMatch[1],
      operator: "does not contain",
      value: stripOuterQuotes(negContainsMatch[2].trim()),
    };
  }

  const containsMatch = trimmed.match(/^([\w.]+)\.contains\((.+)\)\s*$/i);
  if (containsMatch) {
    return {
      property: containsMatch[1],
      operator: "contains",
      value: stripOuterQuotes(containsMatch[2].trim()),
    };
  }

  const comparisonMatch = trimmed.match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparisonMatch) {
    return {
      property: comparisonMatch[1],
      operator: comparisonMatch[2],
      value: stripOuterQuotes(comparisonMatch[3].trim()),
    };
  }

  const textualMatch = trimmed.match(/^([\w.]+)\s+(is|equals?)\s+(.+)$/i);
  if (textualMatch) {
    return {
      property: textualMatch[1],
      operator: textualMatch[2],
      value: stripOuterQuotes(textualMatch[3].trim()),
    };
  }

  const textualNegativeMatch = trimmed.match(/^([\w.]+)\s+(is\s+not|does\s+not\s+equal|not\s+equals?)\s+(.+)$/i);
  if (textualNegativeMatch) {
    return {
      property: textualNegativeMatch[1],
      operator: textualNegativeMatch[2],
      value: stripOuterQuotes(textualNegativeMatch[3].trim()),
    };
  }

  return null;
}

export function isPositiveEqualityOp(operator: string): boolean {
  const op = operator.toLowerCase().replace(/\s+/g, "");
  if (!op) return true;
  if (op.includes("not") || op.includes("!=") || op.includes("doesnot")) return false;
  return op.includes("is") || op.includes("equals") || op === "=" || op === "==";
}

function getFilterBranchNodes(node: Record<string, any>, key: string): unknown[] {
  if (!Object.prototype.hasOwnProperty.call(node, key)) return [];
  const branches = node[key];
  return Array.isArray(branches) ? branches : branches == null ? [] : [branches];
}

function normalizeConditionProperty(record: Record<string, any>): string {
  const rawProperty =
    record.property ??
    record.field ??
    record.key ??
    record.column ??
    record.left ??
    record.lhs ??
    record.operand ??
    null;
  if (typeof rawProperty === "string") return rawProperty.trim();
  if (!rawProperty || typeof rawProperty !== "object") return "";
  return String(
    rawProperty.property ??
    rawProperty.name ??
    rawProperty.key ??
    rawProperty.field ??
    rawProperty.id ??
    rawProperty.label ??
    rawProperty.column ??
    "",
  ).trim();
}

function normalizeConditionOperator(record: Record<string, any>): string {
  const rawOperator = record.op ?? record.operator ?? record.comparison ?? record.type ?? record.condition;
  if (typeof rawOperator === "string") return rawOperator.trim();
  if (!rawOperator || typeof rawOperator !== "object") return "";
  return String(
    rawOperator.operator ??
    rawOperator.op ??
    rawOperator.name ??
    rawOperator.id ??
    rawOperator.label ??
    rawOperator.type ??
    "",
  ).trim();
}

function normalizeInlineTaskTag(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^#+/u, "")
    .replace(/[^\p{L}\p{N}/_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
