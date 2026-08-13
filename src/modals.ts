import { App, FuzzyMatch, FuzzySuggestModal, Modal, Notice, Platform, prepareFuzzySearch, Setting, TFile, TFolder, normalizePath, setIcon } from "obsidian";
import type { DropdownComponent, TextComponent, ToggleComponent } from "obsidian";
import {
  canonicalPath,
  childSubheadings,
  DOMAIN_DEFINITIONS,
  errorMessage,
  expectedParentCurriculumId,
  GenericNoteFormValue,
  genericNotePath,
  isExtensionCurriculumId,
  LayoutHeading,
  LayoutSubheading,
  NewNoteMode,
  normalizeSearchText,
  pathIsInsideFolder,
  proposalPath,
  TOPIC_KINDS,
  TopicFormValue,
  PluginSettings,
  VaultRecord,
} from "./model";

/**
 * Obsidian's picker matcher lowercases text but does not fold accents, Arabic
 * keyboard variants, or presentation forms. Use the same lookup key as the
 * command-center search so a note can be found consistently in either place.
 * Suggestions render their original text; normalized match offsets are never
 * applied to the user-visible string because decomposition can change length.
 */
abstract class NormalizedFuzzySuggestModal<T> extends FuzzySuggestModal<T> {
  getSuggestions(query: string): FuzzyMatch<T>[] {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery.trim()) {
      return this.getItems().map((item) => ({ item, match: { score: 0, matches: [] } }));
    }
    const search = prepareFuzzySearch(normalizedQuery);
    const suggestions: FuzzyMatch<T>[] = [];
    for (const item of this.getItems()) {
      const match = search(normalizeSearchText(this.getItemText(item)));
      if (match) suggestions.push({ item, match });
    }
    suggestions.sort((left, right) => right.match.score - left.match.score);
    return suggestions;
  }

  renderSuggestion(match: FuzzyMatch<T>, element: HTMLElement): void {
    element.setText(this.getItemText(match.item));
  }
}

/**
 * Local calendar day for export filenames. A UTC stamp names the file after the
 * wrong day for most of the world, so exports follow the same local convention
 * as every other date this plugin writes.
 */
