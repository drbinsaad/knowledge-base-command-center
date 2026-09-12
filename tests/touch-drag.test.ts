import assert from "node:assert/strict";
import test from "node:test";
import { TouchDragController, type TouchDragOptions, type TouchDragTarget } from "../src/touch-drag.ts";

class ListenerTarget extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (listener) {
      const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class DragWindow extends ListenerTarget {
  innerHeight = 800;
  visualViewport = new ListenerTarget();
  readonly frames = new Map<number, FrameRequestCallback>();
  private nextFrame = 0;

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = ++this.nextFrame;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void { this.frames.delete(id); }

  tick(time = 16): void {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(time);
  }
}

class DragDocument extends ListenerTarget {
  visibilityState = "visible";
  defaultView: DragWindow | null = new DragWindow();
}

class DragElement extends ListenerTarget {
  readonly classNames = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => { for (const name of names) this.classNames.add(name); },
    remove: (...names: string[]): void => { for (const name of names) this.classNames.delete(name); },
    contains: (name: string): boolean => this.classNames.has(name),
  };
  readonly children: DragElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly captured = new Set<number>();
  parent: DragElement | null = null;
  connectedRoot = false;
  textContent = "";
  scrollTop = 0;
  scrollHeight = 2000;
  clientHeight = 600;
  rect = { top: 100, bottom: 700, left: 0, right: 400 };
  failCapture = false;
  failRelease = false;

  constructor(readonly ownerDocument: DragDocument) { super(); }

  get isConnected(): boolean { return this.connectedRoot || !!this.parent?.isConnected; }

  createDiv(options: { cls?: string; attr?: Record<string, string> } = {}): DragElement {
    const element = new DragElement(this.ownerDocument);
    element.parent = this;
    if (options.cls) element.classList.add(options.cls);
    for (const [key, value] of Object.entries(options.attr ?? {})) element.attributes.set(key, value);
    this.children.push(element);
    return element;
  }

  contains(element: DragElement): boolean { return element === this || this.children.some((child) => child.contains(element)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getBoundingClientRect(): typeof this.rect { return this.rect; }
  setPointerCapture(id: number): void {
    if (this.failCapture) throw new Error("Capture unavailable");
    this.captured.add(id);
  }
  hasPointerCapture(id: number): boolean { return this.captured.has(id); }
  releasePointerCapture(id: number): void {
    if (this.failRelease) throw new Error("Detached capture");
    this.captured.delete(id);
    dispatch(this, "lostpointercapture", { pointerId: id });
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.connectedRoot = false;
  }
}

function html(element: DragElement): HTMLElement { return element as unknown as HTMLElement; }

function dispatch(target: EventTarget, type: string, values: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, {
    pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: 1,
    clientX: 100, clientY: 200, ...values,
  });
  target.dispatchEvent(event);
  return event;
}

interface Source { id: string }
interface Destination { id: string }

function harness(extra: Partial<TouchDragOptions<Source, Destination>> = {}) {
  const document = new DragDocument();
  const window = document.defaultView as DragWindow;
  const root = new DragElement(document);
  root.connectedRoot = true;
  const scroller = root.createDiv();
  const row = scroller.createDiv();
  const handle = row.createDiv();
  const destination = scroller.createDiv();
  const source: Source = { id: "subject" };
  const drops: Array<{ source: Source; destination: Destination }> = [];
  let current = true;
  let reads = 0;
  let sourceAvailable = true;
  let resolved: TouchDragTarget<Destination> | null = {
    element: html(destination), position: "inside", label: "under General", destination: { id: "General" },
  };
  const controller = new TouchDragController({
    root: html(root),
    getScrollContainer: () => html(scroller),
    isCurrent: () => current,
    resolveTarget: () => { reads++; return resolved; },
    onDrop: (source, destination) => { drops.push({ source, destination }); },
    ...extra,
  });
  controller.registerHandle(html(handle), html(row), "Subject", () => sourceAvailable ? source : null);
  const status = root.children.find((element) => element.classList.contains("ent-cc-touch-drag-status")) as DragElement;
  const start = (values: Record<string, unknown> = {}): Event => dispatch(handle, "pointerdown", values);
  const move = (values: Record<string, unknown> = {}): Event => dispatch(document, "pointermove", { clientY: 230, ...values });
  const drop = (values: Record<string, unknown> = {}): Event => dispatch(document, "pointerup", { clientY: 230, ...values });
  return {
    document, window, root, scroller, row, handle, destination, source, drops, controller, status, start, move, drop,
    get reads() { return reads; },
    set current(value: boolean) { current = value; },
    set resolved(value: TouchDragTarget<Destination> | null) { resolved = value; },
    set sourceAvailable(value: boolean) { sourceAvailable = value; },
  };
}

test("touch handle activates only after eight pixels, paints a target, and drops exactly once", () => {
  const h = harness();
  assert.equal(h.status.attributes.get("role"), "status");
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.start().defaultPrevented, true);
  assert.equal(h.handle.captured.has(1), true);
  h.move({ clientY: 207 });
  assert.equal(h.row.classList.contains("is-dragging"), false);
  assert.equal(h.window.frames.size, 0);
  h.move({ clientY: 208 });
  assert.equal(h.row.classList.contains("is-dragging"), true);
  assert.equal(h.destination.classList.contains("is-drop-inside"), true);
  assert.match(h.status.textContent, /under General/u);
  assert.equal(h.drops.length, 0, "preview never mutates organization");
  assert.equal(h.window.frames.size, 1);
  h.drop();
  h.drop();
  assert.deepEqual(h.drops, [{ source: h.source, destination: { id: "General" } }]);
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.window.listenerCount(), 0);
  assert.equal(h.window.visualViewport.listenerCount(), 0);
  assert.equal(h.window.frames.size, 0);
  assert.equal(h.handle.captured.size, 0);
  assert.equal(h.row.classList.contains("is-dragging"), false);
  assert.equal(h.destination.classList.contains("is-drop-inside"), false);
});

