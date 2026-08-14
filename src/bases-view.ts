import { BasesView, Notice, NullValue, setIcon, TFile } from "obsidian";
import type {
  BasesAllOptions,
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  BasesViewConfig,
  QueryController,
  Value,
} from "obsidian";
import { errorMessage } from "./model";

export const ENT_HIERARCHY_BASES_VIEW_TYPE = "ent-hierarchy";
export const DEFAULT_HIERARCHY_BASES_PAGE_SIZE = 100;
export const MAX_HIERARCHY_BASES_PAGE_SIZE = 300;
export const HIERARCHY_BASES_BUILD_SLICE = 250;

const MIN_HIERARCHY_BASES_PAGE_SIZE = 25;
const DEFAULT_TITLE_PROPERTY: BasesPropertyId = "note.title";
const DEFAULT_ID_PROPERTY: BasesPropertyId = "note.curriculum_id";
const DEFAULT_GROUP_PROPERTY: BasesPropertyId = "note.domain";
const DEFAULT_PRIORITY_PROPERTY: BasesPropertyId = "note.priority";
const DEFAULT_STATUS_PROPERTY: BasesPropertyId = "note.review_status";

const OPTION_KEYS = {
  group: "groupProperty",
  id: "idProperty",
  pageSize: "pageSize",
  priority: "priorityProperty",
  showCounts: "showCounts",
  status: "statusProperty",
  title: "titleProperty",
} as const;

export interface ResolvedHierarchyBasesViewOptions {
  groupProperty: BasesPropertyId;
  idProperty: BasesPropertyId;
  pageSize: number;
  priorityProperty: BasesPropertyId;
  showCounts: boolean;
  statusProperty: BasesPropertyId;
  titleProperty: BasesPropertyId;
}

interface RenderGroup {
  entries: BasesEntry[];
  label: string;
}

interface PageCursor {
  entryIndex: number;
  groupIndex: number;
  offset: number;
}

interface PendingRenderTask {
  arm: number;
  callback: () => void;
  generation: number;
  timer: number;
  window: Window;
}

let nextHierarchyBasesViewId = 0;

function configuredProperty(
  config: BasesViewConfig,
  key: string,
  fallback: BasesPropertyId,
): BasesPropertyId {
  return config.getAsPropertyId(key) ?? fallback;
}

export function resolveHierarchyBasesViewOptions(config: BasesViewConfig): ResolvedHierarchyBasesViewOptions {
  const rawPageSize = config.get(OPTION_KEYS.pageSize);
  const parsedPageSize = typeof rawPageSize === "number"
    ? rawPageSize
    : Number(typeof rawPageSize === "string" && rawPageSize.trim() ? rawPageSize : Number.NaN);
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.max(MIN_HIERARCHY_BASES_PAGE_SIZE, Math.min(MAX_HIERARCHY_BASES_PAGE_SIZE, Math.trunc(parsedPageSize)))
    : DEFAULT_HIERARCHY_BASES_PAGE_SIZE;
  return {
    groupProperty: configuredProperty(config, OPTION_KEYS.group, DEFAULT_GROUP_PROPERTY),
    idProperty: configuredProperty(config, OPTION_KEYS.id, DEFAULT_ID_PROPERTY),
    pageSize,
    priorityProperty: configuredProperty(config, OPTION_KEYS.priority, DEFAULT_PRIORITY_PROPERTY),
    showCounts: typeof config.get(OPTION_KEYS.showCounts) === "boolean"
      ? config.get(OPTION_KEYS.showCounts) as boolean
      : true,
    statusProperty: configuredProperty(config, OPTION_KEYS.status, DEFAULT_STATUS_PROPERTY),
    titleProperty: configuredProperty(config, OPTION_KEYS.title, DEFAULT_TITLE_PROPERTY),
  };
}

