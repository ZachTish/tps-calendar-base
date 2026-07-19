import {
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
    TFile,
    Plugin,
    Component,
    parseYaml
} from "obsidian";
import { CalendarView } from "./calendar-view";
import { CalendarPluginBridge } from "./plugin-interface";
import * as logger from "./logger";

export interface CalendarEmbedRenderOptions {
    preserveDayCount?: boolean;
}

class CalendarEmbedRenderCanceledError extends Error {
    constructor() {
        super("Calendar embed unloaded before rendering completed.");
        this.name = "CalendarEmbedRenderCanceledError";
    }
}

// Mock QueryController since we can't easily instantiate the real one without internal API access.
// We extend Component because QueryController does.
class MockQueryController extends Component {
    app: any = null;
    workspace: any = null;
    vault: any = null;
    metadataCache: any = null;
    data: any = null;
    queryResult: any = null;
    result: any = null;
    file: TFile | null = null;
    viewConfig: any = null;

    constructor(app: any, file: TFile | null, viewConfig: Record<string, unknown>) {
        super();
        this.app = app;
        this.workspace = app?.workspace ?? null;
        this.vault = app?.vault ?? null;
        this.metadataCache = app?.metadataCache ?? null;
        this.file = file;
        this.viewConfig = viewConfig;
    }
}

class InlineBaseConfig {
    constructor(private values: Record<string, unknown>) {}
    get(key: string): any { return this.values[key]; }
    set(key: string, value: unknown): void { this.values[key] = value; }
    getAsPropertyId(key: string): any {
        const value = this.values[key];
        return typeof value === "string" && value.trim() ? value.trim() : null;
    }
    getOrder(): any[] {
        return Array.isArray(this.values.order) ? this.values.order : [];
    }
    getSort(): any[] {
        return Array.isArray(this.values.sort) ? this.values.sort : [];
    }
    getDisplayName(propertyId: string): string {
        return String(propertyId || "").replace(/^(note|file|formula)\./, "");
    }
    getEvaluatedFormula(): any {
        return null;
    }
}

export class CalendarEmbedRenderChild extends MarkdownRenderChild {
    view: CalendarView | null = null;
    private renderPromise: Promise<void> = Promise.resolve();
    private lifecycleGeneration = 0;

    constructor(
        public containerEl: HTMLElement,
        public file: TFile | null,
        public plugin: Plugin & CalendarPluginBridge,
        private viewConfig: Record<string, unknown>,
        private baseConfig: Record<string, unknown> = {},
        private options: CalendarEmbedRenderOptions = {},
    ) {
        super(containerEl);
    }

    onload(): void {
        const generation = ++this.lifecycleGeneration;
        this.renderPromise = this.render(generation);
        void this.renderPromise.catch((error) => this.handleRenderFailure(generation, error));
    }

    async mount(): Promise<this> {
        this.load();
        const generation = this.lifecycleGeneration;
        const renderPromise = this.renderPromise;
        try {
            await renderPromise;
            if (generation !== this.lifecycleGeneration) throw new CalendarEmbedRenderCanceledError();
            return this;
        } catch (error) {
            if (generation === this.lifecycleGeneration && renderPromise === this.renderPromise) {
                this.unload();
            }
            throw error;
        }
    }

    navigatePrevious(): void {
        this.view?.navigateEmbeddedCalendar(-1);
    }

    navigateToday(): void {
        this.view?.navigateEmbeddedCalendar(0);
    }

    navigateNext(): void {
        this.view?.navigateEmbeddedCalendar(1);
    }

    navigateToDate(date: Date | string | number): void {
        this.view?.jumpToDateTime(new Date(date));
    }

    scrollToNow(): void {
        this.view?.scrollToNow();
    }

    private async render(generation: number): Promise<void> {
        this.containerEl.empty();
        const contentEl = this.containerEl.createDiv({ cls: "calendar-embed-view" });

        const controller = new MockQueryController(this.plugin.app, this.file, this.viewConfig) as any;
        const queryResult = { data: this.createVaultEntries() };
        controller.data = queryResult;
        controller.queryResult = queryResult;
        controller.result = queryResult;

        const view = new CalendarView(controller, contentEl, this.plugin);
        (view as any).config = new InlineBaseConfig(this.withCalendarDefaults(this.viewConfig));
        (view as any).forceDirectEmbedRender = true;
        (view as any).preserveEmbeddedDayCount = this.options.preserveDayCount === true;
        (view as any).data = queryResult;
        (view as any).queryResult = queryResult;
        (view as any).result = queryResult;
        this.view = view;
        this.addChild(view);
        view.onDataUpdated();
        await view.updateCalendar(true);
        if (generation !== this.lifecycleGeneration || this.view !== view) {
            throw new CalendarEmbedRenderCanceledError();
        }
    }