test("ordinary row touches are untouched, while handle tap and context menu never trigger a row click", () => {
  const h = harness();
  assert.equal(dispatch(h.row, "pointerdown").defaultPrevented, false);
  assert.equal(dispatch(h.document, "pointermove").defaultPrevented, false);
  assert.equal(h.document.listenerCount(), 0);
  let clicked = 0;
  h.handle.addEventListener("click", () => clicked++);
  h.start();
  h.drop();
  assert.equal(h.drops.length, 0);
  assert.equal(dispatch(h.handle, "click").defaultPrevented, true);
  assert.equal(dispatch(h.handle, "contextmenu").defaultPrevented, true);
  assert.equal(clicked, 0);
});

test("only the dedicated grip opts out of Obsidian's touch-based workspace swipe recognizer", () => {
  const h = harness();
  assert.equal(h.handle.getAttribute("data-ignore-swipe"), "true");
  assert.equal(h.row.getAttribute("data-ignore-swipe"), null);
  assert.equal(h.scroller.getAttribute("data-ignore-swipe"), null);
  assert.equal(h.root.getAttribute("data-ignore-swipe"), null);
  // Mirror the observed host contract: touchstart walks ancestors for a truthy
  // ignoreSwipe attribute, independently of pointerdown.defaultPrevented.
  const hostWouldStartSwipe = (target: DragElement): boolean => {
    for (let element: DragElement | null = target; element; element = element.parent) {
      if (element.getAttribute("data-ignore-swipe")) return false;
    }
    return true;
  };
  assert.equal(hostWouldStartSwipe(h.handle.createDiv()), false, "a touch on the grip's SVG descendant is exempt");
  assert.equal(hostWouldStartSwipe(h.row.createDiv()), true, "normal row gestures keep the host's behavior");
  assert.equal(dispatch(h.row, "touchstart").defaultPrevented, false);
  h.controller.destroy();
  assert.equal(h.handle.getAttribute("data-ignore-swipe"), null);
});

test("swipe opt-out cleanup preserves original and independently changed handle attributes", () => {
  const h = harness();
  const owned = h.row.createDiv();
  owned.setAttribute("data-ignore-swipe", "existing-owner");
  h.controller.registerHandle(html(owned), html(h.row), "Subject", () => h.source);
  assert.equal(owned.getAttribute("data-ignore-swipe"), "true");
  h.controller.registerHandle(html(owned), html(h.row), "Subject", () => h.source);
  assert.equal(owned.getAttribute("data-ignore-swipe"), "true", "re-registration keeps the native swipe opt-out");
  h.handle.setAttribute("data-ignore-swipe", "changed-by-owner");
  h.controller.destroy();
  assert.equal(owned.getAttribute("data-ignore-swipe"), "existing-owner");
  assert.equal(h.handle.getAttribute("data-ignore-swipe"), "changed-by-owner");
});

test("secondary pointers and buttons, absent sources, and detached rows cannot start", () => {
  const h = harness();
  for (const values of [{ isPrimary: false }, { button: 2 }, { button: 1 }]) {
    assert.equal(h.start(values).defaultPrevented, false);
  }
  h.sourceAvailable = false;
  assert.equal(h.start().defaultPrevented, false);
  h.sourceAvailable = true;
  h.current = false;
  assert.equal(h.start().defaultPrevented, false);
  h.current = true;
  h.row.remove();
  assert.equal(h.start().defaultPrevented, false);
  assert.equal(h.document.listenerCount(), 0);
});