export function localDateStamp(date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reportAsyncError(error: unknown): void {
  console.error("ENT Command Center action failed", error);
  new Notice(errorMessage(error));
}

/** Obsidian's DOM `Window` type omits `URL`, which the download path needs. */
export type OwnerWindow = Window & { URL: typeof URL };

/**
 * Resolve the window that owns a modal or view. A pop-out window has its own
 * timer queue and its own `URL` object store, so resolving through the element
 * is the only variant that stays correct there; `window.activeWindow` follows
 * whichever window has focus, which is not necessarily the owner.
 */
export function modalOwnerWindow(contentEl?: { ownerDocument?: Document | null } | null): OwnerWindow {
  return contentEl?.ownerDocument?.defaultView ?? (window.activeWindow as OwnerWindow | null) ?? window;
}

export interface OpenedBaseGuardHost {
  data: unknown;
  getActiveKnowledgeBaseId(): string;
  getDataEpoch?(): number;
  getExternalChangeGeneration?(): number;
}

export interface OpenedBaseGuardOptions {
  /** Shown at most once per guard, so a stale surface cannot spam notices. */
  message: string;
  /** Runs before the notice; modals use it to close themselves. */
  onStale?: () => void;
  /** Overrides the captured base id when the caller already resolved one. */
  openedBaseId?: string;
  /** Overrides the captured data epoch for surfaces that render older data. */
  openedDataEpoch?: number;
}

export interface OpenedBaseGuard {
  /** Reports ownership and, on a stale base, closes and notices exactly once. */
  (): boolean;
  /** Same comparison with no side effect, for silent focus/announce timers. */
  owns(): boolean;
}

/**
 * One stale-base guard for every surface that can outlive the data it rendered.
 *
 * Ownership is the conjunction of four facts: the live data object identity,
 * the active knowledge-base id, the data epoch, and the external-change
 * generation. Identity catches a replacement object that reused an id; the
 * generation catches a synced data.json that arrived without swapping the
 * active object. Both were previously checked in the settings tab only.
 */
export function createOpenedBaseGuard(
  host: OpenedBaseGuardHost,
  options: OpenedBaseGuardOptions,
): OpenedBaseGuard {
  const openedData = host.data;
  const openedBaseId = options.openedBaseId ?? host.getActiveKnowledgeBaseId();
  const openedDataEpoch = options.openedDataEpoch ?? host.getDataEpoch?.() ?? 0;
  const openedExternalGeneration = host.getExternalChangeGeneration?.() ?? 0;
  let noticeShown = false;
  const owns = (): boolean => host.data === openedData
    && host.getActiveKnowledgeBaseId() === openedBaseId
    && (host.getDataEpoch?.() ?? 0) === openedDataEpoch
    && (host.getExternalChangeGeneration?.() ?? 0) === openedExternalGeneration;
  const guard = (): boolean => {
    if (owns()) return true;
    options.onStale?.();
    if (!noticeShown) {
      noticeShown = true;
      new Notice(options.message, 8000);
    }
    return false;
  };
  return Object.assign(guard, { owns });
}

export interface GuardedTimerRequest {
  /** Element whose owner window schedules and clears the timer. */
  contentEl?: { ownerDocument?: Document | null } | null;
  /** Live registry so `onClose` can cancel everything still pending. */
  timers: Set<number>;
  /** Re-checked when the timer fires; a false result drops the callback. */
  proceed: () => boolean;
  action: () => void;
  delay: number;
}

/**
 * Schedule work that must not run after its surface closed or its base changed.
 * A zero-delay timer can fire before `setTimeout` returns in some environments,
 * so the id is only registered when the callback has not already consumed it.
 */
export function setGuardedTimer(request: GuardedTimerRequest): number {
  const viewWindow = modalOwnerWindow(request.contentEl);
  let timer = 0;
  let firedSynchronously = false;
  timer = viewWindow.setTimeout(() => {
    firedSynchronously = true;
    request.timers.delete(timer);
    if (!request.proceed()) return;
    request.action();
  }, request.delay);
  if (!firedSynchronously) request.timers.add(timer);
  return timer;
}

export function clearGuardedTimer(
  contentEl: { ownerDocument?: Document | null } | null | undefined,
  timers: Set<number> | undefined,
  timer: number,
): void {
  modalOwnerWindow(contentEl).clearTimeout(timer);
  timers?.delete(timer);
}

export type PortableJsonKind = "backup" | "workspace" | "portable" | "portfolio" | "conflict";

export interface JsonExportHost {
  writePortableJson(kind: PortableJsonKind, value: unknown): Promise<TFile>;
}

export type JsonExportDelivery =
  | { medium: "vault"; file: TFile }
  | { medium: "download"; filename: string };

export interface JsonExportOptions {
  /** Owner element; a pop-out window must mint and revoke its own object URL. */
  contentEl?: { ownerDocument?: Document | null } | null;
  /** Already-serialized payload, when the caller size-validated its own text. */
  serialized?: string;
  /** Date used for the local filename stamp. */
  date?: Date;
}

/**
 * The one mobile-vs-desktop JSON export branch. Mobile has no download target,
 * so the payload is written inside the vault; desktop streams a blob through a
 * detached anchor and revokes the object URL after the click was consumed.
 */
export async function deliverJsonExport(
  plugin: JsonExportHost,
  kind: PortableJsonKind,
  stem: string,
  value: unknown,
  options: JsonExportOptions = {},
): Promise<JsonExportDelivery> {
  if (Platform.isMobile) {
    return { medium: "vault", file: await plugin.writePortableJson(kind, value) };
  }
  const viewWindow = modalOwnerWindow(options.contentEl);
  const serialized = options.serialized ?? JSON.stringify(value, null, 2);
  const filename = `${stem}-${localDateStamp(options.date ?? new Date())}.json`;
  const url = viewWindow.URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const link = createEl("a");
  link.href = url;
  link.download = filename;
  link.click();
  viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
  return { medium: "download", filename };
}

export interface JsonImportHost {
  getPortableJsonFiles(): TFile[];
  readPortableJson(file: TFile): Promise<unknown>;
}

export interface JsonImportOptions {
  /** Title of the in-vault picker shown on mobile. */
  title: string;
  /** Hard cap for the desktop picker, matching the in-vault reader's cap. */
  maxBytes: number;
  /** Message thrown when the chosen file exceeds `maxBytes`. */
  oversizeMessage: string;
  /** Message shown when the vault holds no JSON at all. */
  emptyVaultMessage: string;
  onValue: (value: unknown, sourceLabel: string) => void | Promise<void>;
  /** Runs the async body; defaults to reporting a failure as a notice. */
  run?: (task: () => Promise<void>) => void;
  /** Re-checked around the read so a base change abandons the import. */
  guard?: () => boolean;
  /** In-vault reader; defaults to the plugin's size-checked reader. */
  readVaultJson?: (file: TFile) => Promise<unknown>;
}

/**
 * The one mobile-vs-desktop JSON import branch, including the size cap.
 *
 * Both media are capped: the in-vault reader checks `stat.size` and the desktop
 * picker checks `File.size` before `text()` is ever called, so a multi-gigabyte
 * pick cannot be read into memory on either platform.
 */
export function requestJsonImport(app: App, plugin: JsonImportHost, options: JsonImportOptions): void {
  const guard = options.guard ?? ((): boolean => true);
  const run = options.run ?? ((task: () => Promise<void>): void => { void task().catch(reportAsyncError); });
  const readVaultJson = options.readVaultJson ?? ((file: TFile): Promise<unknown> => plugin.readPortableJson(file));
  if (!guard()) return;
  if (Platform.isMobile) {
    const files = plugin.getPortableJsonFiles();
    if (files.length === 0) {
      new Notice(options.emptyVaultMessage);
      return;
    }
    new VaultFilePickerModal(app, files, options.title, (file) => {
      if (!guard()) return;
      run(async () => {
        const value = await readVaultJson(file);
        if (!guard()) return;
        await options.onValue(value, file.path);
      });
    }).open();
    return;
  }
  const input = createEl("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    if (!guard()) return;
    const file = input.files?.[0];
    if (!file) return;
    run(async () => {
      // Checked before text() so an oversized pick is never decoded at all.
      if (file.size > options.maxBytes) throw new Error(options.oversizeMessage);
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!guard()) return;
      await options.onValue(parsed, file.name);
    });
  });
  input.click();
}

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      placeholder: string;
      initialValue?: string;
      submitLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.options.title);
    let value = this.options.initialValue ?? "";
    let input: HTMLInputElement | null = null;
    new Setting(this.contentEl).setName(this.options.placeholder).addText((control) => {
      control.setPlaceholder(this.options.placeholder).setValue(value).onChange((next) => { value = next; });
      input = control.inputEl;
      control.inputEl.setAttribute("aria-label", this.options.placeholder);
      control.inputEl.setAttribute("dir", "auto");
      control.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit(value);
        }
      });
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel ?? "Save").setCta().onClick(() => void this.submit(value)));
    window.activeWindow.setTimeout(() => input?.focus(), 40);
  }

  private async submit(raw: string): Promise<void> {
    const value = raw.trim();
    if (!value) {
      new Notice("Enter a name first.");
      return;
    }
    try {
      await this.options.onSubmit(value);
      this.close();
    } catch (error) {
      reportAsyncError(error);
    }
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.confirmLabel).setDestructive().onClick(async () => {
        try {
          await this.onConfirm();
          this.close();
        } catch (error) {
          reportAsyncError(error);
        }
      }));
  }
}

export interface CollectionTarget {
  headingId: string;
  /**
   * Layout-global unique node id of a subheading at any depth under the
   * heading. Omitted when the target is the heading itself.
   */
  subheadingId?: string;
  label: string;
}