    private handleRenderFailure(generation: number, error: unknown): void {
        if (generation !== this.lifecycleGeneration) return;
        logger.flowError("EmbedRenderer", "render-failed", error, { path: this.file?.path || "" });
        this.unload();
    }

    private withCalendarDefaults(config: Record<string, unknown>): Record<string, unknown> {
        return {
            startDate: "note.scheduled",
            endDate: "note.timeEstimate",
            titleProperty: "note.title",
            statusField: "note.status",
            allDayProperty: "note.allDay",
            showFullDay: "true",
            embeddedHeight: "520",
            filtersAll: this.baseConfig.filters,
            viewFilters: this.viewConfig.filters,
            ...config,
        };
    }

    private createVaultEntries(): any[] {
        return this.plugin.app.vault.getMarkdownFiles().map((file) => ({
            file,
            path: file.path,
            getValue: (propertyId: string) => this.getFileValue(file, propertyId),
        }));
    }

    private getFileValue(file: TFile, propertyId: string): unknown {
        const prop = String(propertyId || "").replace(/^note\./, "");
        if (prop === "file.name" || prop === "name") return file.name;
        if (prop === "file.basename" || prop === "basename") return file.basename;
        if (prop === "file.path" || prop === "path") return file.path;
        const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        if (!fm) return undefined;
        const exact = fm[prop];
        if (exact !== undefined) return exact;
        const lower = prop.toLowerCase();
        const key = Object.keys(fm).find((candidate) => candidate.toLowerCase() === lower);
        return key ? fm[key] : undefined;
    }

    onunload(): void {
        this.lifecycleGeneration += 1;
        this.view = null;
        // Disconnect the nested view so its public readiness guards suppress any
        // work that resumes after an asynchronous update crosses this teardown.
        this.containerEl.empty();
    }
}

export const EmbedRenderer = (plugin: Plugin & CalendarPluginBridge) => async (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
) => {
    const parsed = parseYaml(source || "") as any;
    const view = Array.isArray(parsed?.views)
        ? parsed.views.find((candidate: any) => String(candidate?.type || "").toLowerCase() === "calendar")
        : null;
    if (view) {
        const component = new CalendarEmbedRenderChild(el, plugin.app.vault.getFileByPath(ctx.sourcePath), plugin, view, parsed || {});
        ctx.addChild(component);
        return;
    }

    const embeds = el.querySelectorAll(".internal-embed");
    embeds.forEach(async (embed) => {
        const src = embed.getAttribute("src");
        if (!src) return;

        const linkText = src.split("#")[0]; // Handle links with anchors if any
        const file = plugin.app.metadataCache.getFirstLinkpathDest(linkText, ctx.sourcePath);

        if (file && file.extension === "base") {
            // Check if it's a calendar type (optional: check frontmatter or content)
            // For now, valid .base files are assumed to be potential targets.
            // We can check metadata cache for "type: calendar" if needed.
            const cache = plugin.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.type === "calendar" || cache?.frontmatter?.viewType === "calendar") {
                // Valid target
            } else {
                // If type is missing, maybe default? Or skip?
                // Let's assume if it is a .base file linked, the user wants to see it.
                // But "Auto Base Embed" handles generic ones.
                // We only want to intercept if we can render it better.
                // If we are not sure, we might just proceed.
                // Let's check frontmatter strictly to avoid breaking other base views.
                if (cache?.frontmatter?.type !== "calendar") return;
            }

            const raw = await plugin.app.vault.cachedRead(file);
            const parsedBase = parseYaml(raw || "") as any;
            const viewConfig = Array.isArray(parsedBase?.views)
                ? parsedBase.views.find((candidate: any) => String(candidate?.type || "").toLowerCase() === "calendar")
                : {};

            // If we are here, we want to replace the default embed (which is likely broken or raw text) with our view.
            // The `embed` element is the container.
            const component = new CalendarEmbedRenderChild(embed as HTMLElement, file, plugin, viewConfig || {}, parsedBase || {});
            ctx.addChild(component);
        }
    });
};