for (const pointerType of ["mouse", "pen", "touch"]) {
  test(`${pointerType} primary pointer works and other pointer movement is ignored`, () => {
    const h = harness();
    h.start({ pointerType });
    assert.equal(h.move({ pointerId: 2, pointerType }).defaultPrevented, false);
    assert.equal(h.drop({ pointerId: 2, pointerType }).defaultPrevented, false);
    h.move({ pointerType });
    h.drop({ pointerType });
    assert.equal(h.drops.length, 1);
  });
}

test("pointer release resolves the final coordinates instead of committing the previous highlight", () => {
  let lastPoint: number[] = [];
  const h = harness({ resolveTarget: (_source, x, y) => {
    lastPoint = [x, y];
    return { element: html(h.destination), position: "after", label: "after Other", destination: { id: `${x}:${y}` } };
  } });
  h.start();
  h.move();
  h.drop({ clientX: 170, clientY: 350 });
  assert.deepEqual(lastPoint, [170, 350]);
  assert.equal(h.drops[0]?.destination.id, "170:350");
});

test("invalid and disconnected targets remove previous highlights and cancel safely", () => {
  const h = harness();
  h.start();
  h.move();
  h.resolved = null;
  h.move();
  assert.equal(h.destination.classList.contains("is-drop-inside"), false);
  assert.match(h.status.textContent, /Release here to cancel/u);
  h.drop();
  assert.equal(h.drops.length, 0);
  h.resolved = { element: html(new DragElement(h.document)), position: "before", label: "before detached", destination: { id: "detached" } };
  h.start();
  h.move();
  h.drop();
  assert.equal(h.drops.length, 0);
});

test("target changes move the before/inside/after marker without stale classes", () => {
  const h = harness();
  h.start();
  h.move();
  for (const position of ["before", "after", "inside"] as const) {
    h.resolved = { element: html(h.destination), position, label: `${position} target`, destination: { id: position } };
    h.move();
    assert.deepEqual([...h.destination.classNames], [`is-drop-${position}`]);
  }
  h.controller.cancel();
  assert.deepEqual([...h.destination.classNames], []);
});

const cancellations: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
  ["pointer cancellation", (h) => { dispatch(h.document, "pointercancel"); }],
  ["lost pointer capture", (h) => { dispatch(h.handle, "lostpointercapture"); }],
  ["Escape", (h) => { assert.equal(dispatch(h.document, "keydown", { key: "Escape" }).defaultPrevented, true); }],
  ["window blur", (h) => { dispatch(h.window, "blur"); }],
  ["window resize", (h) => { dispatch(h.window, "resize"); }],
  ["visual viewport resize", (h) => { dispatch(h.window.visualViewport, "resize"); }],
  ["hidden document", (h) => { h.document.visibilityState = "hidden"; dispatch(h.document, "visibilitychange"); }],
  ["second touch", (h) => { assert.equal(dispatch(h.document, "pointerdown", { pointerId: 2, isPrimary: false }).defaultPrevented, false); }],
  ["rerender cancellation", (h) => { h.controller.cancel(); }],
  ["stale source", (h) => { h.current = false; h.window.tick(); }],
  ["detached row", (h) => { h.row.remove(); h.window.tick(); }],
];

for (const [name, cancel] of cancellations) {
  test(`${name} clears the active gesture and prevents a later drop`, () => {
    const h = harness();
    h.start();
    h.move();
    cancel(h);
    h.drop();
    h.window.tick();
    assert.equal(h.drops.length, 0);
    assert.equal(h.window.frames.size, 0);
    assert.equal(h.document.listenerCount(), 0);
    assert.equal(h.window.listenerCount(), 0);
    assert.equal(h.row.classList.contains("is-dragging"), false);
    assert.equal(h.destination.classList.contains("is-drop-inside"), false);
    assert.match(h.status.textContent, /cancelled/u);
  });
}

test("unrelated key, pointercancel, lost capture and visible-document events do not cancel", () => {
  const h = harness();
  h.start();
  h.move();
  assert.equal(dispatch(h.document, "keydown", { key: "ArrowDown" }).defaultPrevented, false);
  dispatch(h.document, "pointercancel", { pointerId: 2 });
  dispatch(h.handle, "lostpointercapture", { pointerId: 2 });
  dispatch(h.document, "visibilitychange");
  h.drop();
  assert.equal(h.drops.length, 1);
});