export function collectionTargets(collections: LayoutHeading[]): CollectionTarget[] {
  const targets: CollectionTarget[] = [];
  for (const heading of collections) {
    targets.push({ headingId: heading.id, label: heading.title });
    const visit = (node: LayoutSubheading, label: string): void => {
      targets.push({ headingId: heading.id, subheadingId: node.id, label });
      for (const child of childSubheadings(node)) visit(child, `${label} / ${child.title}`);
    };
    for (const subheading of heading.subheadings) visit(subheading, `${heading.title} / ${subheading.title}`);
  }
  return targets;
}

export class CollectionPickerModal extends NormalizedFuzzySuggestModal<CollectionTarget> {
  constructor(
    app: App,
    private readonly targets: CollectionTarget[],
    private readonly action: "Add" | "Move",
    private readonly onChoose: (target: CollectionTarget) => void | Promise<void>,
    private readonly targetLabel = "collection",
  ) {
    super(app);
    this.setPlaceholder(`${action} to ${targetLabel}…`);
  }

  getItems(): CollectionTarget[] { return this.targets; }
  getItemText(item: CollectionTarget): string { return item.label; }
  onChooseItem(item: CollectionTarget): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  onOpen(): void {
    void super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(`${this.action} to ${this.targetLabel}`);
  }
}

export interface AddAction {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export class AddActionModal extends NormalizedFuzzySuggestModal<AddAction> {
  constructor(
    app: App,
    private readonly actions: AddAction[],
    private readonly onChoose: (action: AddAction) => void,
    private readonly heading = "Add to Command Center",
  ) {
    super(app);
    this.setPlaceholder("Add or create…");
  }

  getItems(): AddAction[] { return this.actions; }
  getItemText(item: AddAction): string { return `${item.title} ${item.description}`; }
  onChooseItem(item: AddAction): void { this.onChoose(item); }

  renderSuggestion(match: FuzzyMatch<AddAction>, element: HTMLElement): void {
    const item = match.item;
    element.addClass("ent-cc-action-suggestion");
    const icon = element.createSpan({ cls: "ent-cc-action-suggestion-icon" });
    setIcon(icon, item.icon);
    const text = element.createDiv();
    text.createDiv({ cls: "ent-cc-action-suggestion-title", text: item.title, attr: { dir: "auto" } });
    text.createDiv({ cls: "ent-cc-action-suggestion-description", text: item.description, attr: { dir: "auto" } });
  }

  onOpen(): void {
    void super.onOpen();
    this.modalEl.addClass("ent-cc-modal", "ent-cc-add-modal");
    this.titleEl.setText(this.heading);
    this.titleEl.setAttribute("dir", "auto");
  }
}

export class RecordPickerModal extends NormalizedFuzzySuggestModal<VaultRecord> {
  constructor(
    app: App,
    private readonly records: VaultRecord[],
    title: string,
    placeholder: string,
    private readonly onChoose: (record: VaultRecord) => void | Promise<void>,
  ) {
    super(app);
    this.titleEl.setText(title);
    this.setPlaceholder(placeholder);
  }

  getItems(): VaultRecord[] { return this.records; }
  getItemText(item: VaultRecord): string { return `${item.title} ${item.curriculumId} ${item.path}`; }
  onChooseItem(item: VaultRecord): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  renderSuggestion(match: FuzzyMatch<VaultRecord>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.title });
    element.createDiv({ cls: "ent-cc-picker-meta", text: [item.curriculumId, item.domain, item.path].filter(Boolean).join(" · ") });
  }

  onOpen(): void {
    void super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
  }
}

export class VaultFilePickerModal extends NormalizedFuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly titleText: string,
    private readonly onChoose: (file: TFile) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Search Markdown notes by name or path…");
  }

  getItems(): TFile[] { return this.files; }
  getItemText(item: TFile): string { return `${item.basename} ${item.path}`; }
  onChooseItem(item: TFile): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  renderSuggestion(match: FuzzyMatch<TFile>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.basename });
    element.createDiv({ cls: "ent-cc-picker-meta", text: item.path });
  }

  onOpen(): void {
    void super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
  }
}

export class StringPickerModal extends NormalizedFuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly values: string[],
    private readonly titleText: string,
    placeholder: string,
    private readonly onChoose: (value: string) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): string[] { return this.values; }
  getItemText(item: string): string { return item; }
  onChooseItem(item: string): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  onOpen(): void {
    void super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
  }
}

export class IndexGroupModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      groupLabel: string;
      initialValue: string;
      existingGroups: string[];
      submitLabel: string;
      onSubmit: (group: string) => void | Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.options.title);
    let value = this.options.initialValue;
    let input: HTMLInputElement | null = null;
    const setting = new Setting(this.contentEl)
      .setName(this.options.groupLabel)
      .setDesc(`Choose an existing ${this.options.groupLabel.toLowerCase()} or type a new name. This changes only the visual index.`)
      .addText((text) => {
        text.setPlaceholder(`New ${this.options.groupLabel.toLowerCase()}`).setValue(value).onChange((next) => { value = next; });
        input = text.inputEl;
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); void this.submit(value); }
        });
      });
    setting.addButton((button) => button.setButtonText("Choose existing…").setDisabled(this.options.existingGroups.length === 0).onClick(() => {
      new StringPickerModal(this.app, this.options.existingGroups, `Choose ${this.options.groupLabel.toLowerCase()}`, `Search ${this.options.groupLabel.toLowerCase()}s…`, (group) => {
        value = group;
        if (input) input.value = group;
      }).open();
    }));
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel).setCta().onClick(() => void this.submit(value)));
    window.activeWindow.setTimeout(() => input?.focus(), 40);
  }

  private async submit(raw: string): Promise<void> {
    const group = raw.trim();
    if (!group) { new Notice(`Enter a ${this.options.groupLabel.toLowerCase()} name first.`); return; }
    try {
      await this.options.onSubmit(group);
      this.close();
    } catch (error) {
      reportAsyncError(error);
    }
  }
}

/**
 * One destination choice applied to the create-note form. The view owns what a
 * destination means; the form only re-seeds its fields from the chosen values,
 * so a destination switch behaves exactly like reopening the matching legacy
 * flow with its own prefills.
 */
