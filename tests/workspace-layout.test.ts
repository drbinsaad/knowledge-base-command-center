import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedInspectorWidth,
  DEFAULT_INSPECTOR_WIDTH,
  inspectorWidthBounds,
  keyboardInspectorWidth,
  loadWorkspaceLayoutPreference,
  parseWorkspaceLayoutPreference,
  saveWorkspaceLayoutPreference,
  WORKSPACE_LAYOUT_LOCAL_KEY,
  WorkspaceResizeController,
} from "../src/workspace-layout.ts";

function event(type: string, values: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), values);
}

function harness(width = 1440, rtl = false, preferredWidth = DEFAULT_INSPECTOR_WIDTH) {
  let workspaceWidth = width;
  let focused = false;
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const captures: number[] = [];
  const releases: number[] = [];
  const committed: number[] = [];
  const owner = Object.assign(new EventTarget(), { getComputedStyle: () => ({ direction: rtl ? "rtl" : "ltr" }) });
  const ownerDocument = { defaultView: owner };
  const workspace = {
    ownerDocument,
    getBoundingClientRect: () => ({ width: workspaceWidth }),
    style: { setProperty: (key: string, value: string) => properties.set(key, value) },
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
  };
  const separator = Object.assign(new EventTarget(), {
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    focus: () => { focused = true; },
    setPointerCapture: (id: number) => captures.push(id),
    releasePointerCapture: (id: number) => releases.push(id),
  });
  const controller = new WorkspaceResizeController(workspace as unknown as HTMLElement, separator as unknown as HTMLElement, preferredWidth, (next) => committed.push(next));
  return {
    controller, owner, ownerDocument, separator, attributes, classes, captures, releases, committed,
    focused: () => focused,
    width: () => Number.parseFloat(properties.get("--ent-cc-inspector-width") ?? ""),
    resize: (next: number) => { workspaceWidth = next; controller.refresh(); },
    down: (clientX = 1000, pointerId = 1) => separator.dispatchEvent(event("pointerdown", { clientX, pointerId, button: 0, isPrimary: true })),
    move: (clientX: number, pointerId = 1) => owner.dispatchEvent(event("pointermove", { clientX, pointerId })),
    up: (clientX: number, pointerId = 1) => owner.dispatchEvent(event("pointerup", { clientX, pointerId })),
  };
}

test("layout preferences accept only finite bounded widths, literal booleans and the supported version", () => {
  for (const value of [null, [], false, { version: 2, inspectorWidth: 700, tabletSplit: true }]) {
    assert.deepEqual(parseWorkspaceLayoutPreference(value), { inspectorWidth: 380, tabletSplit: false });
  }
  for (const inspectorWidth of [NaN, Infinity, -Infinity, "500", undefined]) {
    assert.equal(parseWorkspaceLayoutPreference({ version: 1, inspectorWidth }).inspectorWidth, 380);
  }
  assert.deepEqual(parseWorkspaceLayoutPreference({ version: 1, inspectorWidth: -5, tabletSplit: "true" }), { inspectorWidth: 320, tabletSplit: false });
  assert.deepEqual(parseWorkspaceLayoutPreference({ version: 1, inspectorWidth: 9000, tabletSplit: true, data: "ignored" }), { inspectorWidth: 2000, tabletSplit: true });
  assert.equal(parseWorkspaceLayoutPreference({ version: 1, inspectorWidth: 450.8 }).inspectorWidth, 451);
});

test("layout preferences use only the separate local key and survive a new view on the same device", () => {
  const values = new Map<string, unknown>();
  const storage = { loadLocalStorage: (key: string) => values.get(key), saveLocalStorage: (key: string, value: unknown) => { values.set(key, value); } };
  assert.equal(saveWorkspaceLayoutPreference(storage, { inspectorWidth: 544, tabletSplit: true }), true);
  assert.deepEqual([...values.keys()], [WORKSPACE_LAYOUT_LOCAL_KEY]);
  assert.deepEqual(loadWorkspaceLayoutPreference(storage), { inspectorWidth: 544, tabletSplit: true });
  assert.deepEqual(loadWorkspaceLayoutPreference({ loadLocalStorage: () => null }), { inspectorWidth: 380, tabletSplit: false }, "another device keeps its own default");
});

