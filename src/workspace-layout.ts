/** Presentation preferences stay in Obsidian's per-vault, per-device storage. */
export const WORKSPACE_LAYOUT_LOCAL_KEY = "ent-vault-command-center.workspace-layout.v1";
export const DEFAULT_INSPECTOR_WIDTH = 380;
export const MIN_INSPECTOR_WIDTH = 320;
export const MAX_INSPECTOR_WIDTH = 2000;
export const MIN_INDEX_WIDTH = 520;
export const WORKSPACE_SEPARATOR_WIDTH = 24;

export interface WorkspaceLayoutPreference {
  inspectorWidth: number;
  tabletSplit: boolean;
}

interface LocalLayoutStorage {
  loadLocalStorage?(key: string): unknown;
  saveLocalStorage?(key: string, value: unknown): void;
}

export function parseWorkspaceLayoutPreference(value: unknown): WorkspaceLayoutPreference {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  if (record.version !== 1) return { inspectorWidth: DEFAULT_INSPECTOR_WIDTH, tabletSplit: false };
  const width = record.inspectorWidth;
  return {
    inspectorWidth: typeof width === "number" && Number.isFinite(width)
      ? Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(width))) : DEFAULT_INSPECTOR_WIDTH,
    tabletSplit: record.tabletSplit === true,
  };
}

export function loadWorkspaceLayoutPreference(storage: LocalLayoutStorage): WorkspaceLayoutPreference {
  try {
    return parseWorkspaceLayoutPreference(storage.loadLocalStorage?.(WORKSPACE_LAYOUT_LOCAL_KEY));
  } catch {
    return parseWorkspaceLayoutPreference(null);
  }
}

/** Storage failure must not block an in-session presentation change. */
export function saveWorkspaceLayoutPreference(storage: LocalLayoutStorage, value: WorkspaceLayoutPreference): boolean {
  try {
    if (!storage.saveLocalStorage) return false;
    storage.saveLocalStorage(WORKSPACE_LAYOUT_LOCAL_KEY, { version: 1, ...parseWorkspaceLayoutPreference({ version: 1, ...value }) });
    return true;
  } catch {
    return false;
  }
}

export function inspectorWidthBounds(workspaceWidth: number): { min: number; max: number } {
  const width = Number.isFinite(workspaceWidth) ? Math.max(0, workspaceWidth) : 0;
  return { min: MIN_INSPECTOR_WIDTH, max: Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.floor(width - MIN_INDEX_WIDTH - WORKSPACE_SEPARATOR_WIDTH))) };
}

export function boundedInspectorWidth(preferred: number, workspaceWidth: number): number {
  const bounds = inspectorWidthBounds(workspaceWidth);
  return Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(preferred) ? preferred : DEFAULT_INSPECTOR_WIDTH));
}

export function keyboardInspectorWidth(key: string, current: number, workspaceWidth: number, rtl: boolean, largeStep = false): number | null {
  const bounds = inspectorWidthBounds(workspaceWidth);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const direction = (key === "ArrowLeft" ? 1 : -1) * (rtl ? -1 : 1);
  return boundedInspectorWidth(current + direction * (largeStep ? 48 : 16), workspaceWidth);
}