export function hierarchyBasesViewOptions(): BasesAllOptions[] {
  return [
    {
      type: "group",
      displayName: "Properties",
      items: [
        { key: OPTION_KEYS.title, type: "property", displayName: "Title", default: DEFAULT_TITLE_PROPERTY },
        { key: OPTION_KEYS.id, type: "property", displayName: "ID", default: DEFAULT_ID_PROPERTY },
        { key: OPTION_KEYS.group, type: "property", displayName: "Fallback group", default: DEFAULT_GROUP_PROPERTY },
        { key: OPTION_KEYS.status, type: "property", displayName: "Status", default: DEFAULT_STATUS_PROPERTY },
        { key: OPTION_KEYS.priority, type: "property", displayName: "Priority", default: DEFAULT_PRIORITY_PROPERTY },
      ],
    },
    {
      type: "group",
      displayName: "Display",
      items: [
        {
          key: OPTION_KEYS.pageSize,
          type: "dropdown",
          displayName: "Rows per page",
          default: String(DEFAULT_HIERARCHY_BASES_PAGE_SIZE),
          options: {
            "25": "25 rows",
            "50": "50 rows",
            "100": "100 rows",
            "200": "200 rows",
            "300": "300 rows",
          },
        },
        { key: OPTION_KEYS.showCounts, type: "toggle", displayName: "Show group counts", default: true },
      ],
    },
  ];
}

function valueText(value: Value | null | undefined): string {
  if (value == null || value === NullValue.value) return "";
  try {
    return value.toString().trim();
  } catch {
    return "";
  }
}

function entryPropertyText(entry: BasesEntry, property: BasesPropertyId): string {
  try {
    return valueText(entry.getValue(property));
  } catch {
    return "";
  }
}

function groupHasKey(group: BasesEntryGroup): boolean {
  try {
    return group.hasKey();
  } catch {
    return false;
  }
}

export class EntHierarchyBasesView extends BasesView {
  type = ENT_HIERARCHY_BASES_VIEW_TYPE;

  private readonly instanceId = ++nextHierarchyBasesViewId;
  private renderGeneration = 0;
  private controlsGeneration = 0;
  private pendingTask: PendingRenderTask | null = null;
  private renderWindow: Window | null = null;
  private windowMigrationCleanup: (() => void) | null = null;
  private groups: RenderGroup[] = [];
  private pageCursors: PageCursor[] = [];
  private totalEntries = 0;
  private options: ResolvedHierarchyBasesViewOptions | null = null;
  private groupsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private controlsEl: HTMLElement | null = null;

