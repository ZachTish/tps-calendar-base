import { App, EventRef, TFile } from "obsidian";
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from "./tps-contracts";
import type { ExternalCalendarEvent } from "./types";

type GcmEventUnregister = () => void;

export interface GcmEventsApi {
  emitFilesUpdated?: (
    paths: unknown,
    options?: { sourcePluginId?: string },
  ) => void;
  emitCalendarSettingsChanged?: (options?: { sourcePluginId?: string }) => void;
  onFilesUpdated?: (
    callback: (paths: string[], payload?: Record<string, unknown>) => void,
  ) => GcmEventUnregister;
  onExplicitAction?: (
    callback: (paths: string[], payload?: Record<string, unknown>) => void,
  ) => GcmEventUnregister;
  onCalendarRefresh?: (
    callback: (paths: string[], payload?: Record<string, unknown>) => void,
  ) => GcmEventUnregister;
}

export interface GcmTaskCheckboxesApi {
  version: number;
  contract: "ordered-strict-v1";
  getMappings: () => readonly GcmTaskCheckboxMapping[];
  stateForStatus: (status: unknown) => unknown;
  statusForState: (state: unknown) => unknown;
}

export interface GcmTaskCheckboxMapping {
  checkboxState: string;
  statuses: readonly string[];
  toggleTargetStatus?: string;
  icon?: string;
  label?: string;
}

export const GCM_NATIVE_RECORDS_API_VERSION = 6;

export type GcmNativeRecordKind =
  | "task"
  | "calendar-event"
  | "food-entry"
  | "activity-entry"
  | "workout-session"
  | "workout-exercise"
  | "food"
  | "exercise"
  | "recipe"
  | "workout-plan"
  | "workflow"
  | "time-entry"
  | "asset";

export interface GcmNativeRecordMutationCause {
  kind: "user" | "automation";
  sourcePluginId?: string;
  surface?: string;
}

export interface GcmNativeRecordEnvelope extends Record<string, unknown> {
  tpsId: string;
  tpsSchemaVersion: number;
  // Calendar-template records keep this user-authored classification optional.
  // The verified inspection/handle kind, not this property, is structural.
  kind?: unknown;
  title: string;
  createdDate: string;
  modifiedDate: string;
}

export interface GcmNativeRecordInspection {
  id: string;
  kind: GcmNativeRecordKind;
  schemaVersion: number;
  frontmatter: GcmNativeRecordEnvelope;
  profile?: Record<string, unknown>;
}

export interface GcmNativeRecordHandle {
  file: TFile;
  path: string;
  id: string;
  kind: GcmNativeRecordKind;
  frontmatter: GcmNativeRecordEnvelope;
}

export type GcmNativeRecordReference =
  | string
  | TFile
  | { path?: string; id?: string; tpsId?: string };

export interface GcmNativeRecordsApi {
  version: typeof GCM_NATIVE_RECORDS_API_VERSION;
  capabilities?: { calendarTemplateRecords?: boolean };
  isEnabled: () => boolean;
  inspect: (frontmatter: unknown) => GcmNativeRecordInspection | null;
  resolve: (
    reference: GcmNativeRecordReference,
  ) => Promise<GcmNativeRecordHandle | null>;
  create: (
    kind: GcmNativeRecordKind,
    properties: Record<string, unknown>,
    options?: { cause?: GcmNativeRecordMutationCause },
  ) => Promise<GcmNativeRecordHandle>;
  update: (
    reference: GcmNativeRecordReference,
    updates: Record<string, unknown>,
    cause?: GcmNativeRecordMutationCause,
  ) => Promise<GcmNativeRecordHandle | null>;
}

