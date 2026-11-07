import assert from "node:assert/strict";
import test from "node:test";
import { Setting } from "obsidian";
import { ConfirmModal, IndexGroupModal, TextPromptModal } from "../src/modals.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

type Click = () => Promise<void> | void;

interface OpenedDialog {
  buttons: Map<string, Click>;
  pressEnter(): void;
  closes: () => number;
}

/** Opens a modal against a stubbed Setting and returns its buttons, Enter key and close count. */
function openDialog(modal: { onOpen(): void }): { dialog: OpenedDialog; restore: () => void } {
  const dom = createFakeDom();
  const buttons = new Map<string, Click>();
  const keydown: Array<(event: { key: string; preventDefault(): void }) => void> = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const stub = (name: string, value: unknown): void => {
    originals.set(name, Object.getOwnPropertyDescriptor(Setting.prototype, name));
    Object.defineProperty(Setting.prototype, name, { configurable: true, value });
  };
  stub("setName", function (this: unknown) { return this; });
  stub("setDesc", function (this: unknown) { return this; });
  stub("addText", function (this: unknown, configure: (control: unknown) => void) {
    const control = {
      inputEl: {
        setAttribute() {},
        focus() {},
        addEventListener(type: string, listener: (event: { key: string; preventDefault(): void }) => void) { if (type === "keydown") keydown.push(listener); },
      },
      setPlaceholder() { return control; },
      setValue() { return control; },
      onChange() { return control; },
    };
    configure(control);
    return this;
  });
  stub("addButton", function (this: unknown, configure: (button: unknown) => void) {
    let label = "";
    const button = {
      setButtonText(text: string) { label = text; return button; },
      setCta() { return button; },
      setDestructive() { return button; },
      setDisabled() { return button; },
      onClick(callback: Click) { buttons.set(label, callback); return button; },
    };
    configure(button);
    return this;
  });
  let closeCount = 0;
  Object.assign(modal, {
    contentEl: asHtmlElement(dom.document.body.createDiv()),
    titleEl: asHtmlElement(dom.document.body.createDiv()),
    close: () => { closeCount += 1; },
  });
  const realError = console.error;
  console.error = () => undefined;
  modal.onOpen();
  return {
    dialog: {
      buttons,
      pressEnter: () => keydown.forEach((listener) => listener({ key: "Enter", preventDefault() {} })),
      closes: () => closeCount,
    },
    restore: () => {
      console.error = realError;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(Setting.prototype, name, descriptor);
        else Reflect.deleteProperty(Setting.prototype, name);
      }
    },
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: Error): void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Case {
  name: string;
  action: string;
  hasEnter: boolean;
  make(run: () => Promise<void>): { onOpen(): void };
}

const cases: Case[] = [
  {
    name: "TextPromptModal", action: "Save", hasEnter: true,
    make: (run) => new TextPromptModal({} as never, { title: "New", placeholder: "Name", initialValue: "Reading", onSubmit: run }),
  },
  {
    name: "ConfirmModal", action: "Delete", hasEnter: false,
    make: (run) => new ConfirmModal({} as never, "Delete?", "Sure?", "Delete", run),
  },
  {
    name: "IndexGroupModal", action: "Move", hasEnter: true,
    make: (run) => new IndexGroupModal({} as never, { title: "Group", groupLabel: "Group", initialValue: "Reading", existingGroups: [], submitLabel: "Move", onSubmit: run }),
  },
];

for (const item of cases) {
  test(`${item.name} runs its action once when submitted twice while pending`, async () => {
    const gate = deferred();
    let calls = 0;
    const { dialog, restore } = openDialog(item.make(() => { calls += 1; return gate.promise; }));
    try {
      const click = dialog.buttons.get(item.action);
      assert.ok(click, "action button exists");
      const first = click();
      if (item.hasEnter) dialog.pressEnter();
      const second = click();
      await flush();
      assert.equal(calls, 1, "action ran once while the first was pending");
      gate.resolve();
      await Promise.all([first, second]);
      await flush();
      assert.equal(calls, 1);
      assert.equal(dialog.closes(), 1, "dialog closed once");
    } finally {
      restore();
    }
  });

  test(`${item.name} accepts another submit after the action failed`, async () => {
    let calls = 0;
    const { dialog, restore } = openDialog(item.make(async () => {
      calls += 1;
      if (calls === 1) throw new Error("first attempt failed");
    }));
    try {
      const click = dialog.buttons.get(item.action);
      assert.ok(click, "action button exists");
      await click();
      assert.equal(calls, 1);
      assert.equal(dialog.closes(), 0, "failed dialog stays open");
      await click();
      assert.equal(calls, 2, "second submit is accepted after the error");
      assert.equal(dialog.closes(), 1);
    } finally {
      restore();
    }
  });
}