export interface NoteDestinationSeed {
  /** Short human label for the Destination row, such as “Inbox” or “Reference Sets / Guidelines”. */
  label: string;
  folder: string;
  mode: NewNoteMode;
  templatePath: string;
  /** Replaces the context notice line. An empty string hides the notice. */
  contextNotice: string;
  /**
   * Hides the “Add to a collection after creation” toggle when the destination
   * itself is a collection, so one submission cannot add the note twice.
   */
  hideCollectionToggle: boolean;
}

export interface KnowledgeNoteModalOptions {
  itemSingular: string;
  /** Optional workflow-specific label, such as Medication, while still creating a Markdown note. */
  createLabel?: string;
  /** Visible workflow context that remains available in the compact mobile sheet. */
  contextNotice?: string;
  templates: TFile[];
  initial: GenericNoteFormValue;
  /**
   * Optional Destination row. `onEdit` opens the view's destination pickers on
   * top of this form (the same stacking the template picker already uses) and
   * calls `apply` with the chosen seed. `apply` is ignored once the form has
   * closed, because the picker outcome may resolve after dismissal.
   */
  destination?: {
    label: string;
    onEdit: (apply: (seed: NoteDestinationSeed) => void) => void;
  };
  validate: (value: GenericNoteFormValue) => string | null;
  onSubmit: (value: GenericNoteFormValue) => void | Promise<void>;
}

export interface ModalViewportLayout {
  height: number;
  keyboardOpen: boolean;
  shift: number;
}

export function calculateModalViewportLayout(
  innerHeight: number,
  viewportHeight: number,
  viewportOffsetTop = 0,
  keyboardHeight = 0,
): ModalViewportLayout {
  const safeInnerHeight = Number.isFinite(innerHeight) ? Math.max(1, innerHeight) : 1;
  const safeOffsetTop = Number.isFinite(viewportOffsetTop)
    ? Math.max(0, Math.min(viewportOffsetTop, safeInnerHeight - 1))
    : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(1, Math.min(viewportHeight, safeInnerHeight - safeOffsetTop))
    : safeInnerHeight - safeOffsetTop;
  const safeKeyboardHeight = Number.isFinite(keyboardHeight)
    ? Math.max(0, Math.min(keyboardHeight, safeInnerHeight - 1))
    : 0;
  const visibleBottom = Math.max(safeOffsetTop + 1, Math.min(
    safeOffsetTop + safeViewportHeight,
    safeInnerHeight - safeKeyboardHeight,
  ));
  const visibleHeight = visibleBottom - safeOffsetTop;
  return {
    height: Math.round(visibleHeight),
    keyboardOpen: safeKeyboardHeight > 100 || safeInnerHeight - safeViewportHeight > 100,
    shift: Math.round(safeOffsetTop + visibleHeight / 2 - safeInnerHeight / 2),
  };
}

export class KnowledgeNoteModal extends Modal {
  private value: GenericNoteFormValue;
  private pathEl: HTMLElement | null = null;
  private templateButton: HTMLButtonElement | null = null;
  private templateSettingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private viewportWindow: Window | null = null;
  private viewportSyncTimers: number[] = [];
  private destinationValueEl: HTMLElement | null = null;
  private contextNoticeEl: HTMLElement | null = null;
  private folderInput: TextComponent | null = null;
  private modeDropdown: DropdownComponent | null = null;
  private collectionToggle: ToggleComponent | null = null;
  private collectionToggleSettingEl: HTMLElement | null = null;
  private sessionOpen = false;

  private readonly syncViewportLayout = (): void => {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    const viewport = viewWindow.visualViewport;
    const keyboardHeight = Number.parseFloat(
      viewWindow.getComputedStyle(this.modalEl).getPropertyValue("--keyboard-height"),
    );
    const layout = calculateModalViewportLayout(
      viewWindow.innerHeight,
      viewport?.height ?? viewWindow.innerHeight,
      viewport?.offsetTop ?? 0,
      keyboardHeight,
    );
    this.modalEl.style.setProperty("--ent-cc-modal-visual-height", `${layout.height}px`);
    this.modalEl.style.setProperty("--ent-cc-modal-visual-shift", `${layout.shift}px`);
    this.modalEl.toggleClass("is-virtual-keyboard-open", layout.keyboardOpen);
  };

  private readonly handleViewportFocus = (event: FocusEvent): void => {
    this.scheduleViewportSync();
    const target = event.target as HTMLElement | null;
    const viewWindow = this.viewportWindow;
    if (!viewWindow || !target || typeof target.scrollIntoView !== "function") return;
    this.viewportSyncTimers.push(viewWindow.setTimeout(() => {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80));
  };

  constructor(app: App, private readonly options: KnowledgeNoteModalOptions) {
    super(app);
    this.value = { ...options.initial };
  }

  onOpen(): void {
    this.sessionOpen = true;
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal", "ent-cc-knowledge-note-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor", "ent-cc-knowledge-note-content");
    const createLabel = this.options.createLabel?.trim() || this.options.itemSingular;
    this.titleEl.setText(`Create ${createLabel}`);
    const formBody = this.contentEl.createDiv({ cls: "ent-cc-note-form-body" });
    formBody.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Choose a destination and start with a truly empty note or a copied Markdown template. Existing files are never overwritten.",
    });
    if (this.options.contextNotice || this.options.destination) {
      this.contextNoticeEl = formBody.createDiv({
        cls: "ent-cc-catalog-context",
        text: this.options.contextNotice ?? "",
        attr: { role: "note" },
      });
      this.contextNoticeEl.toggleClass("is-hidden", !this.options.contextNotice);
    }

    const destination = this.options.destination;
    if (destination) {
      const destinationSetting = new Setting(formBody)
        .setName("Destination")
        .addButton((button) => {
          button.setButtonText("Change…").onClick(() => destination.onEdit((seed) => this.applyDestinationSeed(seed)));
          button.buttonEl.setAttribute("aria-label", "Change destination");
        });
      destinationSetting.settingEl.addClass("ent-cc-destination-setting");
      this.destinationValueEl = destinationSetting.descEl;
      this.destinationValueEl.setText(destination.label);
    }