export interface GcmApi {
  services?: {
    frontmatter?: {
      process?: (
        file: TFile,
        mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
      ) => Promise<unknown>;
    };
    status?: {
      getStatusPropertyKey?: () => unknown;
      getRelationalStatusPropertyKey?: () => unknown;
      isDoneStatus?: (status: unknown) => unknown;
    };
  };
  status?: {
    getStatusOptions?: () => unknown;
  };
  configuration?: {
    version?: number;
    isInlinePropertyAllowed?: (key: string) => boolean;
    getParentLinkPolicy?: () => unknown;
  };
  events?: GcmEventsApi;
  dailyNotes?: {
    version?: number;
    ensureForIsoDate?: (
      isoDate: string,
    ) => TFile | null | Promise<TFile | null>;
  };
  ui?: {
    version?: number;
    shouldForceBaseLinkPreview?: () => boolean;
    openEditableNotePreview?: (
      request: GcmEditableNotePreviewRequest,
    ) => boolean | Promise<boolean>;
  };
  completedCheckboxes?: {
    revealForFile?: (filePath: string, lineNumber?: number) => void;
  };
  taskCheckboxes?: GcmTaskCheckboxesApi;
  templates?: {
    version?: number;
    getMode?: () => unknown;
    matches?: (file: TFile) => unknown;
    list?: () => unknown;
    canAutomaticallyMutate?: (file: TFile) => unknown | Promise<unknown>;
    canAutomaticallyMutateSource?: (source: string) => unknown;
    canAutomaticallyMutateFrontmatter?: (frontmatter: unknown) => unknown;
    prepareInstanceSource?: (source: string) => unknown;
  };
  identity?: {
    internalIdKey?: string;
    externalIdKey?: string;
    createInternalId?: () => string;
    ensureInternalIdInFrontmatter?: (
      frontmatter: Record<string, unknown>,
    ) => string;
    buildCalendarExternalId?: (event: Partial<ExternalCalendarEvent>) => string;
    getExternalId?: (frontmatter: Record<string, unknown>) => string | null;
  };
  nativeRecords?: GcmNativeRecordsApi;
  [capability: string]: unknown;
}

export interface GcmParentLinkPolicy {
  format: "wikilink" | "markdown-title";
  tag: unknown;
  autoSelfLink: boolean;
}

export interface GcmEditableNotePreviewRequest {
  filePath: string;
  anchorEl: HTMLElement;
  sourcePluginId: "tps-calendar-base";
  focusEditor: boolean;
}

export type GcmEditableNotePreviewResult =
  | "opened"
  | "unavailable"
  | "declined"
  | "failed";

type GcmApiListener = (api: GcmApi | null, previousApi: GcmApi | null) => void;

interface GcmApiRegistryState {
  api: GcmApi | null;
  taskCheckboxesVersion: number | null;
  installed: boolean;
  installToken: symbol | null;
  listeners: Set<GcmApiListener>;
}

const GCM_PLUGIN_ID = "tps-global-context-menu";
const CALENDAR_PLUGIN_ID = "tps-calendar-base";
const GCM_CONFIGURATION_API_VERSION = 1;
const GCM_TASK_CHECKBOXES_API_VERSION = 1;
const GCM_TASK_CHECKBOXES_CONTRACT = "ordered-strict-v1";
const gcmApiRegistries = new WeakMap<App, GcmApiRegistryState>();
type GcmTaskCheckboxSnapshot = {
  api: GcmTaskCheckboxesApi;
  mappings: readonly GcmTaskCheckboxMapping[];
};
const gcmTaskCheckboxSnapshotCache = new WeakMap<
  GcmTaskCheckboxesApi,
  {
    source: readonly GcmTaskCheckboxMapping[];
    snapshot: GcmTaskCheckboxSnapshot | null;
  }
>();

function getGcmRegistryState(app: App): GcmApiRegistryState {
  let state = gcmApiRegistries.get(app);
  if (!state) {
    state = {
      api: null,
      taskCheckboxesVersion: null,
      installed: false,
      installToken: null,
      listeners: new Set<GcmApiListener>(),
    };
    gcmApiRegistries.set(app, state);
  }
  return state;
}

