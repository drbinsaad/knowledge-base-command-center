import { Setting } from "obsidian";

/** One recorded Setting row: its name, current description and the controls a test can drive. */
export interface RecordedRow {
  name: string;
  desc: string;
  texts: Array<{ value: string; type: (next: string) => void; inputEl: { classes: Set<string>; attrs: Map<string, string> } }>;
  buttons: Map<string, () => void | Promise<void>>;
  dropdowns: Array<{ value: string; choose: (next: string) => void }>;
}

type Patched = "setName" | "setDesc" | "addText" | "addButton" | "addDropdown";

/**
 * Replaces the empty test-stub Setting with a recorder for the duration of a
 * test body. Rows are kept in call order so assertions can look them up by name.
 * This is a test seam only: it never reaches production code.
 */
export function recordSettings(): { rows: RecordedRow[]; restore: () => void } {
  const rows: RecordedRow[] = [];
  const byInstance = new WeakMap<object, RecordedRow>();
  const rowOf = (instance: object): RecordedRow => {
    let row = byInstance.get(instance);
    if (!row) {
      row = { name: "", desc: "", texts: [], buttons: new Map(), dropdowns: [] };
      byInstance.set(instance, row);
      rows.push(row);
    }
    return row;
  };
  const originals = new Map<Patched, PropertyDescriptor | undefined>();
  const patch = (name: Patched, value: (this: object, ...args: never[]) => unknown): void => {
    originals.set(name, Object.getOwnPropertyDescriptor(Setting.prototype, name));
    Object.defineProperty(Setting.prototype, name, { configurable: true, writable: true, value });
  };
  patch("setName", function (this: object, name: string) { rowOf(this).name = name; return this; });
  patch("setDesc", function (this: object, desc: string) { rowOf(this).desc = desc; return this; });
  patch("addText", function (this: object, configure: (control: unknown) => void) {
    const row = rowOf(this);
    let handler: (value: string) => void = () => undefined;
    const inputEl = {
      classes: new Set<string>(),
      attrs: new Map<string, string>(),
      dir: "",
      maxLength: 0,
      setAttribute(name: string, value: string) { this.attrs.set(name, value); },
      toggleClass(name: string, force: boolean) { if (force) this.classes.add(name); else this.classes.delete(name); },
      addEventListener() { /* keyboard wiring is not under test */ },
      focus() { /* focus is not under test */ },
    };
    const entry = { value: "", type(next: string) { entry.value = next; handler(next); }, inputEl };
    const control = {
      inputEl,
      setPlaceholder() { return control; },
      setValue(value: string) { entry.value = value; return control; },
      setDisabled() { return control; },
      onChange(callback: (value: string) => void) { handler = callback; return control; },
    };
    row.texts.push(entry);
    configure(control);
    return this;
  });
  patch("addButton", function (this: object, configure: (button: unknown) => void) {
    const row = rowOf(this);
    let label = "";
    const button = {
      buttonEl: { setAttribute() { /* label wiring is not under test */ } },
      setButtonText(text: string) { label = text; return button; },
      setCta() { return button; },
      setDestructive() { return button; },
      setDisabled() { return button; },
      onClick(callback: () => void | Promise<void>) { row.buttons.set(label, callback); return button; },
    };
    configure(button);
    return this;
  });
  patch("addDropdown", function (this: object, configure: (dropdown: unknown) => void) {
    const row = rowOf(this);
    let handler: (value: string) => void = () => undefined;
    const entry = { value: "", choose(next: string) { entry.value = next; handler(next); } };
    const dropdown = {
      addOptions() { return dropdown; },
      setValue(value: string) { entry.value = value; return dropdown; },
      setDisabled() { return dropdown; },
      onChange(callback: (value: string) => void) { handler = callback; return dropdown; },
    };
    row.dropdowns.push(entry);
    configure(dropdown);
    return this;
  });
  return {
    rows,
    restore: () => {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(Setting.prototype, name, descriptor);
        else Reflect.deleteProperty(Setting.prototype, name);
      }
    },
  };
}
