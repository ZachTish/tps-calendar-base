import { App } from "obsidian";
import { getPluginById } from "./core";
import { ExternalCalendarConfig } from "./types";

export interface TPSCalendarSettingsSnapshot {
  externalCalendars: ExternalCalendarConfig[];
  externalCalendarFilter: string;
}

export interface TPSControllerApi {
  getCalendarSettingsSnapshot?: () => TPSCalendarSettingsSnapshot | Promise<TPSCalendarSettingsSnapshot>;
}

export function getTPSControllerApi(app: App): TPSControllerApi | null {
  const plugin = (getPluginById(app, "tps-controller") || getPluginById(app, "TPS-Controller (Dev)")) as any;
  const api = plugin?.api || (window as any)?.TPS?.controller;
  return api && typeof api === "object" ? api as TPSControllerApi : null;
}