function notifyGcmApiListeners(
  state: GcmApiRegistryState,
  api: GcmApi | null,
  previousApi: GcmApi | null,
): void {
  if (api === previousApi) return;
  for (const listener of [...state.listeners]) {
    try {
      listener(api, previousApi);
    } catch {
      // One consumer must not prevent the registry from updating the others.
    }
  }
}

function acceptGcmApiPayload(app: App, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  if (
    record.source !== GCM_PLUGIN_ID ||
    record.sourcePluginId !== GCM_PLUGIN_ID
  )
    return;

  const state = getGcmRegistryState(app);
  let nextApi: GcmApi | null;
  if (record.available === false) {
    nextApi = null;
  } else if (
    record.available === true &&
    record.api &&
    typeof record.api === "object"
  ) {
    nextApi = record.api as GcmApi;
  } else {
    // A malformed availability event cannot replace a known-good capability.
    return;
  }
  const previousApi = state.api;
  state.api = nextApi;
  state.taskCheckboxesVersion = nextApi
    ? Number(record.taskCheckboxesVersion) || null
    : null;
  notifyGcmApiListeners(state, nextApi, previousApi);
}

/**
 * Install Calendar's single GCM capability registry. The listener is active
 * before the request is emitted, so both plugin load orders are supported.
 * Consumers read only the API object delivered through this workspace
 * handshake; this module never probes Obsidian's private plugin registry.
 */
export function installGcmApiRegistry(owner: EventOwner, app: App): void {
  const state = getGcmRegistryState(app);
  if (state.installed) return;
  const installToken = Symbol("gcm-api-registry");
  state.installed = true;
  state.installToken = installToken;

  owner.registerEvent(
    app.workspace.on(
      TPS_EVENTS.GCM_API_CHANGED as any,
      ((payload: unknown) => acceptGcmApiPayload(app, payload)) as any,
    ),
  );
  owner.register(() => {
    const current = gcmApiRegistries.get(app);
    if (!current || current.installToken !== installToken) return;
    current.api = null;
    current.taskCheckboxesVersion = null;
    current.installed = false;
    current.installToken = null;
    current.listeners.clear();
    gcmApiRegistries.delete(app);
  });

  app.workspace.trigger(TPS_EVENTS.GCM_API_REQUEST as any, {
    sourcePluginId: CALENDAR_PLUGIN_ID,
    requester: CALENDAR_PLUGIN_ID,
    timestamp: Date.now(),
  });
}

export function onGcmApiChanged(
  owner: Pick<EventOwner, "register">,
  app: App,
  listener: GcmApiListener,
): void {
  const state = getGcmRegistryState(app);
  state.listeners.add(listener);
  owner.register(() => state.listeners.delete(listener));
}

export function revealCompletedCheckboxesForFile(
  app: App,
  filePath: string,
  lineNumber?: number,
): void {
  const api = getGcmApi(app);
  if (typeof api?.completedCheckboxes?.revealForFile === "function") {
    api.completedCheckboxes.revealForFile(filePath, lineNumber);
  }
}

export function shouldForceBaseLinkPreview(app: App): boolean {
  const api = getGcmApi(app);
  return typeof api?.ui?.shouldForceBaseLinkPreview === "function"
    ? api.ui.shouldForceBaseLinkPreview() === true
    : false;
}

/**
 * Opens GCM's exact public version-1 editable-preview capability. Capability
 * discovery stays inside the workspace-handshake registry above.
 */
export async function openGcmEditableNotePreview(
  app: App,
  request: GcmEditableNotePreviewRequest,
): Promise<GcmEditableNotePreviewResult> {
  const ui = getGcmApi(app)?.ui;
  if (ui?.version !== 1 || typeof ui.openEditableNotePreview !== "function") {
    return "unavailable";
  }
  try {
    return (await ui.openEditableNotePreview(request)) === true
      ? "opened"
      : "declined";
  } catch {
    return "failed";
  }
}

export interface EventOwner {
  register(callback: () => void): void;
  registerEvent(ref: EventRef): void;
}

export function getGcmApi(app: App): GcmApi | null {
  return gcmApiRegistries.get(app)?.api ?? null;
}

