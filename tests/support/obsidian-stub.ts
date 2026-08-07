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
export function setIcon(): void {}
export class App {}
