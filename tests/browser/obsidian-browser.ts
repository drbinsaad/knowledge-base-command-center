/**
 * Narrow Obsidian host adapter for production-renderer browser tests.
 * Product markup and event handlers come from src/, never copied fixtures.
 * This supplies host DOM helpers only; it is not a real Obsidian/device test.
 */
export * from "../support/obsidian-stub";

interface ElementOptions {
  attr?: Record<string, string>;
  cls?: string | string[];
  text?: string;
  type?: string;
  value?: string;
  placeholder?: string;
}

function createElement(parent: HTMLElement, tag: string, options: ElementOptions | string = {}): HTMLElement {
  const value = typeof options === "string" ? { cls: options } : options;
  const element = parent.ownerDocument.createElement(tag);
  if (value.cls) element.className = Array.isArray(value.cls) ? value.cls.join(" ") : value.cls;
  if (value.text !== undefined) element.textContent = value.text;
  for (const [key, text] of Object.entries(value.attr ?? {})) element.setAttribute(key, text);
  for (const key of ["type", "value", "placeholder"] as const) {
    if (value[key] !== undefined) element.setAttribute(key, value[key]);
  }
  parent.appendChild(element);
  return element;
}

Object.defineProperties(HTMLElement.prototype, {
  createEl: { configurable: true, value(this: HTMLElement, tag: string, options?: ElementOptions) { return createElement(this, tag, options); } },
  createDiv: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return createElement(this, "div", options); } },
  createSpan: { configurable: true, value(this: HTMLElement, options?: ElementOptions) { return createElement(this, "span", options); } },
  empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
  setText: { configurable: true, value(this: HTMLElement, value: string) { this.textContent = value; } },
  addClass: { configurable: true, value(this: HTMLElement, ...values: string[]) { this.classList.add(...values.flatMap((value) => value.split(/\s+/u)).filter(Boolean)); } },
  removeClass: { configurable: true, value(this: HTMLElement, ...values: string[]) { this.classList.remove(...values); } },
  toggleClass: { configurable: true, value(this: HTMLElement, value: string, force?: boolean) { this.classList.toggle(value, force); } },
  hasClass: { configurable: true, value(this: HTMLElement, value: string) { return this.classList.contains(value); } },
  setAttr: { configurable: true, value(this: HTMLElement, key: string, value: string) { this.setAttribute(key, value); } },
});

export class ItemView {
  readonly app: unknown;
  readonly contentEl: HTMLElement;
  constructor(readonly leaf: { app: unknown; contentEl: HTMLElement }) {
    this.app = leaf.app;
    this.contentEl = leaf.contentEl;
  }
  registerDomEvent(target: EventTarget, name: string, callback: EventListener): void { target.addEventListener(name, callback); }
  register(): void {}
}

export class Modal {
  readonly containerEl = document.createElement("div");
  readonly modalEl = this.containerEl.createDiv({ cls: "modal" });
  readonly titleEl = this.modalEl.createEl("h2", { cls: "modal-title" });
  readonly contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  constructor(readonly app: unknown) {
    this.containerEl.className = "modal-container";
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.titleEl.id = `browser-modal-${++modalSequence}`;
    this.modalEl.setAttribute("aria-labelledby", this.titleEl.id);
    const close = this.modalEl.createEl("button", { cls: "modal-close-button", text: "×", type: "button", attr: { "aria-label": "Close" } });
    close.addEventListener("click", () => this.close());
    this.modalEl.addEventListener("keydown", (event) => { if (event.key === "Escape" && !event.defaultPrevented) this.close(); });
  }
  onOpen(): void {}
  onClose(): void {}
  setTitle(title: string): void { this.titleEl.textContent = title; }
  open(): void { document.body.appendChild(this.containerEl); this.onOpen(); }
  close(): void { this.onClose(); this.containerEl.remove(); }
}

let modalSequence = 0;

class TextControl {
  constructor(readonly inputEl: HTMLInputElement | HTMLTextAreaElement) {}
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
  onChange(callback: (value: string) => unknown): this { this.inputEl.addEventListener("input", () => callback(this.inputEl.value)); return this; }
}