/**
 * Returns only GCM's exact canonical native-record mutation boundary. Calendar
 * must fail closed rather than falling back to generic frontmatter writes when
 * this contract is unavailable, disabled, or from another API generation.
 */
export function getGcmNativeRecordsApi(app: App): GcmNativeRecordsApi | null {
  const nativeRecords = getGcmApi(app)?.nativeRecords;
  if (
    nativeRecords?.version !== GCM_NATIVE_RECORDS_API_VERSION ||
    typeof nativeRecords.isEnabled !== "function" ||
    typeof nativeRecords.inspect !== "function" ||
    typeof nativeRecords.resolve !== "function" ||
    typeof nativeRecords.create !== "function" ||
    typeof nativeRecords.update !== "function"
  )
    return null;
  try {
    return nativeRecords.isEnabled() === true ? nativeRecords : null;
  } catch {
    return null;
  }
}

/** Accept a calendar record only through GCM's verified structural contract. */
export function isGcmNativeCalendarRecord<T extends GcmNativeRecordInspection | GcmNativeRecordHandle>(
  record: T | null | undefined,
  nativeRecords: GcmNativeRecordsApi | null,
): record is T {
  if (!record || record.kind !== "calendar-event" || !nativeRecords) return false;
  const publicKind = record.frontmatter?.kind;
  if (typeof publicKind === "string" && publicKind.trim().toLowerCase() === "calendar-event") {
    return true;
  }
  // An absent/custom public kind never expands permission for task/food or
  // ordinary notes. Only the additive capability can verify Controller IDs.
  return nativeRecords.capabilities?.calendarTemplateRecords === true
    && typeof record.id === "string"
    && /^calendar:v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{27}$/u.test(record.id);
}

/** Returns null when GCM does not provide the shared template-identity contract. */
export function isGcmTemplateFile(app: App, file: TFile): boolean | null {
  const templates = getGcmApi(app)?.templates;
  if (templates?.version !== 1 || typeof templates.matches !== "function")
    return null;
  try {
    return templates.matches(file) === true;
  } catch {
    return false;
  }
}

export function listGcmTemplateFiles(app: App): TFile[] | null {
  const templates = getGcmApi(app)?.templates;
  if (templates?.version !== 1 || typeof templates.list !== "function")
    return null;
  try {
    const value = templates.list();
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is TFile => entry instanceof TFile);
  } catch {
    return [];
  }
}

/**
 * Returns null when the additive mutation guard is unavailable. A compatible
 * guard that throws or returns anything other than true fails closed.
 */
export async function canGcmAutomaticallyMutateFile(
  app: App,
  file: TFile,
): Promise<boolean | null> {
  const templates = getGcmApi(app)?.templates;
  if (
    templates?.version !== 1 ||
    typeof templates.canAutomaticallyMutate !== "function"
  )
    return null;
  try {
    return (await templates.canAutomaticallyMutate(file)) === true;
  } catch {
    return false;
  }
}

/** Current-source recheck for an atomic raw-content mutation. */
export function canGcmAutomaticallyMutateSource(
  app: App,
  source: string,
): boolean | null {
  const templates = getGcmApi(app)?.templates;
  if (
    templates?.version !== 1 ||
    typeof templates.canAutomaticallyMutateSource !== "function"
  )
    return null;
  try {
    return templates.canAutomaticallyMutateSource(source) === true;
  } catch {
    return false;
  }
}

/** Parsed-frontmatter recheck for processFrontMatter mutation callbacks. */
export function canGcmAutomaticallyMutateFrontmatter(
  app: App,
  frontmatter: unknown,
): boolean | null {
  const templates = getGcmApi(app)?.templates;
  if (
    templates?.version !== 1 ||
    typeof templates.canAutomaticallyMutateFrontmatter !== "function"
  )
    return null;
  try {
    return templates.canAutomaticallyMutateFrontmatter(frontmatter) === true;
  } catch {
    return false;
  }
}

