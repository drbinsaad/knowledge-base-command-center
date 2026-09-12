export interface TouchDragTarget<Destination> {
  element: HTMLElement;
  position: "before" | "inside" | "after";
  label: string;
  destination: Destination;
}

export interface TouchDragOptions<Source, Destination> {
  root: HTMLElement;
  getScrollContainer: () => HTMLElement | null;
  /** Exclude pinned chrome from the scrollable content's visible edges. */
  getScrollBounds?: (container: HTMLElement) => { top: number; bottom: number } | null;
  isCurrent: (source: Source) => boolean;
  resolveTarget: (source: Source, x: number, y: number) => TouchDragTarget<Destination> | null;
  onDrop: (source: Source, destination: Destination) => void;
}

interface Gesture<Source, Destination> {
  handle: HTMLElement;
  row: HTMLElement;
  source: Source;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: TouchDragTarget<Destination> | null;
  frame: number | null;
  lastFrameTime: number | null;
}

/** Handle-only pointer gestures: ordinary row touches keep native scrolling. */
export class TouchDragController<Source, Destination> {
  private readonly document: Document;
  private readonly window: Window | null;
  private readonly status: HTMLElement;
  private readonly handles = new Map<HTMLElement, () => void>();
  private gesture: Gesture<Source, Destination> | null = null;
  private gestureCleanups: Array<() => void> = [];
  private destroyed = false;