class DropdownControl {
  constructor(readonly selectEl: HTMLSelectElement) {}
  addOption(value: string, label: string): this { this.selectEl.add(new Option(label, value)); return this; }
  addOptions(options: Record<string, string>): this { Object.entries(options).forEach(([value, label]) => this.addOption(value, label)); return this; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  setDisabled(value: boolean): this { this.selectEl.disabled = value; return this; }
  onChange(callback: (value: string) => unknown): this { this.selectEl.addEventListener("change", () => callback(this.selectEl.value)); return this; }
}

class ToggleControl {
  constructor(readonly toggleEl: HTMLInputElement) {}
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  setDisabled(value: boolean): this { this.toggleEl.disabled = value; return this; }
  onChange(callback: (value: boolean) => unknown): this { this.toggleEl.addEventListener("change", () => callback(this.toggleEl.checked)); return this; }
}

class SliderControl {
  private instant = true;
  constructor(readonly sliderEl: HTMLInputElement) {}
  setLimits(min: number, max: number, step: number): this { this.sliderEl.min = String(min); this.sliderEl.max = String(max); this.sliderEl.step = String(step); return this; }
  setValue(value: number): this { this.sliderEl.value = String(value); return this; }
  setDisabled(value: boolean): this { this.sliderEl.disabled = value; return this; }
  setInstant(value: boolean): this { this.instant = value; return this; }
  setDynamicTooltip(): this { this.sliderEl.title = this.sliderEl.value; this.sliderEl.addEventListener("input", () => { this.sliderEl.title = this.sliderEl.value; }); return this; }
  onChange(callback: (value: number) => unknown): this { this.sliderEl.addEventListener("input", () => { if (this.instant) callback(Number(this.sliderEl.value)); }); this.sliderEl.addEventListener("change", () => { if (!this.instant) callback(Number(this.sliderEl.value)); }); return this; }
}

class ButtonControl {
  constructor(readonly buttonEl: HTMLButtonElement) {}
  setButtonText(value: string): this { this.buttonEl.textContent = value; return this; }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
  setDestructive(): this { this.buttonEl.classList.add("mod-warning"); return this; }
  setDisabled(value: boolean): this { this.buttonEl.disabled = value; return this; }
  setTooltip(value: string): this { this.buttonEl.title = value; return this; }
  setIcon(value: string): this { setIcon(this.buttonEl, value); return this; }
  onClick(callback: () => unknown): this { this.buttonEl.addEventListener("click", () => callback()); return this; }
}

export class Setting {
  readonly settingEl: HTMLElement;
  readonly infoEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly descEl: HTMLElement;
  readonly controlEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setName(value: string): this { this.nameEl.textContent = value; return this; }
  setDesc(value: string | DocumentFragment): this { this.descEl.replaceChildren(value); return this; }
  setHeading(): this { this.settingEl.classList.add("setting-item-heading"); return this; }
  setClass(value: string): this { this.settingEl.classList.add(value); return this; }
  addText(callback: (control: TextControl) => unknown): this {
    const input = this.controlEl.createEl("input", { type: "text", attr: { "aria-label": this.nameEl.textContent ?? "" } });
    callback(new TextControl(input)); return this;
  }
  addTextArea(callback: (control: TextControl) => unknown): this {
    callback(new TextControl(this.controlEl.createEl("textarea", { attr: { "aria-label": this.nameEl.textContent ?? "" } }))); return this;
  }
  addDropdown(callback: (control: DropdownControl) => unknown): this {
    callback(new DropdownControl(this.controlEl.createEl("select", { attr: { "aria-label": this.nameEl.textContent ?? "" } }))); return this;
  }
  addToggle(callback: (control: ToggleControl) => unknown): this {
    callback(new ToggleControl(this.controlEl.createEl("input", { type: "checkbox", attr: { "aria-label": this.nameEl.textContent ?? "" } }))); return this;
  }
  addSlider(callback: (control: SliderControl) => unknown): this {
    callback(new SliderControl(this.controlEl.createEl("input", { type: "range", attr: { "aria-label": this.nameEl.textContent ?? "" } }))); return this;
  }
  addButton(callback: (control: ButtonControl) => unknown): this {
    callback(new ButtonControl(this.controlEl.createEl("button", { type: "button" }))); return this;
  }
  addExtraButton(callback: (control: ButtonControl) => unknown): this { return this.addButton(callback); }
}

export class FuzzySuggestModal extends Modal {
  setPlaceholder(): void {}
  setInstructions(): void {}
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("aria-hidden", "true");
  const paths: Record<string, string> = {
    "search": "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    "plus": "M12 5v14M5 12h14",
    "chevron-down": "m6 9 6 6 6-6",
    "chevron-right": "m9 6 6 6-6 6",
    "chevrons-up-down": "m8 8 4-4 4 4m-8 8 4 4 4-4",
    "more-horizontal": "M4 12h1m6 0h1m6 0h1",
    "ellipsis": "M4 12h1m6 0h1m6 0h1",
    "file-text": "M14 2H5v20h14V7Zm0 0v6h5M8 13h8M8 17h8",
    "folder": "M2 5h7l2 2h11v14H2Z",
    "library-big": "M3 3v18M8 3v18M13 3v18m4-17 4 16",
    "zap": "m13 2-9 12h7l-1 8 10-12h-8Z",
  };
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", paths[icon] ?? "M4 4h16v16H4ZM8 9h8M8 14h8");
  svg.appendChild(shape);
  element.replaceChildren(svg);
}
