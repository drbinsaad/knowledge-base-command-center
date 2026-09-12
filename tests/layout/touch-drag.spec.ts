import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

// The flow under test is: production mobile workspace -> Arrange/Edit ->
// drag the dedicated handle -> exact organization update -> Undo/Redo.
// Browser plugin not available: use the repository's existing Playwright
// workflow. Chromium CDP injects genuine browser touch input; WebKit uses
// synthetic PointerEvents as supplemental handler coverage, not iOS proof.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let css: string;
let hostCss: string;
const errorsByPage = new WeakMap<Page, string[]>();
test.use({ hasTouch: true });

test.beforeAll(async () => {
  const [built, product, host] = await Promise.all([
    build({ entryPoints: [path.join(root, "tests/browser/view-harness.ts")], bundle: true, write: false,
      format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } }),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  css = product;
  hostCss = host;
});

interface Snapshot {
  mutations: string[];
  undoCount: number;
  redoCount: number;
  unchanged: boolean;
  fingerprint: string;
  parents: Record<string, string | null>;
  groups: Record<string, string>;
  roots: Record<string, string[]>;
  library: Record<string, string[]>;
  collections: Record<string, string[]>;
  subjectGroups: Record<string, string | null>;
  hostSwipeTouches: Array<{ ignored: boolean; handle: boolean; trusted: boolean }>;
}

async function state(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { kbccBrowserHarness: { touchDragSnapshot(): Snapshot } }).kbccBrowserHarness.touchDragSnapshot());
}

async function open(page: Page, { mobile = true, width = 1180, height = 820, extra = 0 } = {}): Promise<void> {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width, height });
  await page.goto(`about:blank#mobile=${mobile}&scenario=touch-drag&extra=${extra}`);
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC touch drag · synthetic vault</title></head><body class="theme-light${mobile ? " is-mobile" : ""}"><main id="kbcc-view" class="view-content"></main></body></html>`);
  await page.addStyleTag({ content: hostCss });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  await expect(page).toHaveTitle("KBCC touch drag · synthetic vault");
  expect(page.url()).toContain("scenario=touch-drag");
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  await expect(page.locator(".ent-cc-subject-title").first()).toBeVisible();
  await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal")).toHaveCount(0);
}

async function evidence(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Touch drag evidence must be outside the repository");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-touch-${name}.png`), fullPage: false });
}

async function options(page: Page): Promise<void> {
  const details = page.locator(".ent-cc-workspace-options");
  if (await details.count() && await details.getAttribute("open") === null) await details.locator("summary").click();
}

async function mode(page: Page, tab: "index" | "library" | "collections" = "index"): Promise<void> {
  if (tab !== "index") await page.getByRole("tab", { name: tab === "library" ? /^Reading\b/u : /^My Collections\b/u }).click();
  await options(page);
  await page.getByRole("button", { name: tab === "collections" ? "Edit" : "Arrange", exact: true }).click();
  const details = page.locator(".ent-cc-workspace-options");
  if (await details.count() && await details.getAttribute("open") !== null) await details.locator("summary").click();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
}

const row = (page: Page, title: string): Locator => page.locator(".ent-cc-subject-row").filter({ has: page.getByRole("button", { name: `Drag ${title}`, exact: true }) });
const heading = (page: Page, title: string): Locator => page.locator(".ent-cc-heading-row, .ent-cc-subheading-row").filter({ has: page.getByRole("button", { name: title, exact: true }) });

type Point = { x: number; y: number };
async function point(target: Locator, fraction = 0.5): Promise<Point> {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Drag target has no visible bounds");
  return { x: bounds.x + bounds.width * 0.6, y: bounds.y + bounds.height * fraction };
}

interface Pointer {
  move(point: Point): Promise<void>;
  end(): Promise<void>;
  cancel(): Promise<void>;
}

