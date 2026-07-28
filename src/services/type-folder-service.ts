import { App, normalizePath } from "obsidian";
import { getPluginById } from "../core";

export interface TypeFolderOption {
  path: string;
  label: string;
  hasTypeTemplate: boolean;
}

const MAX_TYPE_FOLDER_OPTIONS = 500;

export class TypeFolderService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  getTypeFolderOptions(): TypeFolderOption[] {
    const templateRoot = this.getTypeTemplateRoot();
    const templateBacked = new Set<string>();
    const vaultFolders = new Set<string>();
    const templatePrefix = templateRoot ? `${templateRoot}/` : null;
    const templateRootNormalized = templateRoot ? normalizePath(templateRoot) : null;
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      if (templatePrefix) {
        const normalizedPath = normalizePath(file.path);
        if (
          normalizedPath.startsWith(templatePrefix) &&
          normalizedPath.toLowerCase().endsWith(".md")
        ) {
          const relative = normalizedPath.slice(templatePrefix.length, -3).trim();
          if (relative) {
            templateBacked.add(normalizePath(relative));
          }
        }
      }

      const parentPath = file.parent?.path;
      if (!parentPath || parentPath === "/") continue;
      const normalizedParent = normalizePath(parentPath);
      if (templateRootNormalized && normalizedParent === templateRootNormalized) continue;
      if (templatePrefix && normalizedParent.startsWith(templatePrefix)) continue;
      vaultFolders.add(normalizedParent);
    }

    const all = new Map<string, TypeFolderOption>();
    templateBacked.forEach((path) => {
      all.set(path, {
        path,
        label: path,
        hasTypeTemplate: true,
      });
    });
    vaultFolders.forEach((path) => {
      if (!all.has(path)) {
        all.set(path, {
          path,
          label: path,
          hasTypeTemplate: false,
        });
      }
    });

    return Array.from(all.values())
      .sort((a, b) => {
        if (a.hasTypeTemplate !== b.hasTypeTemplate) {
          return a.hasTypeTemplate ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, MAX_TYPE_FOLDER_OPTIONS);
  }

  private getTypeTemplateRoot(): string | null {
    const gcmPlugin = getPluginById(this.app, 'tps-global-context-menu') as any;
    const configuredRoot = gcmPlugin?.settings?.typeTemplateFolderPath;
    if (typeof configuredRoot === "string" && configuredRoot.trim()) {
      return normalizePath(configuredRoot.trim());
    }
    return "System/Templates/Types";
  }
}
