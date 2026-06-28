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

// Mock QueryController since we can't easily instantiate the real one without internal API access.
// We extend Component because QueryController does.
class MockQueryController extends Component {
    data: any = null;
    queryResult: any = null;
    result: any = null;
    file: TFile | null = null;
    viewConfig: any = null;

    constructor(file: TFile | null, viewConfig: Record<string, unknown>) {
        super();
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
}

export class CalendarEmbedRenderChild extends MarkdownRenderChild {
    view: CalendarView | null = null;

    constructor(
        public containerEl: HTMLElement,
        public file: TFile | null,
        public plugin: Plugin & CalendarPluginBridge,
        private viewConfig: Record<string, unknown>
    ) {
        super(containerEl);
    }

    async onload() {
        super.onload();
        this.render();
    }

    async render() {
        this.containerEl.empty();
        const contentEl = this.containerEl.createDiv({ cls: "calendar-embed-view" });

        const controller = new MockQueryController(this.file, this.viewConfig) as any;
        controller.data = { data: this.createVaultEntries() };

        this.view = new CalendarView(controller, contentEl, this.plugin);
        (this.view as any).config = new InlineBaseConfig(this.withCalendarDefaults(this.viewConfig));
        if (this.view.onload) await this.view.onload();
        (this.view as any).onDataUpdated?.();
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

    onunload() {
        if (this.view) {
            this.view.onunload();
            this.view = null;
        }
        super.onunload();
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
        const component = new CalendarEmbedRenderChild(el, plugin.app.vault.getFileByPath(ctx.sourcePath), plugin, view);
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

            // If we are here, we want to replace the default embed (which is likely broken or raw text) with our view.
            // The `embed` element is the container.
            const component = new CalendarEmbedRenderChild(embed as HTMLElement, file, plugin, {});
            ctx.addChild(component);
        }
    });
};
