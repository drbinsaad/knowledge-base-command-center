type FakeListener = (event: FakeEvent) => void;

export interface FakeEventInit {
  clientY?: number;
  ctrlKey?: boolean;
  key?: string;
  metaKey?: boolean;
  relatedTarget?: FakeElement | null;
  shiftKey?: boolean;
}

export class FakeEvent {
  readonly clientY: number;
  readonly ctrlKey: boolean;
  defaultPrevented = false;
  readonly key: string;
  readonly metaKey: boolean;
  propagationStopped = false;
  readonly relatedTarget: FakeElement | null;
  readonly shiftKey: boolean;
  target: FakeElement | null = null;
  currentTarget: FakeElement | null = null;

  constructor(readonly type: string, init: FakeEventInit = {}) {
    this.clientY = init.clientY ?? 0;
    this.ctrlKey = init.ctrlKey ?? false;
    this.key = init.key ?? "";
    this.metaKey = init.metaKey ?? false;
    this.relatedTarget = init.relatedTarget ?? null;
    this.shiftKey = init.shiftKey ?? false;
  }

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
}

class FakeClassList {
  private readonly values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens.flatMap((value) => value.split(/\s+/)).filter(Boolean)) this.values.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens.flatMap((value) => value.split(/\s+/)).filter(Boolean)) this.values.delete(token);
  }

  contains(token: string): boolean { return this.values.has(token); }

  toggle(token: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(token);
    if (enabled) this.values.add(token);
    else this.values.delete(token);
    return enabled;
  }

  toString(): string { return [...this.values].join(" "); }
}

class FakeStyle {
  private readonly values = new Map<string, string>();

  getPropertyValue(name: string): string { return this.values.get(name) ?? ""; }
  removeProperty(name: string): string {
    const previous = this.getPropertyValue(name);
    this.values.delete(name);
    return previous;
  }
  setProperty(name: string, value: string): void { this.values.set(name, value); }
}

export interface FakeElementOptions {
  attr?: Record<string, string>;
  cls?: string;
  placeholder?: string;
  text?: string;
  type?: string;
  value?: string;
}

interface FakeRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
  x: number;
  y: number;
}

function descendants(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  for (const child of root.children) {
    found.push(child, ...descendants(child));
  }
  return found;
}

function matchesSimpleSelector(element: FakeElement, selector: string): boolean {
  const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
  const withoutAttributes = selector.replace(/\[[^\]]+\]/g, "");
  const tag = withoutAttributes.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  const classes = [...withoutAttributes.matchAll(/\.([a-z0-9_-]+)/gi)].map((match) => match[1]);
  if (classes.some((className) => !element.classList.contains(className))) return false;
  return attributes.every((match) => {
    const [, name, expected] = match;
    if (!element.hasAttribute(name)) return false;
    return expected === undefined || element.getAttribute(name) === expected;
  });
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || !matchesSimpleSelector(element, parts.at(-1) ?? "")) return false;
  let ancestor = element.parentElement;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) ancestor = ancestor.parentElement;
    if (!ancestor) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

export class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  clientHeight = 0;
  disabled = false;
  draggable = false;
  hidden = false;
  parentElement: FakeElement | null = null;
  placeholder = "";
  scrollTop = 0;
  scrollIntoViewCalls = 0;
  type = "";
  value = "";
  private ownText = "";
  private readonly listeners = new Map<string, FakeListener[]>();
  private rect: FakeRect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 };

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string, options: FakeElementOptions = {}) {
    if (options.cls) this.addClass(options.cls);
    if (options.text !== undefined) this.ownText = options.text;
    if (options.type !== undefined) {
      this.type = options.type;
      this.setAttribute("type", options.type);
    }
    if (options.value !== undefined) this.value = options.value;
    if (options.placeholder !== undefined) this.placeholder = options.placeholder;
    for (const [name, value] of Object.entries(options.attr ?? {})) this.setAttribute(name, value);
  }

  get className(): string { return this.classList.toString(); }
  get offsetParent(): FakeElement | null { return this.parentElement; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.empty(); this.ownText = value; }

  addClass(...tokens: string[]): void { this.classList.add(...tokens); }
  removeClass(...tokens: string[]): void { this.classList.remove(...tokens); }
  hasClass(token: string): boolean { return this.classList.contains(token); }
  toggleClass(token: string, force?: boolean): boolean { return this.classList.toggle(token, force); }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, init: FakeEventInit = {}): FakeEvent {
    const event = new FakeEvent(type, init);
    event.target = this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  click(): void { this.dispatch("click"); }
  focus(_options?: FocusOptions): void {
    this.ownerDocument.activeElement = this;
    this.dispatch("focus");
  }
  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this.dispatch("blur");
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  createEl(tag: string, options: FakeElementOptions = {}): FakeElement {
    return this.appendChild(new FakeElement(this.ownerDocument, tag, options));
  }
  createDiv(options: FakeElementOptions = {}): FakeElement {
    return this.appendChild(new FakeElement(this.ownerDocument, "div", options));
  }
  createSpan(options: FakeElementOptions = {}): FakeElement {
    return this.appendChild(new FakeElement(this.ownerDocument, "span", options));
  }

  contains(candidate: unknown): boolean {
    return candidate === this || (candidate instanceof FakeElement && descendants(this).includes(candidate));
  }

  empty(): void {
    this.children.splice(0);
    this.ownText = "";
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  setText(value: string): void { this.textContent = value; }
  scrollIntoView(_options?: ScrollIntoViewOptions): void { this.scrollIntoViewCalls += 1; }

  getBoundingClientRect(): DOMRect {
    return { ...this.rect, toJSON: () => ({ ...this.rect }) };
  }

  setBoundingClientRect(rect: Partial<FakeRect>): void {
    this.rect = { ...this.rect, ...rect };
    if (rect.height === undefined && rect.top !== undefined && rect.bottom !== undefined) {
      this.rect.height = rect.bottom - rect.top;
    }
    if (rect.width === undefined && rect.left !== undefined && rect.right !== undefined) {
      this.rect.width = rect.right - rect.left;
    }
  }

  querySelector(selector: string): FakeElement | null {
    return descendants(this).find((element) => matchesSelector(element, selector)) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return descendants(this).filter((element) => matchesSelector(element, selector));
  }
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

export class FakeVisualViewport extends FakeEventTarget {
  height = 844;
  offsetTop = 0;
}

export class FakeWindow extends FakeEventTarget {
  activeWindow: FakeWindow = this;
  document: FakeDocument | null = null;
  innerHeight = 844;
  readonly visualViewport = new FakeVisualViewport();
  private nextTimerId = 1;

  clearTimeout(_id: number): void {}
  matchMedia(_query: string): { matches: boolean } { return { matches: true }; }
  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    callback(0);
    return id;
  }
  setTimeout(callback: TimerHandler, _delay?: number): number {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    if (typeof callback === "function") callback();
    return id;
  }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly body: FakeElement;

  constructor(readonly defaultView: FakeWindow) {
    defaultView.document = this;
    this.body = new FakeElement(this, "body");
  }

  createElement(tag: string, options: FakeElementOptions = {}): FakeElement {
    return new FakeElement(this, tag, options);
  }
}

export function createFakeDom(): { document: FakeDocument; window: FakeWindow } {
  const window = new FakeWindow();
  return { document: new FakeDocument(window), window };
}

export function asHtmlElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}
