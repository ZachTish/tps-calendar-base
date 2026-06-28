import { App, EventRef } from 'obsidian';
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
  events?: GcmEventsApi;
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
  const plugins = (app as any)?.plugins;
  const plugin = plugins?.getPlugin?.('tps-global-context-menu')
    || plugins?.plugins?.['tps-global-context-menu']
    || plugins?.getPlugin?.('TPS-Global-Context-Menu (Dev)')
    || plugins?.plugins?.['TPS-Global-Context-Menu (Dev)'];
  return plugin?.api || null;
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