async function begin(page: Page, title: string, pointerType: "touch" | "mouse" | "pen" = "touch"): Promise<Pointer> {
  const handle = page.getByRole("button", { name: `Drag ${title}`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const initial = await point(handle);
  let current = initial;
  let cdp: CDPSession | null = null;
  const nativeTouch = pointerType === "touch" && test.info().project.name === "chromium";
  if (nativeTouch) cdp = await page.context().newCDPSession(page);
  const touchPoints = (position: Point) => [{ ...position, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  const dispatch = async (type: string, position: Point): Promise<void> => {
    await page.evaluate(({ type, position, pointerType }) => {
      const target = type === "pointerdown" ? document.elementFromPoint(position.x, position.y) : document;
      target?.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 41, pointerType, isPrimary: true,
        clientX: position.x, clientY: position.y, button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      }));
    }, { type, position, pointerType });
  };
  if (pointerType === "mouse") { await page.mouse.move(initial.x, initial.y); await page.mouse.down(); }
  else if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoints(initial) });
  else await dispatch("pointerdown", initial);
  return {
    async move(destination) {
      // Several real input samples cross the activation threshold naturally.
      const start = current;
      for (let index = 1; index <= 6; index += 1) {
        current = { x: start.x + (destination.x - start.x) * index / 6, y: start.y + (destination.y - start.y) * index / 6 };
        if (pointerType === "mouse") await page.mouse.move(current.x, current.y);
        else if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoints(current) });
        else await dispatch("pointermove", current);
      }
    },
    async end() {
      if (pointerType === "mouse") await page.mouse.up();
      else if (cdp) { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach(); }
      else await dispatch("pointerup", current);
    },
    async cancel() {
      if (pointerType === "mouse") { await page.keyboard.press("Escape"); await page.mouse.up(); }
      else if (cdp) { await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await cdp.detach(); }
      else await dispatch("pointercancel", current);
    },
  };
}

async function move(page: Page, source: string, target: Locator, fraction = 0.5, pointerType: "touch" | "mouse" | "pen" = "touch"): Promise<void> {
  const drag = await begin(page, source, pointerType);
  await drag.move(await point(target, fraction));
  await expect(target).toHaveClass(/is-drop-(inside|target|before|after)/u);
  await drag.end();
}

async function history(page: Page, action: "Undo" | "Redo"): Promise<void> {
  await options(page);
  await page.getByRole("button", { name: `${action} personal organization change`, exact: true }).click();
}

for (const device of [{ name: "iPad", width: 1180, height: 820 }, { name: "iPhone", width: 390, height: 844 }]) {
  test(`${device.name}: touch handle nests Index note and Undo/Redo preserves exact organization`, async ({ page }) => {
    await open(page, device);
    await expect(page.locator(".ent-cc-touch-drag-handle")).toHaveCount(0);
    await mode(page);
    for (const handle of await page.locator(".ent-cc-touch-drag-handle").all()) {
      const bounds = await handle.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await expect(handle).toHaveCSS("touch-action", "none");
      await expect(handle).not.toHaveAttribute("draggable", "true");
    }
    const before = await state(page);
    const drag = await begin(page, "Alpha");
    const target = row(page, "Beta");
    await drag.move(await point(target));
    await expect(target).toHaveClass(/is-drop-inside/u);
    expect((await state(page)).fingerprint).toBe(before.fingerprint);
    await evidence(page, `${device.name}-index-highlight`);
    await drag.end();
    await expect.poll(async () => (await state(page)).parents["Research/Alpha.md"]).toBe("Research/Beta.md");
    const after = await state(page);
    expect(after.mutations).toHaveLength(1);
    expect(after.undoCount).toBe(1);
    expect(after.parents["Research/Child.md"]).toBe("Research/Beta.md");
    await evidence(page, `${device.name}-index-nested`);
    await history(page, "Undo");
    await expect.poll(async () => (await state(page)).fingerprint).toBe(before.fingerprint);
    await history(page, "Redo");
    await expect.poll(async () => (await state(page)).fingerprint).toBe(after.fingerprint);
  });
}

test("iPad trackpad uses the mobile handle to reorder above and below a sibling", async ({ page }) => {
  await open(page);
  await mode(page);
  await move(page, "Gamma", row(page, "Alpha"), 0.1, "mouse");
  await expect.poll(async () => (await state(page)).roots.Research.slice(0, 3)).toEqual(["Research/Gamma.md", "Research/Alpha.md", "Research/Beta.md"]);
  await move(page, "Gamma", row(page, "Beta"), 0.9, "mouse");
  await expect.poll(async () => (await state(page)).roots.Research.slice(0, 3)).toEqual(["Research/Alpha.md", "Research/Beta.md", "Research/Gamma.md"]);
  expect((await state(page)).parents["Research/Gamma.md"]).toBe(null);
});

test("Index touch move into another group retains a nested subtree", async ({ page }) => {
  await open(page);
  await mode(page);
  await move(page, "Beta", heading(page, "Other"));
  await expect.poll(async () => (await state(page)).groups["Research/Beta.md"]).toBe("Other");
  const result = await state(page);
  expect(result.groups["Research/Child.md"]).toBe("Other");
  expect(result.parents["Research/Child.md"]).toBe("Research/Beta.md");
  expect(result.roots.Other).toContain("Research/Beta.md");
});

