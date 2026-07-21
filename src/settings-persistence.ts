import { DEFAULT_SETTINGS, migrateSettings } from "./settings-migration";
import type { CalendarPluginSettings } from "./types";

type SettingsKey = keyof CalendarPluginSettings;
type SettingsRecord = Record<string, unknown>;

interface SettingsSave {
    snapshot: CalendarPluginSettings;
    intentKeys: Set<SettingsKey>;
}

export interface CalendarSettingsPersistenceOptions {
    loadLatest: () => Promise<unknown>;
    saveMerged: (settings: SettingsRecord) => Promise<void>;
    getLiveSettings: () => CalendarPluginSettings;
}

const KNOWN_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

function cloneSerializable<T>(value: T): T {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
}

function settingsValueEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => settingsValueEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
            && settingsValueEqual(leftRecord[key], rightRecord[key]));
}

function changedSettingsKeys(
    baseline: CalendarPluginSettings,
    snapshot: CalendarPluginSettings,
): Set<SettingsKey> {
    return new Set(
        KNOWN_SETTINGS_KEYS.filter((key) => !settingsValueEqual(baseline[key], snapshot[key])),
    );
}

function asSettingsRecord(value: unknown): SettingsRecord {
    if (value === null || value === undefined) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Calendar settings data must be a JSON object.");
    }
    return cloneSerializable(value as SettingsRecord);
}

/**
 * Serializes settings writes while applying only this process's top-level
 * changes to the latest data on disk. Every request shares the active drain,
 * so callers do not resolve while a newer queued snapshot is still pending.
 */
export class CalendarSettingsPersistence {
    private baseline: CalendarPluginSettings;
    private active: SettingsSave | null = null;
    private pending: SettingsSave | null = null;
    private drainPromise: Promise<void> | null = null;

    constructor(private readonly options: CalendarSettingsPersistenceOptions) {
        this.baseline = cloneSerializable(DEFAULT_SETTINGS);
    }

    setBaseline(settings: CalendarPluginSettings): void {
        this.baseline = cloneSerializable(settings);
    }

    request(settings: CalendarPluginSettings): Promise<void> {
        const snapshot = cloneSerializable(settings);
        const intentKeys = changedSettingsKeys(this.baseline, snapshot);
        const previousDesired = this.pending ?? this.active;

        if (previousDesired) {
            for (const key of previousDesired.intentKeys) intentKeys.add(key);
            for (const key of changedSettingsKeys(previousDesired.snapshot, snapshot)) intentKeys.add(key);
        }

        this.pending = { snapshot, intentKeys };
        if (!this.drainPromise) this.startDrain();
        return this.drainPromise as Promise<void>;
    }

    private startDrain(): void {
        // Install ownership before drain entry. drain() clears it synchronously
        // before settlement, so a completion-window request starts a new drain.
        this.drainPromise = Promise.resolve().then(() => this.drain());
    }

    private async drain(): Promise<void> {
        try {
            while (this.pending) {
                const requested = this.pending;
                this.pending = null;
                this.active = requested;

                try {
                    const latestRaw = asSettingsRecord(await this.options.loadLatest());
                    const mergedRaw = cloneSerializable(latestRaw);
                    for (const key of requested.intentKeys) {
                        mergedRaw[key] = cloneSerializable(requested.snapshot[key]);
                    }

                    await this.options.saveMerged(mergedRaw);

                    const persisted = migrateSettings(mergedRaw);
                    this.baseline = cloneSerializable(persisted);
                    this.reconcileLiveSettings(requested.snapshot, persisted);
                } catch (error) {
                    // A newer snapshot is authoritative and gets a fresh read/merge
                    // attempt. Only surface the failure when nothing can supersede it.
                    if (!this.pending) throw error;
                } finally {
                    this.active = null;
                }
            }
        } finally {
            this.drainPromise = null;
        }
    }

    private reconcileLiveSettings(
        requested: CalendarPluginSettings,
        persisted: CalendarPluginSettings,
    ): void {
        const live = this.options.getLiveSettings();
        for (const key of KNOWN_SETTINGS_KEYS) {
            // A queued request owns this key, even when its final value happens
            // to equal the older baseline after an old-new-old edit sequence.
            if (this.pending?.intentKeys.has(key)) continue;
            // Preserve any edit made after this request captured its snapshot.
            if (!settingsValueEqual(live[key], requested[key])) continue;
            if (settingsValueEqual(live[key], persisted[key])) continue;
            (live as Record<SettingsKey, unknown>)[key] = cloneSerializable(persisted[key]);
        }
    }
}
