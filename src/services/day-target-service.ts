import { App, TFile, normalizePath } from "obsidian";
import * as logger from "../logger";

type FrontmatterMutator = (file: TFile, mutator: (frontmatter: Record<string, any>) => void) => Promise<void>;

export interface DayTargetServiceConfig {
  app: App;
  getTargetType: () => "daily-note" | "daily-canvas";
  getTitleKey: () => string;
  mutateFrontmatter: FrontmatterMutator;
}

export class DayTargetService {
  constructor(private readonly config: DayTargetServiceConfig) {}

  shouldOpenDailyCanvas(): boolean {
    return this.config.getTargetType() === "daily-canvas";
  }

  getDateLinkTargetPath(date: Date): string {
    return this.shouldOpenDailyCanvas()
      ? this.getDailyCanvasPath(date)
      : this.getDailyNotePath(date);
  }

  async getOrCreateTarget(date: Date): Promise<TFile> {
    return this.shouldOpenDailyCanvas()
      ? this.getOrCreateDailyCanvas(date)
      : this.getOrCreateDailyNote(date);
  }

  async getOrCreateDailyNote(date: Date): Promise<TFile> {
    const path = this.getDailyNotePath(date);
    let file = this.config.app.vault.getAbstractFileByPath(path);

    if (!file) {
      const folderPath = path.substring(0, path.lastIndexOf("/"));
      if (folderPath) {
        const folderFile = this.config.app.vault.getAbstractFileByPath(folderPath);
        if (!folderFile) {
          await this.config.app.vault.createFolder(folderPath);
        }
      }

      const content = await this.buildDailyNoteContent(date, path);
      file = await this.config.app.vault.create(path, content);
      if (file instanceof TFile) {
        await this.ensureDailyNoteTitle(file);
      }
    }

    if (!(file instanceof TFile)) {
      throw new Error(`Invalid daily note path: ${path}`);
    }
    return file;
  }

  private async getOrCreateDailyCanvas(date: Date): Promise<TFile> {
    const path = this.getDailyCanvasPath(date);
    let file = this.config.app.vault.getAbstractFileByPath(path);

    if (!file) {
      const folderPath = path.substring(0, path.lastIndexOf("/"));
      if (folderPath) {
        const folderFile = this.config.app.vault.getAbstractFileByPath(folderPath);
        if (!folderFile) {
          await this.config.app.vault.createFolder(folderPath);
        }
      }

      const content = this.buildDailyCanvasContent(path);
      file = await this.config.app.vault.create(path, content);
    }

    if (!(file instanceof TFile)) {
      throw new Error(`Invalid daily canvas path: ${path}`);
    }

    return file;
  }

  private getDailyNotePath(date: Date): string {
    const dailyNotesPlugin = (this.config.app as any).internalPlugins?.getPluginById("daily-notes");
    let format = "YYYY-MM-DD";
    let folder = "";

    if (dailyNotesPlugin?.instance?.options) {
      format = dailyNotesPlugin.instance.options.format || "YYYY-MM-DD";
      folder = this.normalizeDailyTargetFolder(dailyNotesPlugin.instance.options.folder);
    }

    const fileName = (window as any).moment(date).format(format);
    return folder
      ? normalizePath(`${folder}/${fileName}.md`)
      : normalizePath(`${fileName}.md`);
  }

  private getDailyCanvasPath(date: Date): string {
    const dailyCanvasPlugin = (this.config.app as any)?.plugins?.plugins?.["tps-daily-canvas"];
    const canvasSettings = dailyCanvasPlugin?.settings;

    let format = "YYYY-MM-DD";
    let folder = "";

    if (canvasSettings) {
      format = canvasSettings.dateFormat || format;
      folder = this.normalizeDailyTargetFolder(canvasSettings.folder);
    } else {
      const dailyNotesPlugin = (this.config.app as any).internalPlugins?.getPluginById("daily-notes");
      if (dailyNotesPlugin?.instance?.options) {
        format = dailyNotesPlugin.instance.options.format || format;
        folder = this.normalizeDailyTargetFolder(dailyNotesPlugin.instance.options.folder);
      }
    }

    const fileName = (window as any).moment(date).format(format);
    return folder
      ? normalizePath(`${folder}/${fileName}.canvas`)
      : normalizePath(`${fileName}.canvas`);
  }

  private normalizeDailyTargetFolder(folder: unknown): string {
    const normalized = normalizePath(String(folder || "").trim());
    if (!normalized || normalized === "/" || normalized === ".") return "";
    return normalized.replace(/^\/+|\/+$/g, "");
  }

  private buildDailyCanvasContent(path: string): string {
    const title = path.split("/").pop()?.replace(".canvas", "") || "";
    const canvas = {
      nodes: [
        {
          id: `daily-${Date.now()}`,
          type: "text",
          text: `# ${title}`,
          x: 0,
          y: 0,
          width: 520,
          height: 220,
        },
      ],
      edges: [],
    };
    return JSON.stringify(canvas, null, 2);
  }

  private async buildDailyNoteContent(date: Date, path: string): Promise<string> {
    const title = path.split("/").pop()?.replace(".md", "") || "";
    let content = `---\ntitle: ${title}\n---\n`;

    const dailyNotesPlugin = (this.config.app as any).internalPlugins?.getPluginById("daily-notes");
    if (dailyNotesPlugin?.enabled) {
      const templatePath = dailyNotesPlugin.instance?.options?.template;
      if (templatePath) {
        const normalizedPath = normalizePath(templatePath);
        const templateFile =
          (this.config.app.vault.getAbstractFileByPath(normalizedPath) ||
            (normalizedPath.toLowerCase().endsWith(".md")
              ? null
              : this.config.app.vault.getAbstractFileByPath(`${normalizedPath}.md`)));

        if (templateFile instanceof TFile) {
          try {
            content = await this.config.app.vault.read(templateFile);
            content = this.applyDailyNoteTemplateVariables(content, date, title);
          } catch (err) {
            logger.warn("Failed to read daily note template, using default:", err);
          }
        }
      }
    }

    return content;
  }

  private applyDailyNoteTemplateVariables(content: string, date: Date, title: string): string {
    const momentDate = (window as any).moment(date);

    return content
      .replace(/\{\{date:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
      .replace(/\{\{time:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
      .replace(/\{\{date\}\}/g, momentDate.format("YYYY-MM-DD"))
      .replace(/\{\{time\}\}/g, momentDate.format("HH:mm"))
      .replace(/\{\{title\}\}/g, title);
  }

  private async ensureDailyNoteTitle(file: TFile): Promise<void> {
    const title = file.basename;
    await this.config.mutateFrontmatter(file, (fm) => {
      const titleKey = this.config.getTitleKey();
      const current = fm[titleKey];
      if (this.isTemplatePlaceholderTitle(current) || !current) {
        fm[titleKey] = title;
      }
    });
  }

  private isTemplatePlaceholderTitle(value: unknown): boolean {
    if (typeof value !== "string") return true;
    const normalized = value.trim();
    if (!normalized) return true;
    return (
      normalized.includes("<%") ||
      normalized.includes("tp.file") ||
      normalized.includes("{{title}}") ||
      normalized.toLowerCase() === "daily note template"
    );
  }
}