test("custom Library touch drop supports deep subheading and heading root, exact Undo", async ({ page }) => {
  await open(page);
  await mode(page, "library");
  const before = await state(page);
  await move(page, "Source A", heading(page, "Randomized"));
  await expect.poll(async () => (await state(page)).library.randomized).toEqual(["source-2", "source-0"]);
  expect((await state(page)).library.sources).toEqual(["source-1"]);
  await evidence(page, "iPad-library-deep-placement");
  await history(page, "Undo");
  await expect.poll(async () => (await state(page)).fingerprint).toBe(before.fingerprint);
  // Collapse the options panel after Undo so the deep handle is not obscured.
  const details = page.locator(".ent-cc-workspace-options");
  if (await details.getAttribute("open") !== null) await details.locator("summary").click();
  await move(page, "Source C", heading(page, "Sources"), 0.5, "mouse");
  await expect.poll(async () => (await state(page)).library.sources).toEqual(["source-0", "source-1", "source-2"]);
  expect((await state(page)).library.randomized).toEqual([]);
});

test("custom Library pen handle reorders records without changing the Library", async ({ page }) => {
  await open(page);
  await mode(page, "library");
  await move(page, "Source B", row(page, "Source A"), 0.1, "pen");
  await expect.poll(async () => (await state(page)).library.sources).toEqual(["source-1", "source-0"]);
  expect((await state(page)).library.randomized).toEqual(["source-2"]);
});

test("unplaced Library note can be dragged to another heading with matching catalog semantics", async ({ page }) => {
  await open(page, { height: 1100 });
  await mode(page, "library");
  const before = await state(page);
  await move(page, "Source D", heading(page, "References"));
  await expect.poll(async () => (await state(page)).library.references).toEqual(["source-3"]);
  expect((await state(page)).subjectGroups["source-3"]).toBe("References");
  await history(page, "Undo");
  await expect.poll(async () => (await state(page)).fingerprint).toBe(before.fingerprint);
});

test("Collections touch drag changes only the selected membership and Undo restores it", async ({ page }) => {
  await open(page);
  await mode(page, "collections");
  const before = await state(page);
  await move(page, "Alpha", heading(page, "Next"));
  await expect.poll(async () => (await state(page)).collections.next).toEqual(["Research/Gamma.md", "Research/Alpha.md"]);
  const after = await state(page);
  expect(after.collections.favorites).toEqual(["Research/Beta.md"]);
  expect(after.parents).toEqual(before.parents);
  expect(after.library).toEqual(before.library);
  await evidence(page, "iPad-collection-placement");
  await history(page, "Undo");
  await expect.poll(async () => (await state(page)).fingerprint).toBe(before.fingerprint);
});

test("handle tap, pointer cancellation and invalid cyclic targets never mutate", async ({ page }) => {
  await open(page);
  await mode(page);
  const tap = await begin(page, "Alpha");
  await tap.end();
  expect((await state(page)).mutations).toEqual([]);
  const cancelled = await begin(page, "Alpha");
  await cancelled.move(await point(row(page, "Beta")));
  await expect(row(page, "Beta")).toHaveClass(/is-drop-inside/u);
  await cancelled.cancel();
  await expect(page.locator(".is-dragging, .is-drop-inside, .is-drop-before, .is-drop-after")).toHaveCount(0);
  expect((await state(page)).mutations).toEqual([]);
  const cyclic = await begin(page, "Beta");
  await cyclic.move(await point(row(page, "Child")));
  await expect(row(page, "Child")).not.toHaveClass(/is-drop-(inside|before|after)/u);
  await cyclic.end();
  expect((await state(page)).unchanged).toBe(true);
});

test("refresh during a live touch drag invalidates its source and never commits stale input", async ({ page }) => {
  await open(page);
  await mode(page);
  const drag = await begin(page, "Alpha");
  await drag.move(await point(row(page, "Beta")));
  await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { refresh(replace: boolean): Promise<void> } }).kbccBrowserHarness.refresh(true));
  await drag.end();
  expect((await state(page)).mutations).toEqual([]);
  await expect(page.locator(".is-dragging, .is-drop-inside, .is-drop-before, .is-drop-after")).toHaveCount(0);
});

test("Escape cancels trackpad drag and releasing outside the tree is a no-op", async ({ page }) => {
  await open(page);
  await mode(page);
  const drag = await begin(page, "Alpha", "mouse");
  await drag.move(await point(row(page, "Beta")));
  await page.keyboard.press("Escape");
  await drag.end();
  expect((await state(page)).mutations).toEqual([]);
  const outside = await begin(page, "Alpha", "mouse");
  await outside.move({ x: 25, y: 10 });
  await outside.end();
  expect((await state(page)).unchanged).toBe(true);
});