/**
 * Prepare template-derived bytes for a new note. Undefined means the additive
 * capability is unavailable; null means the compatible provider rejected the
 * source and creation must fail closed.
 */
export function prepareGcmTemplateInstanceSource(
  app: App,
  source: string,
): string | null | undefined {
  const templates = getGcmApi(app)?.templates;
  if (
    templates?.version !== 1 ||
    typeof templates.prepareInstanceSource !== "function"
  )
    return undefined;
  try {
    const prepared = templates.prepareInstanceSource(source);
    return typeof prepared === "string" ? prepared : null;
  } catch {
    return null;
  }
}

/** Recheck and sanitize the current bytes after Templater has completed. */
export async function sanitizeGcmTemplateInstanceFile(
  app: App,
  file: TFile,
): Promise<boolean> {
  const templates = getGcmApi(app)?.templates;
  if (
    templates?.version !== 1 ||
    typeof templates.prepareInstanceSource !== "function"
  )
    return true;
  let accepted = false;
  try {
    await app.vault.process(file, (currentSource) => {
      const prepared = prepareGcmTemplateInstanceSource(app, currentSource);
      if (typeof prepared !== "string") return currentSource;
      accepted = true;
      return prepared;
    });
    return accepted;
  } catch {
    return false;
  }
}

export function getGcmStatusOptions(app: App): string[] {
  const status = getGcmApi(app)?.status;
  if (typeof status?.getStatusOptions !== "function") return [];
  try {
    const raw = status.getStatusOptions();
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => String(value ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getGcmTaskCheckboxesApi(app: App): GcmTaskCheckboxesApi | null {
  const registry = gcmApiRegistries.get(app);
  if (registry?.taskCheckboxesVersion !== GCM_TASK_CHECKBOXES_API_VERSION)
    return null;
  const taskCheckboxes = getGcmApi(app)?.taskCheckboxes;
  return taskCheckboxes?.version === GCM_TASK_CHECKBOXES_API_VERSION &&
    taskCheckboxes.contract === GCM_TASK_CHECKBOXES_CONTRACT &&
    typeof taskCheckboxes.getMappings === "function" &&
    typeof taskCheckboxes.stateForStatus === "function" &&
    typeof taskCheckboxes.statusForState === "function"
    ? taskCheckboxes
    : null;
}

export function normalizeGcmTaskCheckboxState(value: unknown): string | null {
  const source = String(value ?? "");
  const trimmed = source.trim();
  const tokenMatch = trimmed.match(/^\[([^\]\r\n])\]$/u);
  if (tokenMatch && tokenMatch[1].length === 1) {
    return `[${tokenMatch[1] === "X" ? "x" : tokenMatch[1]}]`;
  }
  if (!trimmed) return null;
  if (trimmed.length !== 1) return null;
  return `[${trimmed === "X" ? "x" : trimmed}]`;
}

function normalizeGcmTaskStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function readGcmTaskCheckboxSnapshot(app: App): GcmTaskCheckboxSnapshot | null {
  const taskCheckboxes = getGcmTaskCheckboxesApi(app);
  if (!taskCheckboxes) return null;
  try {
    const rawMappings = taskCheckboxes.getMappings();
    if (!Array.isArray(rawMappings) || rawMappings.length === 0) return null;
    const cached = gcmTaskCheckboxSnapshotCache.get(taskCheckboxes);
    if (cached?.source === rawMappings) return cached.snapshot;
    const mappings: GcmTaskCheckboxMapping[] = [];
    const seenStates = new Set<string>();
    for (const rawMapping of rawMappings) {
      if (!rawMapping || typeof rawMapping !== "object") {
        gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
          source: rawMappings,
          snapshot: null,
        });
        return null;
      }
      const candidate = rawMapping as unknown as Record<string, unknown>;
      const checkboxState = normalizeGcmTaskCheckboxState(
        candidate.checkboxState,
      );
      if (
        !checkboxState ||
        seenStates.has(checkboxState) ||
        !Array.isArray(candidate.statuses)
      ) {
        gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
          source: rawMappings,
          snapshot: null,
        });
        return null;
      }
      const statuses = candidate.statuses.map(normalizeGcmTaskStatus);
      if (
        !statuses.length ||
        statuses.some((entry) => !entry) ||
        new Set(statuses).size !== statuses.length
      ) {
        gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
          source: rawMappings,
          snapshot: null,
        });
        return null;
      }
      seenStates.add(checkboxState);
      const toggleTargetStatus = normalizeGcmTaskStatus(
        candidate.toggleTargetStatus,
      );
      const icon = String(candidate.icon ?? "").trim();
      const label = String(candidate.label ?? "").trim();
      mappings.push({
        checkboxState,
        statuses,
        ...(toggleTargetStatus ? { toggleTargetStatus } : {}),
        ...(icon ? { icon } : {}),
        ...(label ? { label } : {}),
      });
    }
    const mappedStatuses = new Set(
      mappings.flatMap((mapping) => mapping.statuses),
    );
    if (
      mappings.some(
        (mapping) =>
          mapping.toggleTargetStatus &&
          !mappedStatuses.has(mapping.toggleTargetStatus),
      )
    ) {
      gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
        source: rawMappings,
        snapshot: null,
      });
      return null;
    }
    for (const mapping of mappings) {
      if (
        normalizeGcmTaskStatus(
          taskCheckboxes.statusForState(mapping.checkboxState),
        ) !== mapping.statuses[0]
      ) {
        gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
          source: rawMappings,
          snapshot: null,
        });
        return null;
      }
    }
    const primaryStateByStatus = new Map<string, string>();
    for (const mapping of mappings) {
      for (const status of mapping.statuses) {
        if (!primaryStateByStatus.has(status))
          primaryStateByStatus.set(status, mapping.checkboxState);
      }
    }
    for (const [mappedStatus, expectedState] of primaryStateByStatus) {
      if (
        normalizeGcmTaskCheckboxState(
          taskCheckboxes.stateForStatus(mappedStatus),
        ) !== expectedState
      ) {
        gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
          source: rawMappings,
          snapshot: null,
        });
        return null;
      }
    }
    const snapshot = {
      api: taskCheckboxes,
      mappings,
    } satisfies GcmTaskCheckboxSnapshot;
    gcmTaskCheckboxSnapshotCache.set(taskCheckboxes, {
      source: rawMappings,
      snapshot,
    });
    return snapshot;
  } catch {
    return null;
  }
}

