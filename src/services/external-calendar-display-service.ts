import { normalizeCalendarUrl } from "../utils";
import { ExternalCalendarEvent } from "../types";

type ConfigReader = { get: (key: string) => unknown } | null | undefined;

export interface ExternalCalendarDisplaySettings {
  hiddenExternalEvents?: string[];
  hiddenExternalEventsByBase?: Record<string, string[]>;
}

export class ExternalCalendarDisplayService {
  getViewConfigKey(id: string): string {
    return `externalCalendar:${id}`;
  }

  resolveVisibleUrls(
    allUrls: string[],
    calendars: any[],
    config: ConfigReader,
  ): string[] {
    const visibilityByUrl = new Map<string, boolean>();

    for (const calendar of calendars) {
      if (!calendar?.url || !calendar.id) continue;
      if (!config) {
        visibilityByUrl.set(calendar.url, true);
        continue;
      }
      const stored = config.get(this.getViewConfigKey(calendar.id));
      const isVisible = !(stored === "false" || stored === false);
      visibilityByUrl.set(calendar.url, isVisible);
    }

    return allUrls.filter((url) => {
      if (!visibilityByUrl.has(url)) return true;
      return visibilityByUrl.get(url) !== false;
    });
  }

  getEventHideKey(event: ExternalCalendarEvent): string {
    return `${normalizeCalendarUrl(event.sourceUrl || "")}::${event.id}`;
  }

  getHiddenEventKeys(settings: ExternalCalendarDisplaySettings): Set<string> {
    return new Set([
      ...(settings.hiddenExternalEvents || []).map((entry: string) => String(entry)),
      ...Object.values(settings.hiddenExternalEventsByBase || {}).flatMap((entries: string[]) =>
        Array.isArray(entries) ? entries.map((entry: string) => String(entry)) : [],
      ),
    ]);
  }

  getHiddenEventKeysForBase(settings: ExternalCalendarDisplaySettings, basePath: string | null): Set<string> {
    return this.getHiddenEventKeys(settings);
  }

  isEventHiddenAnywhere(settings: ExternalCalendarDisplaySettings, event: ExternalCalendarEvent): boolean {
    const eventKey = this.getEventHideKey(event);
    return this.getHiddenEventKeys(settings).has(eventKey);
  }

  hideEvent(
    settings: ExternalCalendarDisplaySettings,
    event: ExternalCalendarEvent,
  ): string[] | null {
    const eventKey = this.getEventHideKey(event);
    const nextEntries = new Set(
      (settings.hiddenExternalEvents || []).map((entry: string) => String(entry)),
    );
    if (nextEntries.has(eventKey)) return null;

    nextEntries.add(eventKey);
    return Array.from(nextEntries);
  }

  hideEventForBase(
    settings: ExternalCalendarDisplaySettings,
    event: ExternalCalendarEvent,
    basePath: string,
  ): Record<string, string[]> | null {
    const nextEntries = this.hideEvent(settings, event);
    return nextEntries === null ? null : { ...(settings.hiddenExternalEventsByBase || {}), [basePath]: nextEntries };
  }

  revealEventOnAllBases(
    settings: ExternalCalendarDisplaySettings,
    event: ExternalCalendarEvent,
  ): Record<string, string[]> {
    const eventKey = this.getEventHideKey(event);
    const nextMap: Record<string, string[]> = {};
    for (const [basePath, entries] of Object.entries(settings.hiddenExternalEventsByBase || {}) as Array<[string, string[]]>) {
      const filtered = Array.isArray(entries)
        ? entries.map((entry) => String(entry)).filter((entry) => entry !== eventKey)
        : [];
      if (filtered.length > 0) {
        nextMap[basePath] = filtered;
      }
    }
    return nextMap;
  }

  revealEvent(settings: ExternalCalendarDisplaySettings, event: ExternalCalendarEvent): string[] {
    const eventKey = this.getEventHideKey(event);
    return (settings.hiddenExternalEvents || [])
      .map((entry: string) => String(entry))
      .filter((entry: string) => entry !== eventKey);
  }
}