test("missing or failed local storage does not prevent a session layout", () => {
  assert.deepEqual(loadWorkspaceLayoutPreference({}), { inspectorWidth: 380, tabletSplit: false });
  assert.deepEqual(loadWorkspaceLayoutPreference({ loadLocalStorage: () => { throw new Error("unavailable"); } }), { inspectorWidth: 380, tabletSplit: false });
  assert.equal(saveWorkspaceLayoutPreference({}, { inspectorWidth: 400, tabletSplit: true }), false);
  assert.equal(saveWorkspaceLayoutPreference({ saveLocalStorage: () => { throw new Error("quota"); } }, { inspectorWidth: 400, tabletSplit: true }), false);
});

test("bounds protect both panels and reject non-finite measurements", () => {
  assert.deepEqual(inspectorWidthBounds(1050), { min: 320, max: 506 });
  assert.deepEqual(inspectorWidthBounds(1440), { min: 320, max: 896 });
  assert.deepEqual(inspectorWidthBounds(NaN), { min: 320, max: 320 });
  assert.deepEqual(inspectorWidthBounds(9000), { min: 320, max: 2000 });
  assert.equal(boundedInspectorWidth(900, 1050), 506);
  assert.equal(boundedInspectorWidth(1, 1440), 320);
  assert.equal(boundedInspectorWidth(NaN, 1440), 380);
});

test("keyboard sizing is bounded, RTL-aware, and supports Home, End and a larger Shift step", () => {
  assert.equal(keyboardInspectorWidth("ArrowLeft", 380, 1440, false), 396);
  assert.equal(keyboardInspectorWidth("ArrowRight", 380, 1440, false), 364);
  assert.equal(keyboardInspectorWidth("ArrowLeft", 380, 1440, true), 364);
  assert.equal(keyboardInspectorWidth("ArrowRight", 380, 1440, true, true), 428);
  assert.equal(keyboardInspectorWidth("Home", 500, 1440, false), 320);
  assert.equal(keyboardInspectorWidth("End", 500, 1440, false), 896);
  assert.equal(keyboardInspectorWidth("ArrowRight", 320, 1440, false), 320);
  assert.equal(keyboardInspectorWidth("Enter", 500, 1440, false), null);
});

test("separator exposes correct range and reflects keyboard changes without rebuilding its DOM", () => {
  const h = harness();
  assert.equal(h.attributes.get("role"), "separator");
  assert.equal(h.attributes.get("aria-orientation"), "vertical");
  assert.equal(h.attributes.get("aria-valuenow"), "380");
  const key = event("keydown", { key: "ArrowLeft" });
  h.separator.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(h.width(), 396);
  assert.deepEqual(h.committed, [396]);
  assert.equal(h.attributes.get("aria-valuetext"), "396 pixels wide");
  h.separator.dispatchEvent(event("keydown", { key: "ArrowLeft", ctrlKey: true }));
  h.separator.dispatchEvent(event("keydown", { key: "Enter" }));
  assert.deepEqual(h.committed, [396]);
  h.controller.dispose();
});

test("pointer resizing captures one pointer, persists only on release, and ignores unrelated pointers", () => {
  const h = harness();
  h.down();
  assert.equal(h.focused(), true);
  assert.deepEqual(h.captures, [1]);
  assert.equal(h.classes.has("is-resizing-inspector"), true);
  h.move(800, 2);
  h.up(800, 2);
  assert.equal(h.width(), 380);
  h.move(900);
  assert.equal(h.width(), 480);
  assert.deepEqual(h.committed, []);
  h.up(850);
  assert.equal(h.width(), 530);
  assert.deepEqual(h.committed, [530]);
  assert.deepEqual(h.releases, [1]);
  assert.equal(h.classes.has("is-resizing-inspector"), false);
  h.move(500);
  assert.equal(h.width(), 530);
  h.controller.dispose();
});