export function getGcmTaskCheckboxMappings(app: App): GcmTaskCheckboxMapping[] {
  return (readGcmTaskCheckboxSnapshot(app)?.mappings ?? []).map((mapping) => ({
    ...mapping,
    statuses: [...mapping.statuses],
  }));
}

function resolveGcmTaskCheckboxStateForStatus(
  snapshot: GcmTaskCheckboxSnapshot,
  status: unknown,
): string | null {
  const normalizedStatus = normalizeGcmTaskStatus(status);
  if (!normalizedStatus) return null;
  const expectedState = snapshot.mappings.find((mapping) =>
    mapping.statuses.includes(normalizedStatus),
  )?.checkboxState;
  if (!expectedState) return null;
  const rawState = snapshot.api.stateForStatus(normalizedStatus);
  if (!String(rawState ?? "").trim()) return null;
  const checkboxState = normalizeGcmTaskCheckboxState(rawState);
  return checkboxState === expectedState ? checkboxState : null;
}

export function getGcmTaskCheckboxStateForStatus(
  app: App,
  status: unknown,
): string | null {
  const snapshot = readGcmTaskCheckboxSnapshot(app);
  if (!snapshot) return null;
  try {
    return resolveGcmTaskCheckboxStateForStatus(snapshot, status);
  } catch {
    return null;
  }
}