  private readonly containerEl: HTMLElement;

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    private readonly openRecord?: (file: TFile) => Promise<void>,
  ) {
    super(controller);
    this.containerEl = parentEl.createDiv({ cls: "ent-cc-bases-view" });
    this.renderWindow = this.containerEl.ownerDocument.defaultView;
    if (typeof parentEl.onWindowMigrated === "function") {
      this.windowMigrationCleanup = parentEl.onWindowMigrated((migratedWindow) => {
        this.handleWindowMigration(migratedWindow);
      });
    }
  }

  onDataUpdated(): void {
    this.cancelPendingCallback();
    const generation = ++this.renderGeneration;
    this.controlsGeneration += 1;
    this.groups = [];
    this.pageCursors = [];
    this.totalEntries = this.data.data.length;
    this.options = resolveHierarchyBasesViewOptions(this.config);

    this.containerEl.empty();
    this.containerEl.setAttribute("role", "region");
    this.containerEl.setAttribute("aria-label", "Knowledge hierarchy");
    this.containerEl.setAttribute("aria-busy", "true");
    this.statusEl = this.containerEl.createDiv({
      cls: "ent-cc-base-status",
      text: this.totalEntries === 0 ? "No entries to show." : `Preparing ${String(this.totalEntries)} entries…`,
      attr: { role: "status", "aria-atomic": "true", "aria-live": "polite" },
    });
    this.groupsEl = this.containerEl.createDiv({
      cls: "ent-cc-base-groups",
      attr: { id: this.groupsElementId() },
    });
    this.controlsEl = this.containerEl.createDiv({ cls: "ent-cc-base-controls" });

    if (this.totalEntries === 0) {
      this.containerEl.setAttribute("aria-busy", "false");
      return;
    }

    this.scheduleForGeneration(generation, () => this.startGroupBuild(generation));
  }

  private startGroupBuild(generation: number): void {
    if (generation !== this.renderGeneration) return;
    let sourceGroups: BasesEntryGroup[];
    try {
      // groupedData is a lazy getter in Obsidian. Read it outside onDataUpdated so
      // the initial update stays responsive even when Bases has thousands of rows.
      sourceGroups = this.data.groupedData;
    } catch {
      this.containerEl.setAttribute("aria-busy", "false");
      this.statusEl?.setText("Unable to prepare this bases view.");
      return;
    }
    if (sourceGroups.length === 0) {
      this.finishGroupBuild(generation);
      return;
    }

    // An ungrouped Bases result is the one group whose key is undefined. Native
    // grouping uses a defined key even when that key is Obsidian's NullValue.
    const usesNativeGroups = sourceGroups.some((group) => group.key !== undefined);
    if (usesNativeGroups) this.buildNativeGroups(sourceGroups, generation);
    else this.buildFallbackGroups(this.data.data, generation);
  }

  onunload(): void {
    this.renderGeneration += 1;
    this.controlsGeneration += 1;
    this.cancelPendingCallback();
    this.windowMigrationCleanup?.();
    this.windowMigrationCleanup = null;
    // The factory gives every Bases view the same host element. Remove the
    // child owned by this instance so switching view types cannot leave a stale
    // hierarchy beside the replacement view.
    this.containerEl.remove();
  }

  private buildNativeGroups(sourceGroups: BasesEntryGroup[], generation: number): void {
    let sourceIndex = 0;
    const buildSlice = (): void => {
      const end = Math.min(sourceIndex + HIERARCHY_BASES_BUILD_SLICE, sourceGroups.length);
      for (; sourceIndex < end; sourceIndex += 1) {
        const source = sourceGroups[sourceIndex];
        if (!source || source.entries.length === 0) continue;
        this.groups.push({
          entries: source.entries,
          label: groupHasKey(source) ? valueText(source.key) || "Unassigned" : "Unassigned",
        });
      }
      if (sourceIndex < sourceGroups.length) this.scheduleForGeneration(generation, buildSlice);
      else this.finishGroupBuild(generation);
    };
    this.scheduleForGeneration(generation, buildSlice);
  }

  private buildFallbackGroups(entries: BasesEntry[], generation: number): void {
    const groupsByLabel = new Map<string, RenderGroup>();
    let entryIndex = 0;
    const buildSlice = (): void => {
      const end = Math.min(entryIndex + HIERARCHY_BASES_BUILD_SLICE, entries.length);
      for (; entryIndex < end; entryIndex += 1) {
        const entry = entries[entryIndex];
        if (!entry) continue;
        const configuredGroup = entryPropertyText(entry, this.options?.groupProperty ?? DEFAULT_GROUP_PROPERTY);
        const folderGroup = entry.file.parent?.name.replace(/^\d+\s+/, "") || "Unassigned";
        const label = configuredGroup || folderGroup;
        const existing = groupsByLabel.get(label);
        if (existing) existing.entries.push(entry);
        else {
          const group = { entries: [entry], label };
          groupsByLabel.set(label, group);
          this.groups.push(group);
        }
      }
      if (entryIndex < entries.length) this.scheduleForGeneration(generation, buildSlice);
      else this.finishGroupBuild(generation);
    };
    this.scheduleForGeneration(generation, buildSlice);
  }

  private finishGroupBuild(generation: number): void {
    if (generation !== this.renderGeneration) return;
    this.containerEl.setAttribute("aria-busy", "false");
    if (this.groups.length === 0) {
      this.statusEl?.setText("No entries to show.");
      return;
    }
    this.pageCursors = [{ entryIndex: 0, groupIndex: 0, offset: 0 }];
    this.renderPage(generation, 0, false);
  }

  private renderPage(generation: number, pageIndex: number, moveFocus: boolean): void {
    if (generation !== this.renderGeneration || !this.options || !this.groupsEl || !this.controlsEl) return;
    const pageStart = this.pageCursors[pageIndex];
    if (!pageStart) return;
    this.groupsEl.empty();
    this.controlsEl.empty();
    const controlsGeneration = ++this.controlsGeneration;
    let groupIndex = pageStart.groupIndex;
    let entryIndex = pageStart.entryIndex;
    let offset = pageStart.offset;
    let firstRow: HTMLButtonElement | null = null;
    let pageRemaining = this.options.pageSize;
    while (pageRemaining > 0 && groupIndex < this.groups.length) {
      const group = this.groups[groupIndex];
      if (!group) break;
      const rowsEl = this.createGroupSection(group, groupIndex);
      while (pageRemaining > 0 && entryIndex < group.entries.length) {
        const entry = group.entries[entryIndex];
        if (entry) {
          const row = this.createRecordRow(rowsEl, entry, generation);
          firstRow ??= row;
        }
        entryIndex += 1;
        offset += 1;
        pageRemaining -= 1;
      }
      if (entryIndex >= group.entries.length) {
        groupIndex += 1;
        entryIndex = 0;
      }
    }

    const hasNextPage = groupIndex < this.groups.length;
    if (hasNextPage && !this.pageCursors[pageIndex + 1]) {
      this.pageCursors.push({ entryIndex, groupIndex, offset });
    }
    const firstShown = pageStart.offset + 1;
    this.statusEl?.setText(`Showing ${String(firstShown)}–${String(offset)} of ${String(this.totalEntries)} entries.`);
    this.renderPageControls(generation, controlsGeneration, pageIndex, hasNextPage);
    if (moveFocus) firstRow?.focus({ preventScroll: true });
  }

  private renderPageControls(
    generation: number,
    controlsGeneration: number,
    pageIndex: number,
    hasNextPage: boolean,
  ): void {
    if (!this.controlsEl || (!hasNextPage && pageIndex === 0)) return;
    const navigation = this.controlsEl.createEl("nav", {
      cls: "ent-cc-base-pagination",
      attr: { "aria-label": "Knowledge hierarchy pages" },
    });
    const previous = navigation.createEl("button", {
      cls: "ent-cc-button",
      text: "Previous",
      attr: { "aria-controls": this.groupsElementId(), type: "button" },
    });
    previous.disabled = pageIndex === 0;
    const next = navigation.createEl("button", {
      cls: "ent-cc-button",
      text: "Next",
      attr: { "aria-controls": this.groupsElementId(), type: "button" },
    });
    next.disabled = !hasNextPage;

    const navigate = (targetPage: number): void => {
      if (controlsGeneration !== this.controlsGeneration || !this.controlsEl?.contains(navigation)) return;
      if (targetPage < 0 || !this.pageCursors[targetPage]) return;
      this.controlsGeneration += 1;
      previous.disabled = true;
      next.disabled = true;
      this.scheduleForGeneration(generation, () => this.renderPage(generation, targetPage, true));
    };
    previous.addEventListener("click", () => navigate(pageIndex - 1));
    next.addEventListener("click", () => navigate(pageIndex + 1));
  }

  private createGroupSection(group: RenderGroup, groupIndex: number): HTMLElement {
    const headingId = `${this.groupsElementId()}-heading-${String(groupIndex)}`;
    const section = this.groupsEl?.createEl("section", {
      cls: "ent-cc-base-group",
      attr: { "aria-labelledby": headingId },
    });
    if (!section) return this.containerEl;
    const heading = section.createEl("h2", {
      cls: "ent-cc-base-heading",
      attr: { id: headingId },
    });
    const icon = heading.createSpan();
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, "folder-tree");
    heading.createSpan({ text: group.label, cls: "ent-cc-base-heading-label", attr: { dir: "auto" } });
    if (this.options?.showCounts) {
      heading.createSpan({
        text: String(group.entries.length),
        cls: "ent-cc-base-count",
        attr: { "aria-label": `${String(group.entries.length)} entries` },
      });
    }
    return section.createDiv({ cls: "ent-cc-base-records", attr: { role: "list" } });
  }

  private createRecordRow(parent: HTMLElement, entry: BasesEntry, generation: number): HTMLButtonElement | null {
    const options = this.options;
    if (!options) return null;
    const title = entryPropertyText(entry, options.titleProperty) || entry.file.basename;
    const id = entryPropertyText(entry, options.idProperty);
    const status = entryPropertyText(entry, options.statusProperty);
    const priority = entryPropertyText(entry, options.priorityProperty);
    const accessibleName = [
      `Open ${title}`,
      id ? `ID ${id}` : "",
      status ? `Status ${status}` : "",
      priority ? `Priority ${priority}` : "",
    ].filter(Boolean).join(", ");
    const listItem = parent.createDiv({ attr: { role: "listitem" } });
    const file = entry.file;
    const row = listItem.createEl("button", {
      cls: "ent-cc-base-record",
      attr: { "aria-label": accessibleName, type: "button" },
    });
    row.createSpan({ text: title, cls: "ent-cc-base-record-title", attr: { dir: "auto" } });
    row.createSpan({ text: id, cls: "ent-cc-base-record-id", attr: { dir: "auto" } });
    const metadata = [status, priority].filter(Boolean).join(" · ");
    if (metadata) row.createSpan({ text: metadata, cls: "ent-cc-base-record-meta", attr: { dir: "auto" } });
    row.addEventListener("click", () => {
      if (generation !== this.renderGeneration || !this.containerEl.contains(row)) return;
      try {
        const open = this.openRecord
          ? this.openRecord(file)
          : this.app.workspace.getLeaf("tab").openFile(file);
        void open.catch((error) => {
          new Notice(errorMessage(error));
        });
      } catch (error) {
        new Notice(errorMessage(error));
      }
    });
    return row;
  }

  private groupsElementId(): string {
    return `ent-cc-bases-groups-${String(this.instanceId)}`;
  }

  private scheduleForGeneration(generation: number, callback: () => void): boolean {
    const ownerWindow = this.containerEl.ownerDocument.defaultView ?? this.renderWindow;
    if (!ownerWindow) {
      this.containerEl.setAttribute("aria-busy", "false");
      this.statusEl?.setText("This view is unavailable because its window has closed.");
      return false;
    }
    this.cancelPendingCallback();
    this.renderWindow = ownerWindow;
    const task = {
      arm: 0,
      callback,
      generation,
      timer: 0,
      window: ownerWindow,
    } satisfies PendingRenderTask;
    this.pendingTask = task;
    this.armTask(task, ownerWindow);
    return true;
  }

  private armTask(task: PendingRenderTask, ownerWindow: Window): void {
    task.arm += 1;
    const expectedArm = task.arm;
    task.window = ownerWindow;
    task.timer = ownerWindow.setTimeout(() => {
      if (
        this.pendingTask !== task
        || task.arm !== expectedArm
        || task.window !== ownerWindow
      ) return;
      this.pendingTask = null;
      if (task.generation !== this.renderGeneration) return;
      task.callback();
    }, 0);
  }

  private cancelPendingCallback(): void {
    const task = this.pendingTask;
    if (task) task.window.clearTimeout(task.timer);
    this.pendingTask = null;
  }

  private handleWindowMigration(migratedWindow: Window): void {
    const task = this.pendingTask;
    if (task && task.window !== migratedWindow) {
      task.window.clearTimeout(task.timer);
      this.armTask(task, migratedWindow);
    }
    this.renderWindow = migratedWindow;
  }
}
