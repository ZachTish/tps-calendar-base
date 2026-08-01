import { App, EventRef, TFile } from 'obsidian';
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from './tps-contracts';
import type { ExternalCalendarEvent } from './types';

type GcmEventUnregister = () => void;

export interface GcmEventsApi {
  emitFilesUpdated?: (paths: unknown, options?: { sourcePluginId?: string }) => void;
  emitCalendarSettingsChanged?: (options?: { sourcePluginId?: string }) => void;
  onFilesUpdated?: (callback: (paths: string[], payload?: Record<string, unknown>) => void) => GcmEventUnregister;
  onExplicitAction?: (callback: (paths: string[], payload?: Record<string, unknown>) => void) => GcmEventUnregister;
  onCalendarRefresh?: (callback: (paths: string[], payload?: Record<string, unknown>) => void) => GcmEventUnregister;
}

export interface GcmApi {
  services?: {
    frontmatter?: {
      process?: (
        file: TFile,
        mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
      ) => Promise<unknown>;
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
    ensureForIsoDate?: (isoDate: string) => TFile | null | Promise<TFile | null>;
  };
  ui?: {
    shouldForceBaseLinkPreview?: () => boolean;
  };
  completedCheckboxes?: {
    revealForFile?: (filePath: string, lineNumber?: number) => void;
  };
  identity?: {
    internalIdKey?: string;
    externalIdKey?: string;
    createInternalId?: () => string;
    ensureInternalIdInFrontmatter?: (frontmatter: Record<string, unknown>) => string;
    buildCalendarExternalId?: (event: Partial<ExternalCalendarEvent>) => string;
    getExternalId?: (frontmatter: Record<string, unknown>) => string | null;
  };
  [capability: string]: unknown;
}

export interface GcmParentLinkPolicy {
  format: 'wikilink' | 'markdown-title';
  tag: unknown;
  autoSelfLink: boolean;
}

type GcmApiListener = (api: GcmApi | null, previousApi: GcmApi | null) => void;

interface GcmApiRegistryState {
  api: GcmApi | null;
  installed: boolean;
  installToken: symbol | null;
  listeners: Set<GcmApiListener>;
}

const GCM_PLUGIN_ID = 'tps-global-context-menu';
const CALENDAR_PLUGIN_ID = 'tps-calendar-base';
const GCM_CONFIGURATION_API_VERSION = 1;
const gcmApiRegistries = new WeakMap<App, GcmApiRegistryState>();

function getGcmRegistryState(app: App): GcmApiRegistryState {
  let state = gcmApiRegistries.get(app);
  if (!state) {
    state = {
      api: null,
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
  if (!payload || typeof payload !== 'object') return;
  const record = payload as Record<string, unknown>;
  if (record.source !== GCM_PLUGIN_ID || record.sourcePluginId !== GCM_PLUGIN_ID) return;

  const state = getGcmRegistryState(app);
  let nextApi: GcmApi | null;
  if (record.available === false) {
    nextApi = null;
  } else if (record.available === true && record.api && typeof record.api === 'object') {
    nextApi = record.api as GcmApi;
  } else {
    // A malformed availability event cannot replace a known-good capability.
    return;
  }
  const previousApi = state.api;
  state.api = nextApi;
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
  const installToken = Symbol('gcm-api-registry');
  state.installed = true;
  state.installToken = installToken;

  owner.registerEvent(app.workspace.on(
    TPS_EVENTS.GCM_API_CHANGED as any,
    ((payload: unknown) => acceptGcmApiPayload(app, payload)) as any,
  ));
  owner.register(() => {
    const current = gcmApiRegistries.get(app);
    if (!current || current.installToken !== installToken) return;
    current.api = null;
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
  owner: Pick<EventOwner, 'register'>,
  app: App,
  listener: GcmApiListener,
): void {
  const state = getGcmRegistryState(app);
  state.listeners.add(listener);
  owner.register(() => state.listeners.delete(listener));
}

export function revealCompletedCheckboxesForFile(app: App, filePath: string, lineNumber?: number): void {
  const api = getGcmApi(app);
  if (typeof api?.completedCheckboxes?.revealForFile === 'function') {
    api.completedCheckboxes.revealForFile(filePath, lineNumber);
  }
}

export function shouldForceBaseLinkPreview(app: App): boolean {
  const api = getGcmApi(app);
  return typeof api?.ui?.shouldForceBaseLinkPreview === 'function'
    ? api.ui.shouldForceBaseLinkPreview() === true
    : false;
}

export interface EventOwner {
  register(callback: () => void): void;
  registerEvent(ref: EventRef): void;
}

export function getGcmApi(app: App): GcmApi | null {
  return gcmApiRegistries.get(app)?.api ?? null;
}

export function getGcmStatusOptions(app: App): string[] {
  const status = getGcmApi(app)?.status;
  if (typeof status?.getStatusOptions !== 'function') return [];
  try {
    const raw = status.getStatusOptions();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function isGcmInlinePropertyAllowed(app: App, key: string): boolean {
  const configuration = getGcmApi(app)?.configuration;
  if (
    configuration?.version !== GCM_CONFIGURATION_API_VERSION
    || typeof configuration.isInlinePropertyAllowed !== 'function'
  ) return false;
  try {
    return configuration.isInlinePropertyAllowed(String(key || '').trim()) === true;
  } catch {
    return false;
  }
}

export function getGcmParentLinkPolicy(app: App): GcmParentLinkPolicy | null {
  const configuration = getGcmApi(app)?.configuration;
  if (
    configuration?.version !== GCM_CONFIGURATION_API_VERSION
    || typeof configuration.getParentLinkPolicy !== 'function'
  ) return null;
  try {
    const raw = configuration.getParentLinkPolicy();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    return {
      format: record.format === 'markdown-title' ? 'markdown-title' : 'wikilink',
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
  const normalized = String(isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { available: false, file: null };
  }
  const ensure = getGcmApi(app)?.dailyNotes?.ensureForIsoDate;
  if (typeof ensure !== 'function') return { available: false, file: null };
  const file = await ensure(normalized);
  return {
    available: true,
    file: file instanceof TFile ? file : null,
  };
}

export function emitCalendarSettingsChanged(app: App, sourcePluginId: string): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.emitCalendarSettingsChanged === 'function') {
    api.events.emitCalendarSettingsChanged({ sourcePluginId });
    return;
  }
  app.workspace.trigger(TPS_LEGACY_EVENTS.CALENDAR_SETTINGS_CHANGED as any);
  app.workspace.trigger(TPS_EVENTS.CALENDAR_SETTINGS_CHANGED as any, {
    sourcePluginId,
    timestamp: Date.now(),
  });
}

export function emitFilesUpdated(app: App, paths: string[], sourcePluginId: string): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.emitFilesUpdated === 'function') {
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

export function buildCalendarExternalId(app: App, event: Partial<ExternalCalendarEvent>): string {
  const api = getGcmApi(app);
  if (typeof api?.identity?.buildCalendarExternalId === 'function') {
    const externalId = api.identity.buildCalendarExternalId(event);
    if (externalId) return externalId;
  }
  const eventId = normalizeIdentityValue(event.id);
  const sourceUrl = normalizeCalendarUrl(event.sourceUrl);
  if (eventId) return `calendar:${sourceUrl}#${eventId}`;
  return normalizeIdentityValue(event.url);
}

export function ensureInternalIdInFrontmatter(app: App, frontmatter: Record<string, unknown>): string {
  const api = getGcmApi(app);
  if (typeof api?.identity?.ensureInternalIdInFrontmatter === 'function') {
    return api.identity.ensureInternalIdInFrontmatter(frontmatter);
  }
  const existingKey = findKeyCaseInsensitive(frontmatter, 'tpsId') || findKeyCaseInsensitive(frontmatter, 'subitemId');
  const existing = existingKey ? String(frontmatter[existingKey] ?? '').trim() : '';
  if (existing) return existing;
  const generated = createFallbackInternalId();
  frontmatter.tpsId = generated;
  return generated;
}

export function getExternalId(app: App, frontmatter: Record<string, unknown>): string | null {
  const api = getGcmApi(app);
  if (typeof api?.identity?.getExternalId === 'function') {
    return api.identity.getExternalId(frontmatter);
  }
  const key = findKeyCaseInsensitive(frontmatter, 'externalId');
  const value = key ? String(frontmatter[key] ?? '').trim() : '';
  return value || null;
}

export function registerFilesUpdated(owner: EventOwner, app: App, callback: (paths: string[]) => void): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onFilesUpdated === 'function') {
    owner.register(api.events.onFilesUpdated((paths) => callback(paths)));
    return;
  }
  registerPathPair(owner, app, TPS_LEGACY_EVENTS.GCM_FILES_UPDATED, TPS_EVENTS.FILES_UPDATED, callback);
}

export function registerExplicitAction(owner: EventOwner, app: App, callback: (paths: string[]) => void): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onExplicitAction === 'function') {
    owner.register(api.events.onExplicitAction((paths) => callback(paths)));
    return;
  }
  registerPathPair(owner, app, TPS_LEGACY_EVENTS.GCM_EXPLICIT_ACTION, TPS_EVENTS.GCM_EXPLICIT_ACTION, callback);
}

export function registerCalendarRefresh(owner: EventOwner, app: App, callback: (paths: string[]) => void): void {
  const api = getGcmApi(app);
  if (typeof api?.events?.onCalendarRefresh === 'function') {
    owner.register(api.events.onCalendarRefresh((paths) => callback(paths)));
    return;
  }
  registerPathPair(owner, app, TPS_LEGACY_EVENTS.CALENDAR_EXPLICIT_REFRESH, TPS_EVENTS.CALENDAR_EXPLICIT_REFRESH, callback);
}

function registerPathPair(owner: EventOwner, app: App, legacyEvent: string, namespacedEvent: string, callback: (paths: string[]) => void): void {
  owner.registerEvent(app.workspace.on(legacyEvent as any, ((payload: { paths?: string[] } | string[] | undefined) => {
    const paths = Array.isArray(payload) ? payload : payload?.paths;
    if (Array.isArray(paths) && paths.length) callback(paths);
  }) as any));
  owner.registerEvent(app.workspace.on(namespacedEvent as any, ((payload: { paths?: string[] } | string[] | undefined) => {
    const paths = Array.isArray(payload) ? payload : payload?.paths;
    if (Array.isArray(paths) && paths.length) callback(paths);
  }) as any));
}

function normalizeIdentityValue(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCalendarUrl(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function findKeyCaseInsensitive(record: Record<string, unknown>, key: string): string | null {
  const wanted = key.toLowerCase();
  return Object.keys(record || {}).find((candidate) => candidate.toLowerCase() === wanted) || null;
}

function createFallbackInternalId(): string {
  const cryptoApi = (globalThis as any).crypto;
  const raw = typeof cryptoApi?.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `item_${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