export function getGcmTaskStatusForCheckboxState(
  app: App,
  state: unknown,
): string | null {
  const snapshot = readGcmTaskCheckboxSnapshot(app);
  const checkboxState = normalizeGcmTaskCheckboxState(state);
  if (!snapshot || !checkboxState) return null;
  const mapping = snapshot.mappings.find(
    (entry) => entry.checkboxState === checkboxState,
  );
  if (!mapping) return null;
  try {
    const status = normalizeGcmTaskStatus(
      snapshot.api.statusForState(checkboxState),
    );
    return status === mapping.statuses[0] ? status : null;
  } catch {
    return null;
  }
}

export function getGcmTaskCheckboxIconForState(
  app: App,
  state: unknown,
): string | null {
  const snapshot = readGcmTaskCheckboxSnapshot(app);
  const checkboxState = normalizeGcmTaskCheckboxState(state);
  if (!snapshot || !checkboxState) return null;
  return (
    snapshot.mappings.find((mapping) => mapping.checkboxState === checkboxState)
      ?.icon || null
  );
}

export function isGcmInlinePropertyAllowed(app: App, key: string): boolean {
  const configuration = getGcmApi(app)?.configuration;
  if (
    configuration?.version !== GCM_CONFIGURATION_API_VERSION ||
    typeof configuration.isInlinePropertyAllowed !== "function"
  )
    return false;
  try {
    return (
      configuration.isInlinePropertyAllowed(String(key || "").trim()) === true
    );
  } catch {
    return false;
  }
}

export function getGcmParentLinkPolicy(app: App): GcmParentLinkPolicy | null {
  const configuration = getGcmApi(app)?.configuration;
  if (
    configuration?.version !== GCM_CONFIGURATION_API_VERSION ||
    typeof configuration.getParentLinkPolicy !== "function"
  )
    return null;
  try {
    const raw = configuration.getParentLinkPolicy();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    return {
      format:
        record.format === "markdown-title" ? "markdown-title" : "wikilink",
      tag: record.tag,
      autoSelfLink: record.autoSelfLink === true,
    };
  } catch {
    return null;
  }
}

export interface GcmDailyNoteEnsureAttempt {
  available: boolean;
  file: TFile | null;
}

export async function ensureDailyNoteForIsoDate(
  app: App,
  isoDate: string,
): Promise<GcmDailyNoteEnsureAttempt> {
  const normalized = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { available: false, file: null };
  }
  const ensure = getGcmApi(app)?.dailyNotes?.ensureForIsoDate;
  if (typeof ensure !== "function") return { available: false, file: null };
  const file = await ensure(normalized);
  return {
    available: true,
    file: file instanceof TFile ? file : null,
  };
}

export function emitCalendarSettingsChanged(
  app: App,
  sourcePluginId: string,
): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.emitCalendarSettingsChanged === "function") {
    api.events.emitCalendarSettingsChanged({ sourcePluginId });
    return;
  }
  app.workspace.trigger(TPS_LEGACY_EVENTS.CALENDAR_SETTINGS_CHANGED as any);
  app.workspace.trigger(TPS_EVENTS.CALENDAR_SETTINGS_CHANGED as any, {
    sourcePluginId,
    timestamp: Date.now(),
  });
}

export function emitFilesUpdated(
  app: App,
  paths: string[],
  sourcePluginId: string,
): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.emitFilesUpdated === "function") {
    api.events.emitFilesUpdated(paths, { sourcePluginId });
    return;
  }
  app.workspace.trigger(TPS_LEGACY_EVENTS.GCM_FILES_UPDATED as any, paths);
  app.workspace.trigger(TPS_EVENTS.FILES_UPDATED as any, {
    paths,
    sourcePluginId,
    timestamp: Date.now(),
  });
}

export function buildCalendarExternalId(
  app: App,
  event: Partial<ExternalCalendarEvent>,
): string {
  const api = getGcmApi(app);
  if (typeof api?.identity?.buildCalendarExternalId === "function") {
    const externalId = api.identity.buildCalendarExternalId(event);
    if (externalId) return externalId;
  }
  const eventId = normalizeIdentityValue(event.id);
  const sourceUrl = normalizeCalendarUrl(event.sourceUrl);
  if (eventId) return `calendar:${sourceUrl}#${eventId}`;
  return normalizeIdentityValue(event.url);
}