test("pointer cancellation, lost capture, blur and Escape restore the pre-drag preference", () => {
  for (const cancel of ["pointercancel", "lostpointercapture", "blur", "Escape"]) {
    const h = harness();
    h.down();
    h.move(800);
    if (cancel === "Escape") h.separator.dispatchEvent(event("keydown", { key: "Escape" }));
    else if (cancel === "lostpointercapture") h.separator.dispatchEvent(event(cancel, { pointerId: 1 }));
    else h.owner.dispatchEvent(event(cancel, { pointerId: 1 }));
    assert.equal(h.width(), 380, cancel);
    assert.deepEqual(h.committed, [], cancel);
    h.up(500);
    assert.deepEqual(h.committed, [], `${cancel} removes pointerup listener`);
    h.controller.dispose();
  }
});

test("RTL pointer movement, boundary clamping and reset use the actual workspace width", () => {
  const h = harness(1050, true);
  h.down(600);
  h.move(700);
  assert.equal(h.width(), 480);
  h.up(1000);
  assert.equal(h.width(), 506);
  h.controller.reset();
  assert.equal(h.width(), 380);
  assert.deepEqual(h.committed, [506, 380]);
  h.controller.dispose();
});

test("temporary narrow or hidden panes do not replace the saved preferred width", () => {
  const h = harness(1440, false, 700);
  h.resize(1050);
  assert.equal(h.width(), 506);
  h.resize(0);
  assert.equal(h.width(), 320);
  h.resize(1440);
  assert.equal(h.width(), 700);
  assert.deepEqual(h.committed, []);
  h.controller.dispose();
});

test("explicit narrower and wider actions provide a bounded alternative to dragging", () => {
  const h = harness(1050);
  h.controller.adjust(48);
  assert.equal(h.width(), 428);
  h.controller.adjust(-48);
  assert.equal(h.width(), 380);
  h.controller.adjust(1000);
  assert.equal(h.width(), 506);
  h.controller.adjust(NaN);
  assert.deepEqual(h.committed, [428, 380, 506]);
  h.controller.dispose();
});

test("a wide-monitor maximum survives saving and reopening without a width change", () => {
  const h = harness(3840);
  h.separator.dispatchEvent(event("keydown", { key: "End" }));
  assert.equal(h.width(), 2000);
  let stored: unknown = null;
  const storage = { loadLocalStorage: () => stored, saveLocalStorage: (_key: string, value: unknown) => { stored = value; } };
  saveWorkspaceLayoutPreference(storage, { inspectorWidth: h.width(), tabletSplit: false });
  const restored = harness(3840, false, loadWorkspaceLayoutPreference(storage).inspectorWidth);
  assert.equal(restored.width(), h.width());
  h.controller.dispose();
  restored.controller.dispose();
});

test("disposing during a drag removes old-window handlers, even after adoption to another window", () => {
  const h = harness();
  h.down();
  h.move(800);
  h.ownerDocument.defaultView = Object.assign(new EventTarget(), { getComputedStyle: () => ({ direction: "ltr" }) });
  h.controller.dispose();
  assert.equal(h.width(), 380);
  h.up(500);
  h.separator.dispatchEvent(event("keydown", { key: "End" }));
  h.down();
  assert.equal(h.width(), 380);
  assert.deepEqual(h.committed, []);
});

test("secondary, non-primary and invalid pointer events cannot start a resize", () => {
  const h = harness();
  for (const values of [{ button: 2, isPrimary: true, clientX: 1000 }, { button: 0, isPrimary: false, clientX: 1000 }, { button: 0, isPrimary: true, clientX: NaN }]) {
    h.separator.dispatchEvent(event("pointerdown", { pointerId: 1, ...values }));
    h.move(500);
    h.up(500);
  }
  assert.equal(h.focused(), false);
  assert.equal(h.width(), 380);
  assert.deepEqual(h.committed, []);
  h.controller.dispose();
});