test("fresh-source checks after hit-testing and at commit prevent a changed source from being moved", () => {
  for (const phase of ["resolve", "commit"] as const) {
    let current = true;
    const h = harness({
      isCurrent: () => current,
      resolveTarget: () => {
        if (phase === "resolve") current = false;
        return { element: html(h.destination), position: "inside", label: "under target", destination: { id: "target" } };
      },
    });
    h.start();
    h.move();
    if (phase === "commit") {
      h.handle.releasePointerCapture = () => { current = false; };
    }
    h.drop();
    assert.equal(h.drops.length, 0, phase);
    assert.equal(h.window.frames.size, 0);
  }
});

test("mouse or pen losing its pressed button cancels without treating touch buttons as reliable", () => {
  for (const pointerType of ["mouse", "pen", "touch"]) {
    const h = harness();
    h.start({ pointerType });
    h.move({ pointerType, buttons: 0 });
    h.drop({ pointerType });
    assert.equal(h.drops.length, pointerType === "touch" ? 1 : 0);
  }
});

test("edge auto-scroll is bounded, reruns hit testing, and stops after cancellation", () => {
  const h = harness({ getScrollBounds: () => ({ top: 220, bottom: 650 }) });
  h.start();
  h.move({ clientY: 645 });
  const reads = h.reads;
  h.window.tick(16);
  assert.ok(h.scroller.scrollTop > 0 && h.scroller.scrollTop <= 9.6);
  assert.ok(h.reads > reads, "scrolling refreshes the highlighted target");
  const beforeDelayedFrame = h.scroller.scrollTop;
  h.window.tick(5000);
  assert.ok(h.scroller.scrollTop - beforeDelayedFrame <= 19.2, "delayed frames cannot jump far");
  h.scroller.scrollTop = 1400;
  h.window.tick(5016);
  assert.equal(h.scroller.scrollTop, 1400, "never scrolls beyond the content end");
  h.move({ clientY: 225 });
  h.window.tick(5032);
  assert.ok(h.scroller.scrollTop < 1400);
  h.scroller.scrollTop = 0;
  h.window.tick(5048);
  assert.equal(h.scroller.scrollTop, 0);
  h.controller.cancel();
  h.window.tick(5064);
  assert.equal(h.window.frames.size, 0);
});

test("auto-scroll excludes pinned chrome, outside edges, the center and unavailable scroll containers", () => {
  const h = harness({ getScrollBounds: () => ({ top: 220, bottom: 650 }) });
  h.start();
  for (const point of [{ clientY: 150 }, { clientY: 710 }, { clientX: -5, clientY: 645 }, { clientX: 410, clientY: 645 }, { clientY: 400 }]) {
    h.move(point);
    h.window.tick();
    assert.equal(h.scroller.scrollTop, 0);
  }
  h.scroller.remove();
  h.window.tick();
  assert.equal(h.drops.length, 0);
  h.controller.destroy();
  for (const options of [
    { getScrollContainer: () => null },
    { getScrollBounds: () => null },
    { getScrollBounds: () => ({ top: 700, bottom: 200 }) },
  ]) {
    const other = harness(options);
    other.start();
    other.move({ clientY: 695 });
    other.window.tick();
    assert.equal(other.scroller.scrollTop, 0);
    other.controller.destroy();
  }
});

test("default scroll bounds work and documents without a visual viewport remain supported", () => {
  const h = harness();
  Object.assign(h.window, { visualViewport: null });
  h.start();
  h.move({ clientY: 695 });
  h.window.tick();
  assert.ok(h.scroller.scrollTop > 0);
  h.drop();
  assert.equal(h.drops.length, 1);
});

test("capture failures still finish safely through document listeners", () => {
  const h = harness();
  h.handle.failCapture = true;
  h.start();
  h.move();
  h.drop();
  assert.equal(h.drops.length, 1);
  h.handle.failCapture = false;
  h.handle.failRelease = true;
  h.start();
  h.move();
  h.controller.cancel();
  assert.equal(h.document.listenerCount(), 0);
});

test("destroy removes all handle listeners and status, and cannot restart a gesture", () => {
  const h = harness();
  h.controller.registerHandle(html(h.handle), html(h.row), "Subject", () => h.source);
  assert.equal(h.handle.listenerCount(), 4, "re-register replaces old listeners");
  h.start();
  h.move();
  h.controller.destroy();
  h.controller.destroy();
  assert.equal(h.handle.listenerCount(), 0);
  assert.equal(h.document.listenerCount(), 0);
  assert.equal(h.status.isConnected, false);
  assert.equal(h.window.frames.size, 0);
  h.controller.registerHandle(html(h.handle), html(h.row), "Subject", () => h.source);
  assert.equal(h.handle.listenerCount(), 0);
  assert.equal(h.start().defaultPrevented, false);
  h.drop();
  assert.equal(h.drops.length, 0);
});