export function ensureInternalIdInFrontmatter(
  app: App,
  frontmatter: Record<string, unknown>,
): string {
  const api = getGcmApi(app);
  if (typeof api?.identity?.ensureInternalIdInFrontmatter === "function") {
    return api.identity.ensureInternalIdInFrontmatter(frontmatter);
  }
  const existingKey =
    findKeyCaseInsensitive(frontmatter, "tpsId") ||
    findKeyCaseInsensitive(frontmatter, "subitemId");
  const existing = existingKey
    ? String(frontmatter[existingKey] ?? "").trim()
    : "";
  if (existing) return existing;
  const generated = createFallbackInternalId();
  frontmatter.tpsId = generated;
  return generated;
}

export function getExternalId(
  app: App,
  frontmatter: Record<string, unknown>,
): string | null {
  const api = getGcmApi(app);
  if (typeof api?.identity?.getExternalId === "function") {
    return api.identity.getExternalId(frontmatter);
  }
  const key = findKeyCaseInsensitive(frontmatter, "externalId");
  const value = key ? String(frontmatter[key] ?? "").trim() : "";
  return value || null;
}

export function registerFilesUpdated(
  owner: EventOwner,
  app: App,
  callback: (paths: string[]) => void,
): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onFilesUpdated === "function") {
    owner.register(api.events.onFilesUpdated((paths) => callback(paths)));
    return;
  }
  registerPathPair(
    owner,
    app,
    TPS_LEGACY_EVENTS.GCM_FILES_UPDATED,
    TPS_EVENTS.FILES_UPDATED,
    callback,
  );
}

export function registerExplicitAction(
  owner: EventOwner,
  app: App,
  callback: (paths: string[]) => void,
): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onExplicitAction === "function") {
    owner.register(api.events.onExplicitAction((paths) => callback(paths)));
    return;
  }
  registerPathPair(
    owner,
    app,
    TPS_LEGACY_EVENTS.GCM_EXPLICIT_ACTION,
    TPS_EVENTS.GCM_EXPLICIT_ACTION,
    callback,
  );
}

export function registerCalendarRefresh(
  owner: EventOwner,
  app: App,
  callback: (paths: string[]) => void,
): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onCalendarRefresh === "function") {
    owner.register(api.events.onCalendarRefresh((paths) => callback(paths)));
    return;
  }
  registerPathPair(
    owner,
    app,
    TPS_LEGACY_EVENTS.CALENDAR_EXPLICIT_REFRESH,
    TPS_EVENTS.CALENDAR_EXPLICIT_REFRESH,
    callback,
  );
}

function registerPathPair(
  owner: EventOwner,
  app: App,
  legacyEvent: string,
  namespacedEvent: string,
  callback: (paths: string[]) => void,
): void {
  owner.registerEvent(
    app.workspace.on(
      legacyEvent as any,
      ((payload: { paths?: string[] } | string[] | undefined) => {
        const paths = Array.isArray(payload) ? payload : payload?.paths;
        if (Array.isArray(paths) && paths.length) callback(paths);
      }) as any,
    ),
  );
  owner.registerEvent(
    app.workspace.on(
      namespacedEvent as any,
      ((payload: { paths?: string[] } | string[] | undefined) => {
        const paths = Array.isArray(payload) ? payload : payload?.paths;
        if (Array.isArray(paths) && paths.length) callback(paths);
      }) as any,
    ),
  );
}

function normalizeIdentityValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeCalendarUrl(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function findKeyCaseInsensitive(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const wanted = key.toLowerCase();
  return (
    Object.keys(record || {}).find(
      (candidate) => candidate.toLowerCase() === wanted,
    ) || null
  );
}

function createFallbackInternalId(): string {
  const cryptoApi = (globalThis as any).crypto;
  const raw =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `item_${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
