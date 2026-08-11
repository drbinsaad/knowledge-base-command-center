export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat = { mtime: 0 };

  constructor(path: string) {
    super(path);
    const name = path.split("/").at(-1) ?? path;
    this.extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
    this.basename = this.extension ? name.slice(0, -(this.extension.length + 1)) : name;
  }
}

export class TFolder extends TAbstractFile {
  constructor(path: string, public children: TAbstractFile[] = []) { super(path); }
  isRoot(): boolean { return this.path === ""; }
}

export class Notice {
  static messages: string[] = [];
  constructor(public message: string, public duration?: number) { Notice.messages.push(message); }
}
export class NullValue {
  static value = new NullValue();
  toString(): string { return "null"; }
  isTruthy(): boolean { return false; }
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  loadedData: unknown = null;
  savedData: unknown[] = [];

  constructor(app: unknown = {}, manifest: unknown = {}) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> { return this.loadedData; }
  async saveData(value: unknown): Promise<void> { this.savedData.push(structuredClone(value)); }
  registerView(): void {}
  registerHoverLinkSource(): void {}
  addRibbonIcon(): void {}
  addCommand(): void {}
  addSettingTab(): void {}
  registerBasesView(): void {}
  registerEvent(): void {}
}

export class ItemView {
  app: unknown;
  contentEl = {};
  constructor(public leaf: unknown) { this.app = (leaf as { app?: unknown })?.app ?? {}; }
}
export class Modal {
  app: unknown;
  modalEl = {};
  contentEl = {};
  titleEl = {};
  constructor(app: unknown) { this.app = app; }
  open(): void {}
  close(): void {}
}
export class FuzzySuggestModal extends Modal {
  setPlaceholder(): void {}
  setInstructions(): void {}
}
export interface SearchResult {
  score: number;
  matches: Array<[number, number]>;
}
export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  return (text: string): SearchResult | null => {
    if (!query) return { score: 0, matches: [] };
    const matches: Array<[number, number]> = [];
    let cursor = 0;
    let first = -1;
    let previous = -1;
    let gapCost = 0;
    for (const character of query) {
      const index = text.indexOf(character, cursor);
      if (index < 0) return null;
      if (first < 0) first = index;
      if (previous >= 0) gapCost += index - previous - 1;
      matches.push([index, index + 1]);
      previous = index;
      cursor = index + 1;
    }
    return { score: -(first + gapCost), matches };
  };
}

/** Minimal test-side YAML mapping parser for the scalar lock forms exercised
 * by Quick Append. Production uses Obsidian's full parseYaml implementation. */
export function parseYaml(yaml: string): unknown {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const rawLine of yaml.split(/\r\n|\n|\r/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^("(?:\\.|[^"])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
    if (!match) continue;
    const rawKey = match[1] ?? "";
    let key = rawKey;
    if (rawKey.startsWith('"')) {
      const jsonCompatible = rawKey.replace(/\\x([0-9A-Fa-f]{2})/gu, "\\u00$1");
      key = JSON.parse(jsonCompatible) as string;
    } else if (rawKey.startsWith("'")) {
      key = rawKey.slice(1, -1).replace(/''/gu, "'");
    }
    const rawValue = (match[2] ?? "").replace(/\s+#.*$/u, "").trim();
    if (/^false$/iu.test(rawValue)) result[key] = false;
    else if (/^(?:null|~)$/iu.test(rawValue)) result[key] = null;
    else if (/^(?:true|yes|on)$/iu.test(rawValue)) result[key] = true;
    else if (/^(?:no|off)$/iu.test(rawValue)) result[key] = false;
    else if (/^".*"$/u.test(rawValue)) result[key] = JSON.parse(rawValue) as unknown;
    else result[key] = rawValue;
  }
  return result;
}
export class Menu {}
export class Setting {}
export class PluginSettingTab {
  app: unknown;
  containerEl = {};
  constructor(app: unknown, public plugin: unknown) { this.app = app; }
  update(): void {}
}
export class WorkspaceLeaf {}
export class BasesView {}
export class QueryController {}
export const Platform = { isMobile: false, isDesktopApp: true };
const ICON_IDS = [
  "library", "book-open", "book-copy", "folder", "folders", "bookmark", "archive",
  "clipboard-list", "pill", "dna", "stethoscope", "heart-pulse", "brain", "microscope",
  "flask-conical", "syringe", "activity", "graduation-cap", "file-text", "notebook-tabs",
] as const;
export function getIconIds(): string[] { return [...ICON_IDS]; }
export function setIcon(element?: { setAttribute?(name: string, value: string): void }, icon = ""): void {
  element?.setAttribute?.("data-icon", icon);
}
export class App {}