  constructor(private readonly options: TouchDragOptions<Source, Destination>) {
    this.document = options.root.ownerDocument;
    this.window = this.document.defaultView;
    this.status = options.root.createDiv({
      cls: "ent-cc-touch-drag-status",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
  }

  registerHandle(handle: HTMLElement, row: HTMLElement, label: string, getSource: () => Source | null): void {
    if (this.destroyed) return;
    this.handles.get(handle)?.();
    // Obsidian's mobile swipe recognizer consumes TouchEvents separately from
    // PointerEvents. Use the same handle-only opt-out as its native drag grips;
    // preventDefault on pointerdown alone cannot stop a workspace drawer swipe.
    const previousIgnoreSwipe = handle.getAttribute("data-ignore-swipe");
    handle.setAttribute("data-ignore-swipe", "true");
    const down = (event: PointerEvent): void => {
      if (this.gesture || !this.window || event.button !== 0 || !event.isPrimary) return;
      if (!row.isConnected || !this.options.root.contains(row)) return;
      const source = getSource();
      if (source === null || !this.options.isCurrent(source)) return;
      event.preventDefault();
      event.stopPropagation();
      this.gesture = {
        handle, row, source, label, pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        active: false, target: null, frame: null, lastFrameTime: null,
      };
      this.listenForGesture();
      // Some embedded WebKit hosts reject capture; document listeners still
      // finish or cancel the gesture without leaving a partially applied move.
      try { handle.setPointerCapture(event.pointerId); } catch { /* No capture support. */ }
    };
    const lostCapture = (event: PointerEvent): void => {
      if (this.gesture?.pointerId === event.pointerId) this.cancel();
    };
    const suppress = (event: Event): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("lostpointercapture", lostCapture);
    handle.addEventListener("click", suppress, true);
    handle.addEventListener("contextmenu", suppress, true);
    this.handles.set(handle, () => {
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("lostpointercapture", lostCapture);
      handle.removeEventListener("click", suppress, true);
      handle.removeEventListener("contextmenu", suppress, true);
      if (handle.getAttribute("data-ignore-swipe") === "true") {
        if (previousIgnoreSwipe === null) handle.removeAttribute("data-ignore-swipe");
        else handle.setAttribute("data-ignore-swipe", previousIgnoreSwipe);
      }
    });
  }

  cancel(): void {
    const gesture = this.clearGesture();
    if (gesture?.active) this.status.textContent = "Move cancelled.";
  }

  destroy(): void {
    this.cancel();
    this.destroyed = true;
    for (const cleanup of this.handles.values()) cleanup();
    this.handles.clear();
    this.status.remove();
  }

  private listenForGesture(): void {
    const listen = (target: EventTarget, type: string, listener: EventListener): void => {
      target.addEventListener(type, listener, { capture: true, passive: false });
      this.gestureCleanups.push(() => target.removeEventListener(type, listener, true));
    };
    listen(this.document, "pointermove", (event) => this.move(event as PointerEvent));
    listen(this.document, "pointerup", (event) => this.drop(event as PointerEvent));
    listen(this.document, "pointercancel", (event) => {
      if ((event as PointerEvent).pointerId === this.gesture?.pointerId) this.cancel();
    });
    listen(this.document, "pointerdown", (event) => {
      if ((event as PointerEvent).pointerId !== this.gesture?.pointerId) this.cancel();
    });
    listen(this.document, "keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault();
      this.cancel();
    });
    listen(this.document, "visibilitychange", () => {
      if (this.document.visibilityState === "hidden") this.cancel();
    });
    if (this.window) {
      listen(this.window, "blur", () => this.cancel());
      listen(this.window, "resize", () => this.cancel());
      if (this.window.visualViewport) listen(this.window.visualViewport, "resize", () => this.cancel());
    }
  }

  private current(gesture: Gesture<Source, Destination>): boolean {
    return this.gesture === gesture && gesture.row.isConnected && gesture.handle.isConnected
      && this.options.root.contains(gesture.row) && this.options.isCurrent(gesture.source);
  }

  private move(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!this.current(gesture) || (event.pointerType !== "touch" && event.buttons === 0)) {
      this.cancel();
      return;
    }
    event.preventDefault();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 8) return;
      gesture.active = true;
      gesture.row.classList.add("is-dragging");
      this.options.root.classList.add("is-touch-dragging");
    }
    this.refreshTarget(gesture);
    this.scheduleFrame(gesture);
  }

  private refreshTarget(gesture: Gesture<Source, Destination>): void {
    if (!this.current(gesture)) { this.cancel(); return; }
    const resolved = this.options.resolveTarget(gesture.source, gesture.x, gesture.y);
    if (!this.current(gesture)) { this.cancel(); return; }
    const target = resolved?.element.isConnected && this.options.root.contains(resolved.element) ? resolved : null;
    const previous = gesture.target;
    if (previous?.element !== target?.element || previous?.position !== target?.position) {
      if (previous) previous.element.classList.remove(`is-drop-${previous.position}`);
      if (target) target.element.classList.add(`is-drop-${target.position}`);
    }
    gesture.target = target;
    const message = target ? `Move ${gesture.label} ${target.label}. Release to place.`
      : `Moving ${gesture.label}. Drag over a heading or note. Release here to cancel.`;
    if (this.status.textContent !== message) this.status.textContent = message;
  }

  private scheduleFrame(gesture: Gesture<Source, Destination>): void {
    if (!this.window || this.gesture !== gesture || gesture.frame !== null) return;
    gesture.frame = this.window.requestAnimationFrame((time) => {
      gesture.frame = null;
      if (!this.current(gesture)) { this.cancel(); return; }
      const elapsed = gesture.lastFrameTime === null ? 16 : Math.max(0, Math.min(32, time - gesture.lastFrameTime));
      gesture.lastFrameTime = time;
      this.autoScroll(gesture, elapsed);
      this.refreshTarget(gesture);
      this.scheduleFrame(gesture);
    });
  }

  private autoScroll(gesture: Gesture<Source, Destination>, elapsed: number): void {
    const container = this.options.getScrollContainer();
    if (!container?.isConnected || !this.window || !this.options.root.contains(container)) return;
    const rect = container.getBoundingClientRect();
    const supplied = this.options.getScrollBounds ? this.options.getScrollBounds(container) : rect;
    if (!supplied) return;
    const top = Math.max(0, rect.top, supplied.top);
    const bottom = Math.min(this.window.innerHeight, rect.bottom, supplied.bottom);
    if (bottom <= top || gesture.x < rect.left || gesture.x > rect.right || gesture.y < top || gesture.y > bottom) return;
    const edge = Math.min(48, (bottom - top) / 3);
    const speed = gesture.y < top + edge ? -(top + edge - gesture.y) / edge
      : gesture.y > bottom - edge ? (gesture.y - (bottom - edge)) / edge : 0;
    if (speed === 0) return;
    const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.max(0, Math.min(maximum, container.scrollTop + speed * elapsed * 0.6));
  }

  private drop(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    if (!gesture.active || !this.current(gesture)) { this.cancel(); return; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    this.refreshTarget(gesture);
    if (!this.current(gesture)) { this.cancel(); return; }
    const target = gesture.target;
    this.clearGesture();
    if (!target || !target.element.isConnected || !this.options.root.contains(target.element)
      || !this.options.isCurrent(gesture.source)) {
      this.status.textContent = "Move cancelled.";
      return;
    }
    this.status.textContent = `Move requested for ${gesture.label}.`;
    this.options.onDrop(gesture.source, target.destination);
  }

  private clearGesture(): Gesture<Source, Destination> | null {
    const gesture = this.gesture;
    this.gesture = null;
    for (const cleanup of this.gestureCleanups) cleanup();
    this.gestureCleanups = [];
    if (!gesture) return null;
    if (gesture.frame !== null) this.window?.cancelAnimationFrame(gesture.frame);
    gesture.row.classList.remove("is-dragging");
    this.options.root.classList.remove("is-touch-dragging");
    if (gesture.target) gesture.target.element.classList.remove(`is-drop-${gesture.target.position}`);
    try {
      if (gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId);
    } catch { /* A detached WebKit handle can reject release after cancellation. */ }
    return gesture;
  }
}