    new Setting(formBody)
      .setName("Title")
      .addText((text) => {
        text.setPlaceholder(`New ${createLabel.toLocaleLowerCase()}`).setValue(this.value.title).onChange((value) => {
          this.value.title = value;
          this.updatePreview();
        });
        text.inputEl.setAttribute("aria-label", `${createLabel} title`);
        text.inputEl.enterKeyHint = "done";
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          void this.submit();
        });
        window.activeWindow.setTimeout(() => text.inputEl.focus(), 40);
      });

    new Setting(formBody)
      .setName("Destination folder")
      .setDesc("Vault-relative folder. Leave empty to create at the vault root.")
      .addText((text) => {
        this.folderInput = text;
        text.setPlaceholder("Vault root").setValue(this.value.folder).onChange((value) => {
          this.value.folder = value;
          this.updatePreview();
        });
        text.inputEl.setAttribute("aria-label", "Destination folder");
      });

    new Setting(formBody)
      .setName("Starting content")
      .addDropdown((dropdown) => {
        this.modeDropdown = dropdown;
        dropdown
          .addOptions({ empty: "Empty note", template: "Copy a template" })
          .setValue(this.value.mode)
          .onChange((value) => {
          this.value.mode = value as GenericNoteFormValue["mode"];
          this.updateTemplateButton();
          this.updatePreview();
          });
        dropdown.selectEl.setAttribute("aria-label", "Starting content");
      });

    const templateSetting = new Setting(formBody)
      .setName("Template")
      .setDesc("Supports legacy {{title}}, {{date}}, and {{time}} tokens. {{yaml:id}}, {{yaml:category}}, {{yaml:parent}}, {{yaml:library}}, and {{yaml:type}} insert YAML-safe quoted scalars. Other syntax is copied unchanged.")
      .addButton((button) => {
        this.templateButton = button.buttonEl;
        button.buttonEl.setAttribute("aria-label", "Choose note template");
        button.onClick(() => {
          if (this.value.mode !== "template") return;
          if (this.options.templates.length === 0) {
            new Notice("No Markdown templates were found in the configured templates folder.");
            return;
          }
          new VaultFilePickerModal(this.app, this.options.templates, "Choose a note template", (file) => {
            this.value.templatePath = file.path;
            this.updateTemplateButton();
            this.updatePreview();
          }).open();
        });
      });
    this.templateSettingEl = templateSetting.settingEl;
    this.templateSettingEl.addClass("ent-cc-template-setting");
    this.updateTemplateButton();

    const collectionSetting = new Setting(formBody)
      .setName("Add to a collection after creation")
      .addToggle((toggle) => {
        this.collectionToggle = toggle;
        toggle.setValue(this.value.addToCollection).onChange((value) => { this.value.addToCollection = value; });
        toggle.toggleEl.setAttribute("aria-label", "Add to a collection after creation");
      });
    this.collectionToggleSettingEl = collectionSetting.settingEl;
    this.collectionToggleSettingEl.addClass("ent-cc-collection-toggle-setting");

    const preview = formBody.createDiv({ cls: "ent-cc-path-preview" });
    preview.createDiv({ cls: "ent-cc-path-preview-label", text: "New note path" });
    this.pathEl = preview.createDiv({ cls: "ent-cc-path-preview-value" });
    this.errorEl = formBody.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "polite" } });
    this.updatePreview();

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
        button.buttonEl.addClass("ent-cc-note-cancel-button");
      })
      .addButton((button) => button.setButtonText(`Create ${createLabel}`).setCta().onClick(() => void this.submit()))
      .settingEl.addClass("ent-cc-modal-footer");

    this.bindViewportLayout();
  }

  onClose(): void {
    this.sessionOpen = false;
    const viewWindow = this.viewportWindow;
    const viewport = viewWindow?.visualViewport;
    viewport?.removeEventListener("resize", this.syncViewportLayout);
    viewport?.removeEventListener("scroll", this.syncViewportLayout);
    viewWindow?.removeEventListener("resize", this.syncViewportLayout);
    this.contentEl.removeEventListener("focusin", this.handleViewportFocus);
    for (const timer of this.viewportSyncTimers) viewWindow?.clearTimeout(timer);
    this.viewportSyncTimers = [];
    this.viewportWindow = null;
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-height");
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-shift");
    this.modalEl.removeClass("is-virtual-keyboard-open");
  }

  /**
   * Re-seed the form for a newly chosen destination. Overwrites folder, mode,
   * and template with the destination's own defaults — the same values the
   * matching dedicated flow would have opened with — while the title and any
   * later manual edits stay untouched.
   */
  private applyDestinationSeed(seed: NoteDestinationSeed): void {
    if (!this.sessionOpen) return;
    this.value.folder = seed.folder;
    this.value.mode = seed.mode;
    this.value.templatePath = seed.templatePath;
    if (seed.hideCollectionToggle) {
      this.value.addToCollection = false;
      this.collectionToggle?.setValue(false);
    }
    this.destinationValueEl?.setText(seed.label);
    this.folderInput?.setValue(seed.folder);
    this.modeDropdown?.setValue(seed.mode);
    if (this.contextNoticeEl) {
      this.contextNoticeEl.setText(seed.contextNotice);
      this.contextNoticeEl.toggleClass("is-hidden", !seed.contextNotice);
    }
    this.collectionToggleSettingEl?.toggleClass("is-hidden", seed.hideCollectionToggle);
    this.updateTemplateButton();
    this.updatePreview();
  }

  private bindViewportLayout(): void {
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (!viewWindow) return;
    this.viewportWindow = viewWindow;
    viewWindow.visualViewport?.addEventListener("resize", this.syncViewportLayout);
    viewWindow.visualViewport?.addEventListener("scroll", this.syncViewportLayout);
    viewWindow.addEventListener("resize", this.syncViewportLayout);
    this.contentEl.addEventListener("focusin", this.handleViewportFocus);
    this.scheduleViewportSync();
  }

  private scheduleViewportSync(): void {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    for (const timer of this.viewportSyncTimers) viewWindow.clearTimeout(timer);
    this.viewportSyncTimers = [0, 60, 180, 420].map((delay) => viewWindow.setTimeout(this.syncViewportLayout, delay));
  }

  private updateTemplateButton(): void {
    if (!this.templateButton) return;
    const isTemplate = this.value.mode === "template";
    this.templateSettingEl?.toggleClass("is-hidden", !isTemplate);
    this.templateButton.disabled = !isTemplate;
    this.templateButton.setText(this.value.mode === "empty"
      ? "Not used for empty note"
      : this.value.templatePath.split("/").pop()?.replace(/\.md$/, "") || "Choose template…");
  }

  private updatePreview(): void {
    this.pathEl?.setText(genericNotePath(this.value.folder, this.value.title || `Untitled ${this.options.itemSingular}`));
    this.errorEl?.setText("");
  }

  private async submit(): Promise<void> {
    this.value.title = this.value.title.trim();
    this.value.folder = this.value.folder.trim().replace(/^\/+|\/+$/g, "");
    const error = this.options.validate(this.value);
    if (error) { this.errorEl?.setText(error); return; }
    try {
      await this.options.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      this.errorEl?.setText(errorMessage(error));
    }
  }
}