test("mobile handle auto-scrolls the workspace while keeping the fixed search rail visible", async ({ page }) => {
  await open(page, { extra: 80 });
  await mode(page);
  const workspace = page.locator(".ent-cc-workspace");
  const drag = await begin(page, "Alpha", "mouse");
  const bounds = await workspace.boundingBox();
  if (!bounds) throw new Error("Workspace not rendered");
  await drag.move({ x: bounds.x + bounds.width / 2, y: Math.min(812, bounds.y + bounds.height - 10) });
  await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(120);
  await expect(page.locator(".ent-cc-mobile-toolbar")).toBeInViewport();
  await evidence(page, "iPad-autoscroll");
  await drag.cancel();
  expect((await state(page)).mutations).toEqual([]);
  const stopped = await workspace.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(100);
  expect(await workspace.evaluate((element) => element.scrollTop)).toBe(stopped);
});

test("ordinary mobile scrolling retains pan behavior outside dedicated handles", async ({ page }) => {
  await open(page, { extra: 80 });
  await mode(page);
  await expect(page.locator(".ent-cc-workspace")).not.toHaveCSS("touch-action", "none");
  await expect(row(page, "Alpha")).not.toHaveCSS("touch-action", "none");
  if (test.info().project.name === "chromium") {
    const session = await page.context().newCDPSession(page);
    const start = { x: 700, y: 680 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    for (let index = 1; index <= 10; index += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x, y: start.y - index * 28, id: 1 }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    // WebKit cannot inject native continuous touch through Playwright; verify
    // normal wheel/pan scrolling plus CSS eligibility, not a claimed iOS swipe.
    await page.mouse.move(700, 680);
    await page.mouse.wheel(0, 320);
  }
  await expect.poll(() => page.locator(".ent-cc-workspace").evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect((await state(page)).mutations).toEqual([]);
  await expect(page.locator(".is-dragging")).toHaveCount(0);
});

test("host-swipe opt-out applies only to drag grips while ordinary touch still reaches the ancestor", async ({ page }) => {
  await open(page, { extra: 80 });
  await mode(page);
  const handle = page.getByRole("button", { name: "Drag Alpha", exact: true });
  await expect(handle).toHaveAttribute("data-ignore-swipe", "true");
  await expect(page.locator("[data-ignore-swipe]:not(.ent-cc-touch-drag-handle)")).toHaveCount(0);
  const target = await point(handle);
  // A native tap generates trusted touchstart in both engines, including its
  // bubbling ancestor phase. No synthetic pointer event stands in for it.
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => (await state(page)).hostSwipeTouches).toEqual([
    { ignored: true, handle: true, trusted: true },
  ]);
  if (test.info().project.name === "chromium") {
    const session = await page.context().newCDPSession(page);
    const start = await point(row(page, "Alpha").locator(".ent-cc-subject-title"));
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    for (let index = 1; index <= 10; index += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x, y: start.y - index * 22, id: 1 }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    // WebKit supports native taps, but continuous native touch injection is
    // unavailable here. Tap a non-action row margin, then verify wheel scroll.
    const bounds = await row(page, "Alpha").boundingBox();
    if (!bounds) throw new Error("Ordinary row target is missing");
    await page.touchscreen.tap(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.move(700, 680);
    await page.mouse.wheel(0, 320);
  }
  await expect.poll(async () => (await state(page)).hostSwipeTouches).toEqual([
    { ignored: true, handle: true, trusted: true },
    { ignored: false, handle: false, trusted: true },
  ]);
  await expect.poll(() => page.locator(".ent-cc-workspace").evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect((await state(page)).mutations).toEqual([]);
});

test("desktop keeps native HTML dragging and never enables touch handles", async ({ page }) => {
  await open(page, { mobile: false, width: 1440, height: 960 });
  await mode(page);
  await expect(page.locator(".ent-cc-touch-drag-handle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drag Alpha", exact: true })).toHaveAttribute("draggable", "true");
  await evidence(page, "desktop-native-handles");
  await page.getByRole("button", { name: "Drag Alpha", exact: true }).dragTo(row(page, "Beta"));
  await expect.poll(async () => (await state(page)).parents["Research/Alpha.md"]).toBe("Research/Beta.md");
});

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page) ?? [], "Production renderer has no console warnings/errors or uncaught errors").toEqual([]);
});