/** In-place resizing: no tree rebuild, metadata reads, or synced data writes. */
export class WorkspaceResizeController {
  private preferredWidth: number;
  private drag: { pointerId: number; startX: number; startWidth: number; preferredWidth: number; rtl: boolean } | null = null;
  private dragWindow: Window | null = null;
  private disposed = false;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly separator: HTMLElement,
    preferredWidth: number,
    private readonly onCommit: (width: number) => void,
  ) {
    this.preferredWidth = preferredWidth;
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-label", "Resize note details");
    separator.setAttribute("aria-orientation", "vertical");
    separator.setAttribute("tabindex", "0");
    separator.setAttribute("title", "Drag to resize note details. Use the arrow, home or end keys when focused.");
    separator.addEventListener("keydown", this.onKeydown);
    separator.addEventListener("pointerdown", this.onPointerDown);
    separator.addEventListener("lostpointercapture", this.onPointerCancel);
    this.refresh();
  }

  private width(): number { return this.workspace.getBoundingClientRect().width; }
  private rtl(): boolean { return this.workspace.ownerDocument.defaultView?.getComputedStyle(this.workspace).direction === "rtl"; }

  refresh(): void {
    if (this.disposed) return;
    const width = boundedInspectorWidth(this.preferredWidth, this.width());
    const bounds = inspectorWidthBounds(this.width());
    this.workspace.style.setProperty("--ent-cc-inspector-width", `${width}px`);
    this.separator.setAttribute("aria-valuemin", String(bounds.min));
    this.separator.setAttribute("aria-valuemax", String(bounds.max));
    this.separator.setAttribute("aria-valuenow", String(Math.round(width)));
    this.separator.setAttribute("aria-valuetext", `${Math.round(width)} pixels wide`);
  }

  reset(): void {
    this.cancel();
    this.preferredWidth = DEFAULT_INSPECTOR_WIDTH;
    this.refresh();
    this.onCommit(this.preferredWidth);
  }

  adjust(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.cancel();
    this.preferredWidth = boundedInspectorWidth(boundedInspectorWidth(this.preferredWidth, this.width()) + delta, this.width());
    this.refresh();
    this.onCommit(this.preferredWidth);
  }

  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    this.finishDrag();
    this.preferredWidth = drag.preferredWidth;
    this.refresh();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.separator.removeEventListener("keydown", this.onKeydown);
    this.separator.removeEventListener("pointerdown", this.onPointerDown);
    this.separator.removeEventListener("lostpointercapture", this.onPointerCancel);
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.drag) {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = keyboardInspectorWidth(event.key, boundedInspectorWidth(this.preferredWidth, this.width()), this.width(), this.rtl(), event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
    this.preferredWidth = next;
    this.refresh();
    this.onCommit(next);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.disposed || this.drag || event.button !== 0 || event.isPrimary === false || !Number.isFinite(event.clientX)) return;
    event.preventDefault();
    this.separator.focus({ preventScroll: true });
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: boundedInspectorWidth(this.preferredWidth, this.width()), preferredWidth: this.preferredWidth, rtl: this.rtl() };
    this.workspace.classList.add("is-resizing-inspector");
    try { this.separator.setPointerCapture(event.pointerId); } catch { /* Window listeners also cover hosts without pointer capture. */ }
    const owner = this.workspace.ownerDocument.defaultView;
    this.dragWindow = owner;
    owner?.addEventListener("pointermove", this.onPointerMove);
    owner?.addEventListener("pointerup", this.onPointerUp);
    owner?.addEventListener("pointercancel", this.onPointerCancel);
    owner?.addEventListener("blur", this.onWindowBlur);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId || !Number.isFinite(event.clientX)) return;
    event.preventDefault();
    this.preferredWidth = boundedInspectorWidth(drag.startWidth + (event.clientX - drag.startX) * (drag.rtl ? 1 : -1), this.width());
    this.refresh();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.onPointerMove(event);
    this.finishDrag();
    this.onCommit(this.preferredWidth);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId) this.cancel();
  };
  private onWindowBlur = (): void => this.cancel();

  private finishDrag(): void {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    const owner = this.dragWindow;
    this.dragWindow = null;
    owner?.removeEventListener("pointermove", this.onPointerMove);
    owner?.removeEventListener("pointerup", this.onPointerUp);
    owner?.removeEventListener("pointercancel", this.onPointerCancel);
    owner?.removeEventListener("blur", this.onWindowBlur);
    this.workspace.classList.remove("is-resizing-inspector");
    if (pointerId !== undefined) {
      try { this.separator.releasePointerCapture(pointerId); } catch { /* Already released by the host. */ }
    }
  }
}