export interface WorkspaceSetupValue {
  workspaceName: string;
  workspaceSubtitle: string;
  indexLabel: string;
  itemSingular: string;
  itemPlural: string;
  groupLabel: string;
  primaryFolder: string;
  proposalFolder: string;
  inboxLabel: string;
  defaultNoteFolder: string;
  idProperty: string;
  groupProperty: string;
  parentProperty: string;
  templatesFolder: string;
  defaultNewNoteMode: NewNoteMode;
  defaultTemplatePath: string;
}

/**
 * An empty Inbox folder makes Inbox membership impossible: every captured note
 * would classify to no record at all. Wording mirrors the Settings tab's Inbox
 * folder validator ("Inbox" is this plugin's proper name for that tab).
 */
export const INBOX_FOLDER_REQUIRED_MESSAGE = "Choose an Inbox folder. Without one, notes aimed at the Inbox would not appear anywhere in this plugin.";

/**
 * Non-blocking hint shown while a setup-wizard folder field names a folder the
 * vault does not have yet. First-run setup must accept fresh-vault folder
 * names, so a missing folder informs instead of failing validation. The
 * consequence clause names what stays invisible for that specific field.
 */
export function missingSetupFolderHint(
  folder: string,
  consequence: string,
  folderExists: (path: string) => boolean,
): string | null {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || folderExists(clean)) return null;
  return `“${clean}” does not exist yet — it will be created empty, and ${consequence} until they live inside it.`;
}

export class WorkspaceSetupModal extends Modal {
  private value: WorkspaceSetupValue;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, initial: PluginSettings, private readonly onSubmit: (value: WorkspaceSetupValue) => void | Promise<void>) {
    super(app);
    this.value = {
      workspaceName: initial.workspaceName,
      workspaceSubtitle: initial.workspaceSubtitle,
      indexLabel: initial.indexLabel,
      itemSingular: initial.itemSingular,
      itemPlural: initial.itemPlural,
      groupLabel: initial.groupLabel,
      primaryFolder: initial.primaryFolder,
      proposalFolder: initial.proposalFolder,
      inboxLabel: initial.inboxLabel,
      defaultNoteFolder: initial.defaultNoteFolder,
      idProperty: initial.idProperty,
      groupProperty: initial.groupProperty,
      parentProperty: initial.parentProperty,
      templatesFolder: initial.templatesFolder,
      defaultNewNoteMode: initial.defaultNewNoteMode,
      defaultTemplatePath: initial.defaultTemplatePath,
    };
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor");
    this.titleEl.setText("Set up your knowledge base");
    this.contentEl.createEl("p", { cls: "ent-cc-modal-lead", text: "This configures only the plugin view. Existing notes stay exactly where they are." });
    const textField = (name: string, description: string, key: Exclude<keyof WorkspaceSetupValue, "defaultNewNoteMode">, placeholder: string): void => {
      new Setting(this.contentEl).setName(name).setDesc(description).addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(this.value[key])
        .onChange((value) => { this.value[key] = value; }));
    };
    textField("Command center name", "You can change it later in Settings.", "workspaceName", "My Knowledge Base");
    textField("Header description", "Short explanation shown below the command center name.", "workspaceSubtitle", "Search, organize, arrange, and create notes.");
    textField("Index name", "For example: Knowledge Index, Projects, Research Library.", "indexLabel", "Knowledge Index");
    textField("Item singular", "For example: note, project, paper.", "itemSingular", "note");
    textField("Item plural", "For example: notes, projects, papers.", "itemPlural", "notes");
    textField("Group name", "For example: Category, Area, Course, or Department.", "groupLabel", "Group");
    const folderExists = (path: string): boolean => this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder;
    const folderField = (
      name: string,
      description: string,
      key: "primaryFolder" | "proposalFolder",
      placeholder: string,
      consequence: string,
    ): void => {
      const row = new Setting(this.contentEl).setName(name);
      const updateHint = (value: string): void => {
        row.setDesc(missingSetupFolderHint(value, consequence, folderExists) ?? description);
      };
      row.addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(this.value[key])
        .onChange((value) => {
          this.value[key] = value;
          updateHint(value);
        }));
      updateHint(this.value[key]);
    };
    folderField("Indexed notes folder", "All Markdown notes below it appear in the index.", "primaryFolder", "Knowledge Base", "existing notes will not be indexed");
    folderField("Inbox folder", "Notes here appear in the separate Inbox section.", "proposalFolder", "Inbox", "existing notes will not appear in the Inbox");
    textField("Inbox name", "Name shown on the Inbox tab.", "inboxLabel", "Inbox");
    textField("Default new-note folder", "Initial destination when creating a note.", "defaultNoteFolder", "Knowledge Base");
    textField("ID property", "Optional property shown beside each indexed note.", "idProperty", "id");
    textField("Group property", "Falls back to the first subfolder when absent.", "groupProperty", "category");
    textField("Parent property", "Optional wikilink/title used for default nesting.", "parentProperty", "parent");
    textField("Templates folder", "Leave empty to allow any Markdown note as a template.", "templatesFolder", "Templates");

    new Setting(this.contentEl)
      .setName("Default starting content")
      .setDesc("You can override this for every note you create.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ empty: "Empty note", template: "Selected template" })
        .setValue(this.value.defaultNewNoteMode)
        .onChange((value) => { this.value.defaultNewNoteMode = value as NewNoteMode; }));

    new Setting(this.contentEl)
      .setName("Default template")
      .setDesc("Optional. Supports {{title}}, {{date}}, and {{time}}.")
      .addButton((button) => {
        const update = (): void => { button.setButtonText(this.value.defaultTemplatePath.split("/").pop()?.replace(/\.md$/, "") || "Choose template…"); };
        update();
        button.onClick(() => {
          const root = this.value.templatesFolder.trim().replace(/^\/+|\/+$/g, "");
          const templates = this.app.vault.getMarkdownFiles().filter((file) => !root || pathIsInsideFolder(file.path, root));
          if (templates.length === 0) {
            new Notice("No Markdown templates were found in that folder.");
            return;
          }
          new VaultFilePickerModal(this.app, templates, "Choose a default note template", (file) => {
            this.value.defaultTemplatePath = file.path;
            update();
          }).open();
        });
      });
    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert" } });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Finish setup").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    for (const key of ["workspaceName", "indexLabel", "itemSingular", "itemPlural", "groupLabel", "inboxLabel"] as const) {
      this.value[key] = this.value[key].trim();
      if (!this.value[key]) { this.errorEl?.setText("Name and item labels cannot be empty."); return; }
    }
    this.value.workspaceSubtitle = this.value.workspaceSubtitle.trim();
    for (const key of ["primaryFolder", "proposalFolder", "defaultNoteFolder", "templatesFolder"] as const) this.value[key] = this.value[key].trim().replace(/^\/+|\/+$/g, "");
    if (!this.value.proposalFolder) {
      this.errorEl?.setText(INBOX_FOLDER_REQUIRED_MESSAGE);
      return;
    }
    for (const key of ["idProperty", "groupProperty", "parentProperty"] as const) this.value[key] = this.value[key].trim();
    this.value.defaultTemplatePath = this.value.defaultTemplatePath.trim().replace(/^\/+/, "");
    if (this.value.defaultNewNoteMode === "template" && !this.value.defaultTemplatePath) {
      this.errorEl?.setText("Choose a default template, or use empty note as the default.");
      return;
    }
    try {
      await this.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      this.errorEl?.setText(errorMessage(error));
    }
  }
}

export type TopicEditorMode = "proposal" | "canonical" | "promote" | "placement";

export interface TopicEditorOptions {
  mode: TopicEditorMode;
  title: string;
  submitLabel: string;
  proposalFolder: string;
  canonicalRoot?: string;
  canonicalRecords: VaultRecord[];
  initial?: Partial<TopicFormValue>;
  validate: (value: TopicFormValue) => string | null;
  resolveExpectedParentPath?: (value: TopicFormValue) => string;
  previewDetails?: (value: TopicFormValue) => string[];
  onSubmit: (value: TopicFormValue) => void | Promise<void>;
}

class ParentTopicPickerModal extends NormalizedFuzzySuggestModal<VaultRecord> {
  constructor(app: App, private readonly records: VaultRecord[], private readonly onChoose: (record: VaultRecord) => void) {
    super(app);
    this.setPlaceholder("Search canonical parent topics…");
  }
  getItems(): VaultRecord[] { return this.records; }
  getItemText(item: VaultRecord): string { return `${item.title} ${item.curriculumId}`; }
  onChooseItem(item: VaultRecord): void { this.onChoose(item); }
  renderSuggestion(match: FuzzyMatch<VaultRecord>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.title });
    element.createDiv({ cls: "ent-cc-picker-meta", text: `${item.curriculumId} · ${item.domain}` });
  }
}

export class TopicEditorModal extends Modal {
  private value: TopicFormValue;
  private previewEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private parentLabelEl: HTMLElement | null = null;
  private detailsEl: HTMLElement | null = null;
  private confirmed = false;

  constructor(app: App, private readonly options: TopicEditorOptions) {
    super(app);
    this.value = {
      title: options.initial?.title ?? "",
      domain: options.initial?.domain ?? DOMAIN_DEFINITIONS[0].name,
      parentPath: options.initial?.parentPath ?? "",
      topicKind: options.initial?.topicKind ?? "condition",
      priority: options.initial?.priority ?? "P2",
      safetyCritical: options.initial?.safetyCritical ?? false,
      curriculumId: options.initial?.curriculumId ?? "",
      addToCollection: options.initial?.addToCollection ?? true,
    };
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor");
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: this.options.mode === "proposal"
        ? "Capture an unverified proposal in the Inbox. It will not enter the canonical curriculum until you promote it."
        : "This is a structural operation only. The resulting topic remains unverified and contains no clinical claims.",
    });

    new Setting(this.contentEl)
      .setName("Topic title")
      .setDesc("Used for the note title and filename.")
      .addText((text) => {
        text.setPlaceholder("Velopharyngeal insufficiency").setValue(this.value.title).onChange((value) => {
          this.value.title = value;
          this.updatePreview();
        });
        window.activeWindow.setTimeout(() => text.inputEl.focus(), 40);
      });

    new Setting(this.contentEl)
      .setName("Clinical domain")
      .setDesc("Controls the canonical domain folder when promoted.")
      .addDropdown((dropdown) => {
        for (const definition of DOMAIN_DEFINITIONS) dropdown.addOption(definition.name, definition.name);
        dropdown.setValue(this.value.domain).onChange((value) => {
          this.value.domain = value;
          this.syncExpectedParent();
          this.updatePreview();
        });
      });

    new Setting(this.contentEl)
      .setName("Parent topic")
      .setDesc("Optional canonical parent; useful for topic-family placement.")
      .addButton((button) => {
        this.parentLabelEl = button.buttonEl;
        this.updateParentLabel();
        button.onClick(() => {
          const expectedId = expectedParentCurriculumId(this.value.curriculumId);
          if (this.options.mode !== "proposal" && this.value.curriculumId && !expectedId && !isExtensionCurriculumId(this.value.curriculumId)) {
            new Notice("A root curriculum ID cannot have a parent topic.");
            return;
          }
          const expectedPath = this.options.resolveExpectedParentPath?.(this.value) ?? "";
          const candidates = expectedPath
            ? this.options.canonicalRecords.filter((record) => record.path === expectedPath)
            : this.options.canonicalRecords.filter((record) => record.domain === this.value.domain);
          new ParentTopicPickerModal(this.app, candidates, (record) => {
            this.value.parentPath = record.path;
            this.updateParentLabel();
            this.updatePreview();
          }).open();
        });
      })
      .addExtraButton((button) => button.setIcon("x").setTooltip("Clear parent").onClick(() => {
        this.value.parentPath = "";
        this.updateParentLabel();
      }));

    new Setting(this.contentEl)
      .setName("Topic kind")
      .addDropdown((dropdown) => {
        for (const kind of TOPIC_KINDS) dropdown.addOption(kind, kind.replace(/-/g, " "));
        dropdown.setValue(this.value.topicKind).onChange((value) => { this.value.topicKind = value; });
      });

    new Setting(this.contentEl)
      .setName("Priority")
      .setDesc("Study priority only; it does not indicate approval.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ P1: "P1", P2: "P2", P3: "P3" })
        .setValue(this.value.priority)
        .onChange((value) => { this.value.priority = value; }));

    new Setting(this.contentEl)
      .setName("Safety-critical")
      .setDesc("Flags the scaffold for safety-focused evidence review.")
      .addToggle((toggle) => toggle.setValue(this.value.safetyCritical).onChange((value) => { this.value.safetyCritical = value; }));

    if (this.options.mode !== "proposal") {
      new Setting(this.contentEl)
        .setName("Curriculum ID")
        .setDesc("Must match the selected domain and use the configured curriculum format.")
        .addText((text) => text.setPlaceholder("Curriculum identifier").setValue(this.value.curriculumId).onChange((value) => {
          this.value.curriculumId = value.toUpperCase();
          text.setValue(this.value.curriculumId);
          this.syncExpectedParent();
          this.updatePreview();
        }));
    }

    if (this.options.mode === "proposal" || this.options.mode === "canonical") {
      new Setting(this.contentEl)
        .setName("Add to a collection after creation")
        .setDesc("You can choose the heading or subheading after the note is created.")
        .addToggle((toggle) => toggle.setValue(this.value.addToCollection).onChange((value) => { this.value.addToCollection = value; }));
    }

    const preview = this.contentEl.createDiv({ cls: "ent-cc-path-preview" });
    preview.createDiv({ cls: "ent-cc-path-preview-label", text: this.options.mode === "proposal" ? "Inbox destination" : "Canonical destination" });
    this.previewEl = preview.createDiv({ cls: "ent-cc-path-preview-value" });
    this.detailsEl = preview.createDiv({ cls: "ent-cc-promotion-preview" });
    this.updatePreview();

    if (this.options.mode !== "proposal") {
      const warning = this.contentEl.createDiv({ cls: "ent-cc-canonical-warning" });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: this.options.mode === "placement"
        ? "Confirm the ID and final path. Existing review status is preserved; locked notes cannot be changed."
        : "Confirm this structural curriculum change. The note will remain review_status: unverified."
      });
      new Setting(this.contentEl)
        .setName("I checked the curriculum ID and destination")
        .addToggle((toggle) => toggle.setValue(false).onChange((value) => { this.confirmed = value; }));
    }

    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "polite" } });
    const footer = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel).setCta().onClick(() => void this.submit()));
    footer.settingEl.addClass("ent-cc-modal-footer");
  }

  private updateParentLabel(): void {
    if (!this.parentLabelEl) return;
    const parent = this.options.canonicalRecords.find((record) => record.path === this.value.parentPath);
    this.parentLabelEl.setText(parent ? `${parent.curriculumId} · ${parent.title}` : "Choose parent…");
  }

  private updatePreview(): void {
    if (!this.previewEl) return;
    const path = this.options.mode === "proposal"
      ? proposalPath(this.options.proposalFolder, this.value.title || "Untitled proposal")
      : canonicalPath(this.value, this.options.canonicalRoot) || "Choose a valid domain, ID, and title";
    this.previewEl.setText(path);
    this.detailsEl?.empty();
    for (const detail of this.options.previewDetails?.({ ...this.value }) ?? []) {
      const row = this.detailsEl?.createDiv({ cls: "ent-cc-promotion-preview-row" });
      if (row) {
        setIcon(row.createSpan(), "check-circle-2");
        row.createSpan({ text: detail });
      }
    }
  }

  private syncExpectedParent(): void {
    if (this.options.mode === "proposal") return;
    const expectedId = expectedParentCurriculumId(this.value.curriculumId);
    const expectedPath = this.options.resolveExpectedParentPath?.(this.value) ?? "";
    if (expectedPath) this.value.parentPath = expectedPath;
    else if (!expectedId && !isExtensionCurriculumId(this.value.curriculumId)) this.value.parentPath = "";
    this.updateParentLabel();
  }

  private async submit(): Promise<void> {
    this.value.title = this.value.title.trim();
    this.value.curriculumId = this.value.curriculumId.trim().toUpperCase();
    const error = this.options.validate(this.value) || (this.options.mode !== "proposal" && !this.confirmed ? "Confirm the curriculum ID and destination first." : null);
    if (error) {
      this.errorEl?.setText(error);
      return;
    }
    try {
      await this.options.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      const message = errorMessage(error);
      this.errorEl?.setText(message);
    }
  }
}
