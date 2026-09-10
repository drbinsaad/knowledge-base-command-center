import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let rendererBundle: string;
let productStyles: string;
let hostStyles: string;
const failures = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  const [bundle, styles, host] = await Promise.all([
    build({
      entryPoints: [path.join(root, "tests/browser/view-harness.ts")],
      bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
      alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") },
    }),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  rendererBundle = bundle.outputFiles[0]?.text ?? "";
  expect(rendererBundle).toContain("EntVaultCommandCenterView");
  productStyles = styles;
  hostStyles = host;
});

async function openView(page: Page, options: { mobile?: boolean; dark?: boolean; count?: number; phoneChrome?: boolean; width?: number; height?: number; largeText?: boolean } = {}): Promise<void> {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: options.width ?? (options.mobile ? 390 : 1440), height: options.height ?? (options.mobile ? 844 : 960) });
  await page.goto(`about:blank#mobile=${Boolean(options.mobile)}&count=${options.count ?? 650}${options.phoneChrome ? "&scenario=mobile-space" : ""}`);
  const content = '<main id="kbcc-view" class="view-content"></main>';
  const host = options.phoneChrome ? `<div class="kbcc-browser-phone-frame"><header class="kbcc-browser-app-chrome" aria-label="Synthetic top app chrome">Obsidian host space · synthetic fixture</header>${content}<footer class="kbcc-browser-app-chrome" aria-label="Synthetic bottom app toolbar">App toolbar · outside the plugin</footer></div>` : content;
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC production renderer · synthetic vault</title></head><body class="${options.dark ? "theme-dark" : "theme-light"}${options.mobile ? " is-mobile" : ""}${options.largeText ? " kbcc-browser-large-text" : ""}">${host}</body></html>`);
  await page.addStyleTag({ content: hostStyles });
  await page.addStyleTag({ content: productStyles });
  await page.addScriptTag({ content: rendererBundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  await expect(page).toHaveTitle("KBCC production renderer · synthetic vault");
  if (!options.mobile && !options.phoneChrome) await expect(page.getByRole("heading", { name: "Research workspace", exact: true })).toBeVisible();
  if (options.mobile) await expect(page.locator(".ent-cc-base-switcher-name")).toHaveText(options.phoneChrome ? "My knowledge base" : "Research workspace");
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
}

async function refresh(page: Page, replaceData = false): Promise<void> {
  await page.evaluate((replace) => (window as unknown as { kbccBrowserHarness: { refresh(replaceData: boolean): Promise<void> } }).kbccBrowserHarness.refresh(replace), replaceData);
}

async function openModal(page: Page, kind: "note" | "setup" | "export" | "sync" | "organizer" | "whats-new"): Promise<void> {
  await page.evaluate((value) => (window as unknown as { kbccBrowserHarness: { openModal(kind: string): void } }).kbccBrowserHarness.openModal(value), kind);
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Browser screenshot evidence must use an absolute directory outside the repository.");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-${name}.png`), fullPage: false });
}

async function clickRenderedCenter(page: Page, target: Locator, touch = false): Promise<void> {
  const rect = await target.boundingBox();
  if (!rect) throw new Error("Pointer target has no visible bounds");
  expect(await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  }), "Rendered pointer target must be unobscured").toBe(true);
  // Locator actions can recenter sticky controls using their normal-flow box;
  // preserve the real user's scroll position and use the verified screen point.
  if (touch) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function openSettings(page: Page, options: { readOnly?: boolean; reviewUnavailable?: boolean; noLibraries?: boolean; holdSave?: boolean } = {}): Promise<void> {
  await page.evaluate((value) => (window as unknown as { kbccBrowserHarness: { openSettings(options: typeof value): void } }).kbccBrowserHarness.openSettings(value), options);
  await expect(page.getByRole("main", { name: "Settings test host" })).toBeVisible();
}

function settingsRow(page: Page, name: string) {
  return page.locator(".setting-item").filter({ has: page.locator(".setting-item-name").getByText(name, { exact: true }) });
}

async function settingsSnapshot(page: Page): Promise<{ reviews: string[]; unlinked: string[]; kept: string[]; saves: number }> {
  return page.evaluate(() => (window as unknown as { kbccBrowserHarness: { settingsSnapshot(): { reviews: string[]; unlinked: string[]; kept: string[]; saves: number } } }).kbccBrowserHarness.settingsSnapshot());
}

async function mobileBrowseGeometry(page: Page) {
  return page.evaluate(() => {
    const leaf = document.getElementById("kbcc-view");
    const workspace = leaf?.querySelector<HTMLElement>(".ent-cc-workspace");
    const tree = workspace?.querySelector<HTMLElement>(".ent-cc-tree-panel");
    if (!leaf || !workspace || !tree) throw new Error("Missing mobile browse surface");
    const leafRect = leaf.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const treeRect = tree.getBoundingClientRect();
    const toolbar = workspace.querySelector<HTMLElement>(".ent-cc-mobile-toolbar");
    const toolbarBottom = toolbar && getComputedStyle(toolbar).position === "sticky" ? toolbar.getBoundingClientRect().bottom : 0;
    const top = Math.max(leafRect.top, workspaceRect.top, treeRect.top, toolbarBottom, 0);
    const bottom = Math.min(leafRect.bottom, workspaceRect.bottom, treeRect.bottom, window.visualViewport?.height ?? window.innerHeight);
    const rows = Array.from(workspace.querySelectorAll<HTMLElement>(".ent-cc-subject-row")).map((row) => {
      const rect = row.getBoundingClientRect();
      return { title: row.querySelector(".ent-cc-subject-title")?.textContent ?? "", top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    return {
      leafHeight: leafRect.height, usableHeight: Math.max(0, bottom - top),
      fullyVisibleRows: rows.filter((row) => row.top >= top - 1 && row.bottom <= bottom + 1 && row.height >= 44),
      rowCount: rows.length, documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

test("mobile browse disclosures preserve accessible state, filters, focus and list scroll on refresh", async ({ page }) => {
  await openView(page, { mobile: true, phoneChrome: true });
  const details = page.locator(".ent-cc-workspace-options");
  const detailsToggle = details.locator(":scope > summary");
  const filters = page.locator(".ent-cc-mobile-filters");
  const filtersToggle = filters.locator(":scope > summary");
  await expect(detailsToggle).toHaveText("Details");
  await expect(filtersToggle).toHaveAccessibleName("Filters");
  for (const toggle of [detailsToggle, filtersToggle]) expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(details).not.toHaveAttribute("open");
  await expect(filters).not.toHaveAttribute("open");
  await expect(page.getByRole("heading", { name: "My knowledge base", exact: true })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Search scope" })).toBeHidden();
  await detailsToggle.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(page.locator(".ent-cc-health-summary")).toBeVisible();
  await refresh(page, true);
  await expect(details).toHaveAttribute("open", "");
  await expect(detailsToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await filtersToggle.focus();
  await page.keyboard.press("Enter");
  await expect(filters).toHaveAttribute("open", "");
  const scope = page.getByRole("combobox", { name: "Search scope" });
  const availability = page.getByRole("combobox", { name: "Note availability" });
  const linkedFirst = page.getByRole("checkbox", { name: "Show linked notes first" });
  await scope.selectOption("library");
  await availability.selectOption("linked");
  await linkedFirst.check();
  await linkedFirst.focus();
  await refresh(page, true);
  await expect(filters).toHaveAttribute("open", "");
  await expect(linkedFirst).toBeFocused();
  await expect(scope).toHaveValue("library");
  await expect(availability).toHaveValue("linked");
  await expect(linkedFirst).toBeChecked();
  await expect(filtersToggle).toHaveText("Filters (3)");
  await expect(filtersToggle).toHaveAccessibleName("Filters: This Library, Linked notes, Linked notes first");
  await filtersToggle.click();
  await expect(filters).not.toHaveAttribute("open");
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  const before = await page.locator(".ent-cc-workspace").evaluate((owner) => owner.scrollTop);
  expect(before).toBeGreaterThan(200);
  await refresh(page, true);
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
  await expect.poll(() => page.locator(".ent-cc-workspace").evaluate((owner) => owner.scrollTop)).toBeCloseTo(before, 0);
  await expect.poll(async () => (await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
  await filtersToggle.click();
  await expect(scope).toHaveValue("library");
  await expect(availability).toHaveValue("linked");
  await expect(linkedFirst).toBeChecked();
  await captureEvidence(page, "browse-filters-restored");
});

test("mobile browse keyboard viewport keeps focused search reachable while later results scroll", async ({ page }, testInfo) => {
  await openView(page, { mobile: true, phoneChrome: true });
  const input = page.locator('.ent-cc-search-box input[type="search"]');
  const clear = page.getByRole("button", { name: "Clear search", exact: true });
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  await input.fill("Reference");
  await expect(page.locator(".ent-cc-search-base-group .ent-cc-subject-row")).toHaveCount(17);
  // Model visualViewport shrink without pretending Chromium/WebKit automation
  // opens an actual iPhone software keyboard. Native app checks remain separate.
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error("Browser has no visual viewport");
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 440 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".ent-cc-shell")).toHaveClass(/is-virtual-keyboard-open/u);
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  const geometry = await page.evaluate(() => {
    const selectors = ['.ent-cc-search-box input[type="search"]', ".ent-cc-search-clear", ".ent-cc-workspace", ".ent-cc-tree-panel"];
    return selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { selector, top: rect.top, bottom: rect.bottom, height: rect.height, overflowY: getComputedStyle(element).overflowY, scrollTop: element.scrollTop };
    });
  });
  await testInfo.attach("keyboard-viewport-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  for (const control of geometry.slice(0, 2)) {
    expect(control.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(108);
    expect(control.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(441);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  expect(geometry[2].scrollTop).toBeGreaterThan(200);
  expect(geometry[3].overflowY).toBe("visible");
  expect((await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
  await expect(input).toBeFocused();
  await expect(clear).toBeVisible();
  await captureEvidence(page, "browse-keyboard-scrolled");
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { kbccSearchEvents: unknown[] }).kbccSearchEvents = events;
    for (const type of ["mousedown", "mouseup", "click", "focus", "blur"]) document.addEventListener(type, (event) => {
      const target = event.target as HTMLElement;
      const rect = document.querySelector(".ent-cc-search-clear")?.getBoundingClientRect();
      events.push({ type, target: target.className || target.tagName, active: document.activeElement?.tagName, shell: document.querySelector(".ent-cc-shell")?.className, clearTop: rect?.top, clearBottom: rect?.bottom });
    }, true);
  });
  await clear.click();
  await testInfo.attach("search-clear-pointer-events", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { kbccSearchEvents: unknown[] }).kbccSearchEvents), null, 2), contentType: "application/json" });
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error("Browser has no visual viewport");
    Reflect.deleteProperty(window.visualViewport, "height");
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await input.blur();
  await expect(page.locator(".ent-cc-shell")).not.toHaveClass(/is-search-focused|is-virtual-keyboard-open/u);
  await expect.poll(async () => (await mobileBrowseGeometry(page)).fullyVisibleRows.length).toBeGreaterThanOrEqual(5);
});

test("mobile browse inspector Back restores the scrolled list and selected row focus", async ({ page }) => {
  await openView(page, { mobile: true, phoneChrome: true, dark: true });
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  const before = await page.locator(".ent-cc-workspace").evaluate((owner) => owner.scrollTop);
  const selected = page.getByRole("button", { name: /^Reference 17,/u });
  await selected.click();
  const back = page.getByRole("button", { name: "Back to main page", exact: true });
  await expect(back).toBeFocused();
  await expect(page.getByRole("button", { name: "Open note", exact: true })).toBeVisible();
  await refresh(page, true);
  await back.click();
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
  await expect(selected).toBeFocused();
  await expect.poll(() => page.locator(".ent-cc-workspace").evaluate((owner) => owner.scrollTop)).toBeCloseTo(before, 0);
  expect((await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
  await captureEvidence(page, "browse-inspector-return-dark");
});

async function expectExactKeyboardResultActivation(page: Page, testInfo: TestInfo, touch: boolean): Promise<void> {
  await openView(page, { mobile: true, phoneChrome: true });
  const input = page.locator('.ent-cc-search-box input[type="search"]');
  await input.fill("Reference");
  await expect(page.locator(".ent-cc-search-base-group .ent-cc-subject-row")).toHaveCount(17);
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error("Browser has no visual viewport");
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 440 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".ent-cc-shell")).toHaveClass(/is-virtual-keyboard-open/u);
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  await expect(input).toBeFocused();
  const intended = page.getByRole("button", { name: /^Reference 17,/u });
  const bounds = await intended.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(160);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(440);
  if (touch) await intended.tap();
  else await intended.click();
  const selectedPath = await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { snapshot(): { selectedPath: string } } }).kbccBrowserHarness.snapshot().selectedPath);
  await testInfo.attach("keyboard-result-pointer", { body: JSON.stringify({ pointer: touch ? "touch" : "mouse", intended: "Resources/Reference 17.md", selectedPath, bounds }, null, 2), contentType: "application/json" });
  expect(selectedPath).toBe("Resources/Reference 17.md");
  await expect(page.getByRole("button", { name: "Back to main page", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference 17", exact: true })).toBeVisible();
  await captureEvidence(page, `browse-keyboard-exact-result-${touch ? "touch" : "mouse"}`);
  const back = page.getByRole("button", { name: "Back to main page", exact: true });
  const backBounds = await back.boundingBox();
  expect(backBounds!.y + backBounds!.height).toBeLessThanOrEqual(440);
  if (touch) await back.tap();
  else await back.click();
  await expect(intended).toBeFocused();
  const returnFocus = await intended.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const toolbar = document.querySelector(".ent-cc-mobile-toolbar")?.getBoundingClientRect();
    const leaf = document.getElementById("kbcc-view")!.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, toolbarBottom: toolbar?.bottom ?? leaf.top, leafBottom: leaf.bottom, hit: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
  });
  expect(returnFocus.top, JSON.stringify(returnFocus)).toBeGreaterThanOrEqual(returnFocus.toolbarBottom);
  expect(returnFocus.bottom).toBeLessThanOrEqual(returnFocus.leafBottom);
  expect(returnFocus.hit).toBe(true);
  await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
  await expect(page.getByRole("button", { name: "Actions for Reference 17", exact: true })).toBeFocused();
  await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(intended).toBeFocused();
  for (let index = 16; index >= 5; index -= 1) {
    const name = `Reference ${String(index).padStart(2, "0")}`;
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
    await expect(page.getByRole("button", { name: `Actions for ${name}`, exact: true })).toBeFocused();
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
    const previousTitle = page.getByRole("button", { name: new RegExp(`^${name},`, "u") });
    await expect(previousTitle).toBeFocused();
    const previousBounds = await previousTitle.boundingBox();
    const toolbarBottom = await page.locator(".ent-cc-mobile-toolbar").evaluate((element) => element.getBoundingClientRect().bottom);
    expect(previousBounds!.y, "Reverse keyboard navigation must not focus a note behind the sticky toolbar").toBeGreaterThanOrEqual(toolbarBottom);
  }
  if (touch) await input.tap();
  else await input.click();
  await expect(input).toBeFocused();
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  const clear = page.getByRole("button", { name: "Clear search", exact: true });
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { kbccClearTouchEvents: unknown[] }).kbccClearTouchEvents = events;
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click", "blur", "focus"]) document.addEventListener(type, (event) => {
      const target = event.target as Element;
      events.push({ type, target: target.closest("button")?.getAttribute("aria-label") ?? target.tagName, prevented: event.defaultPrevented, active: document.activeElement?.tagName });
    }, true);
  });
  await clickRenderedCenter(page, clear, touch);
  await testInfo.attach("clear-after-back-pointer-events", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { kbccClearTouchEvents: unknown[] }).kbccClearTouchEvents), null, 2), contentType: "application/json" });
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await captureEvidence(page, `browse-keyboard-clear-after-back-${touch ? "touch" : "mouse"}`);
}

test("mobile browse pointer-clicking a scrolled keyboard search result opens the exact intended note", async ({ page }, testInfo) => {
  await expectExactKeyboardResultActivation(page, testInfo, false);
});

test.describe("mobile touch pointer", () => {
  test.use({ hasTouch: true });
  test("mobile browse touching a scrolled keyboard search result opens the exact intended note", async ({ page }, testInfo) => {
    await expectExactKeyboardResultActivation(page, testInfo, true);
  });
});

test("narrow nonmobile panes retain desktop controls and scroll hierarchy", async ({ page }) => {
  await openView(page, { width: 390, height: 844, count: 8 });
  await expect(page.locator(".ent-cc-shell")).not.toHaveClass(/is-mobile-browse/u);
  await expect(page.locator(".ent-cc-workspace-options > summary")).toHaveText("Workspace options");
  await expect(page.getByRole("combobox", { name: "Search scope" })).toBeVisible();
  await expect(page.locator(".ent-cc-mobile-filters")).toHaveCount(0);
  await expect(page.locator(".ent-cc-workspace .ent-cc-header")).toHaveCount(0);
  await captureEvidence(page, "browse-narrow-desktop-unchanged");
});

const phoneBrowseScenarios = [
  { width: 390, height: 844, largeText: false },
  { width: 402, height: 874, largeText: false },
  { width: 320, height: 740, largeText: false },
  { width: 390, height: 844, largeText: true },
] as const;

test("mobile sticky Filters stays bounded after a short viewport and larger text change", async ({ page }, testInfo) => {
  await openView(page, { mobile: true, phoneChrome: true });
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  const filters = page.locator(".ent-cc-mobile-filters");
  await filters.locator(":scope > summary").click();
  await expect(filters).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 520 });
  await page.evaluate(() => document.body.classList.add("kbcc-browser-large-text"));
  const panel = page.locator(".ent-cc-mobile-filter-panel");
  await expect.poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(20);
  const saved = filters.getByRole("button", { name: "Saved", exact: true });
  await saved.scrollIntoViewIfNeeded();
  await saved.focus();
  await expect(saved).toBeFocused();
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const leaf = document.getElementById("kbcc-view")!.getBoundingClientRect();
    const toolbar = document.querySelector(".ent-cc-mobile-toolbar")!.getBoundingClientRect();
    const saved = element.querySelector(".ent-cc-saved-button")!.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, scrollTop: element.scrollTop, leafBottom: leaf.bottom, toolbarBottom: toolbar.bottom, savedTop: saved.top, savedBottom: saved.bottom };
  });
  await testInfo.attach("mobile-sticky-short-expanded", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  expect(geometry.scrollTop).toBeGreaterThan(0);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom - 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.leafBottom);
  expect(geometry.savedTop).toBeGreaterThanOrEqual(geometry.top - 1);
  expect(geometry.savedBottom).toBeLessThanOrEqual(geometry.bottom + 1);
  await captureEvidence(page, "sticky-short-expanded-large-text");
  await filters.locator(":scope > summary").click();
  await expect(filters).not.toHaveAttribute("open");
  await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
  expect((await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
});

for (const scenario of phoneBrowseScenarios) {
  test(`mobile sticky controls ${scenario.width}x${scenario.height}${scenario.largeText ? " enlarged text" : ""}: tabs and search remain reachable at the last row`, async ({ page }, testInfo) => {
    await openView(page, { mobile: true, phoneChrome: true, ...scenario });
    await page.locator(".ent-cc-workspace").evaluate((owner) => { owner.scrollTop = owner.scrollHeight; });
    const geometry = await page.evaluate(() => {
      const leaf = document.getElementById("kbcc-view")!;
      const rect = leaf.getBoundingClientRect();
      const bounds = (selector: string) => {
        const element = leaf.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { top: box.top, bottom: box.bottom, height: box.height, hit: Boolean(hit && element.contains(hit)) };
      };
      return {
        leafTop: rect.top, leafBottom: rect.bottom,
        tabs: bounds('.ent-cc-tab[aria-selected="true"]'),
        search: bounds('.ent-cc-search-box input[type="search"]'),
        filters: bounds(".ent-cc-mobile-filters > summary"),
        base: bounds(".ent-cc-base-switcher"),
        details: bounds(".ent-cc-workspace-options > summary"),
        add: bounds(".ent-cc-main-add"),
        counts: bounds(".ent-cc-topic-count"),
      };
    });
    await testInfo.attach("mobile-sticky-last-row", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
    await captureEvidence(page, `sticky-last-row-${scenario.width}${scenario.largeText ? "-large-text" : ""}`);
    for (const control of [geometry.tabs, geometry.search, geometry.filters]) {
      expect(control.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.leafTop - 1);
      expect(control.bottom).toBeLessThanOrEqual(geometry.leafBottom);
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.hit, "Control center must receive input, not sit under another layer").toBe(true);
    }
    expect(Math.max(geometry.search.bottom, geometry.filters.bottom) - geometry.tabs.top, "Only compact tabs and search should remain pinned").toBeLessThanOrEqual(144);
    for (const extra of [geometry.base, geometry.add, geometry.details, geometry.counts]) expect(extra.bottom).toBeLessThanOrEqual(geometry.leafTop + 1);
    expect((await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
    const workspace = page.locator(".ent-cc-workspace");
    const beforeFiltersScroll = await workspace.evaluate((owner) => owner.scrollTop);
    const filters = page.locator(".ent-cc-mobile-filters");
    const summary = filters.locator(":scope > summary");
    await clickRenderedCenter(page, summary);
    await expect(filters).toHaveAttribute("open", "");
    await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
    expect(await workspace.evaluate((owner) => owner.scrollTop), "Opening Filters at a deep scroll must not move the underlying list").toBeCloseTo(beforeFiltersScroll, 0);
    const expanded = await filters.evaluate((element) => {
      const panel = element.querySelector<HTMLElement>(".ent-cc-mobile-filter-panel");
      if (!panel) throw new Error("Expanded Filters needs its own bounded overflow surface");
      const rect = panel.getBoundingClientRect();
      const toolbar = element.closest(".ent-cc-mobile-toolbar")!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, overflowY: getComputedStyle(panel).overflowY, toolbarHeight: toolbar.height };
    });
    await testInfo.attach("mobile-sticky-expanded-filters", { body: JSON.stringify(expanded, null, 2), contentType: "application/json" });
    expect(expanded.toolbarHeight, "Expanded controls must not enlarge the pinned toolbar").toBeLessThanOrEqual(144);
    expect(expanded.overflowY).toMatch(/^(auto|scroll)$/u);
    expect(expanded.height).toBeLessThanOrEqual(geometry.leafBottom - expanded.top);
    expect(expanded.top).toBeGreaterThanOrEqual(geometry.leafTop);
    expect(expanded.bottom).toBeLessThanOrEqual(geometry.leafBottom);
    const saved = filters.getByRole("button", { name: "Saved", exact: true });
    await saved.scrollIntoViewIfNeeded();
    await saved.focus();
    await expect(saved).toBeFocused();
    const savedBounds = await saved.boundingBox();
    expect(savedBounds!.y).toBeGreaterThanOrEqual(expanded.top - 1);
    expect(savedBounds!.y + savedBounds!.height).toBeLessThanOrEqual(expanded.bottom + 1);
    expect(await workspace.evaluate((owner) => owner.scrollTop), "Reaching the final filter action must scroll the panel, not the notes").toBeCloseTo(beforeFiltersScroll, 0);
    await captureEvidence(page, `sticky-expanded-filters-${scenario.width}${scenario.largeText ? "-large-text" : ""}`);
    await page.keyboard.press("Escape");
    await expect(filters).not.toHaveAttribute("open");
    await expect(summary).toBeFocused();
    expect(await workspace.evaluate((owner) => owner.scrollTop), "Escape must return focus without moving the note position").toBeCloseTo(beforeFiltersScroll, 0);
    await clickRenderedCenter(page, summary);
    await expect(filters).toHaveAttribute("open", "");
    await clickRenderedCenter(page, summary);
    await expect(filters).not.toHaveAttribute("open");
    expect(await workspace.evaluate((owner) => owner.scrollTop), "Closing Filters must preserve the note position").toBeCloseTo(beforeFiltersScroll, 0);
  });
}

for (const scenario of phoneBrowseScenarios) {
  test(`mobile browse space ${scenario.width}x${scenario.height}${scenario.largeText ? " enlarged text" : ""}: five rows fit before search focus`, async ({ page }, testInfo) => {
    await openView(page, { mobile: true, phoneChrome: true, ...scenario });
    await expect(page.locator(".ent-cc-shell")).not.toHaveClass(/is-search-focused/u);
    await expect(page.locator('.ent-cc-search-box input[type="search"]')).not.toBeFocused();
    await expect(page.getByRole("tab", { name: /Resources/u })).toHaveAttribute("aria-selected", "true");
    const before = await mobileBrowseGeometry(page);
    await testInfo.attach("mobile-browse-first-viewport", { body: JSON.stringify(before, null, 2), contentType: "application/json" });
    await captureEvidence(page, `browse-space-${scenario.width}${scenario.largeText ? "-large-text" : ""}`);
    expect(before.rowCount).toBe(17);
    expect(before.usableHeight, JSON.stringify(before)).toBeGreaterThanOrEqual(240);
    expect(before.fullyVisibleRows.length, JSON.stringify(before)).toBeGreaterThanOrEqual(5);
    expect(before.documentOverflow).toBeLessThanOrEqual(1);
    // Exercise the production workspace scroll owner, not the clipped shell.
    await page.evaluate(() => {
      const owner = document.querySelector<HTMLElement>(".ent-cc-workspace");
      if (!owner) throw new Error("Missing browse scroll owner");
      owner.scrollTop = owner.scrollHeight;
    });
    await expect.poll(async () => (await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).toContain("Reference 17");
    expect((await mobileBrowseGeometry(page)).fullyVisibleRows.map((row) => row.title)).not.toEqual(before.fullyVisibleRows.map((row) => row.title));
  });
}

for (const scenario of [
  { name: "small phone", width: 320, height: 844, mobile: true },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "native narrow desktop", width: 900, height: 960, mobile: false },
  { name: "native wide desktop panel", width: 1200, height: 960, mobile: false },
  { name: "wide desktop", width: 1440, height: 960, mobile: false },
]) {
  test(`Settings active-base spacing stays content-sized on ${scenario.name}`, async ({ page }, testInfo) => {
    await openView(page, { mobile: scenario.mobile, count: 8 });
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openSettings(page);
    if (scenario.width === 1200) {
      await page.getByRole("main", { name: "Settings test host" }).evaluate((element) => element.classList.add("kbcc-browser-native-settings-width"));
    }
    const row = settingsRow(page, "Active knowledge base");
    const select = row.getByRole("combobox", { name: "Active knowledge base", exact: true });
    const longName = "Long knowledge base name — Research evidence and reference notes for the whole project";
    // Supply only the native option's text fixture, not alternate product DOM or
    // CSS. The production Settings renderer owns the select, row and controls.
    await select.evaluate((element, text) => { element.selectedOptions[0].textContent = text; }, longName);
    await expect(select.locator("option:checked")).toHaveText(longName);
    await row.scrollIntoViewIfNeeded();
    const manage = row.getByRole("button", { name: "Manage…", exact: true });
    await manage.focus();
    await expect(manage).toBeFocused();
    const geometry = await row.evaluate((element) => {
      const control = element.querySelector<HTMLElement>(".setting-item-control");
      const info = element.querySelector<HTMLElement>(".setting-item-info");
      const select = element.querySelector<HTMLSelectElement>("select");
      const button = element.querySelector<HTMLButtonElement>("button");
      if (!control || !info || !select || !button) throw new Error("Incomplete active-base Settings row");
      const bounds = (target: Element) => {
        const rect = target.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      return {
        row: bounds(element), control: bounds(control), info: bounds(info), select: bounds(select), button: bounds(button),
        rowDirection: getComputedStyle(element).flexDirection,
        controlDisplay: getComputedStyle(control).display,
        controlFlexBasis: getComputedStyle(control).flexBasis,
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    await testInfo.attach("active-base-spacing-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
    await captureEvidence(page, `settings-spacing-${scenario.width}`);
    // Allow one or two natural 44px controls, a gap, and generous theme slack;
    // a horizontal flex basis must never become 320px of vertical empty space.
    expect(geometry.control.height, JSON.stringify(geometry)).toBeLessThanOrEqual(128);
    expect(geometry.select.height, "Native selector must not stretch to fill unused vertical space").toBeLessThanOrEqual(64);
    expect(geometry.button.height, "Manage must not stretch to fill unused vertical space").toBeLessThanOrEqual(64);
    if (scenario.width <= 1024) {
      expect(geometry.select.height, "Native select remains a full-height compact control in WebKit").toBeGreaterThanOrEqual(44);
      expect(geometry.button.height, "Manage remains a full-height compact control").toBeGreaterThanOrEqual(44);
    }
    expect(geometry.row.height).toBeLessThanOrEqual(geometry.info.height + 176);
    for (const child of [geometry.select, geometry.button]) {
      expect(child.left).toBeGreaterThanOrEqual(geometry.row.left - 1);
      expect(child.right).toBeLessThanOrEqual(geometry.row.right + 1);
      expect(child.top).toBeGreaterThanOrEqual(geometry.row.top - 1);
      expect(child.bottom).toBeLessThanOrEqual(geometry.row.bottom + 1);
    }
    expect(geometry.row.left).toBeGreaterThanOrEqual(0);
    expect(geometry.row.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
    await expect(settingsRow(page, "Manage libraries").getByRole("button", { name: "Manage…", exact: true })).toBeFocused();
  });
}

for (const mobile of [false, true]) {
  const viewport = mobile ? "mobile" : "desktop";
  test(`production 0.20.1 update announcement ${viewport}: readable news and reachable actions`, async ({ page }, testInfo) => {
    await openView(page, { mobile, count: 8 });
    await openModal(page, "whats-new");
    const dialog = page.getByRole("dialog", { name: "What’s new in Knowledge Base Command Center 0.20.1", exact: true });
    await expect(dialog).toHaveAccessibleDescription("More room for notes, with navigation and search within reach while browsing compact mobile views.");
    const body = dialog.getByRole("region", { name: "Version 0.20.1 highlights", exact: true });
    await expect(body.getByRole("listitem")).toHaveCount(4);
    await expect(body).toContainText("Tabs and Search/Filters stay visible while browsing");
    await expect(body).toContainText("bounded, scrollable panel");
    const link = dialog.getByRole("link", { name: "Read the complete 0.20.1 release notes on GitHub (opens in your browser)", exact: true });
    const continueButton = dialog.getByRole("button", { name: "Continue", exact: true });
    await expect(link).toHaveText("Read complete release notes");
    await expect(link).toHaveAttribute("href", "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.20.1");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    for (const action of [link, continueButton]) {
      await expect(action).toBeInViewport();
      expect(await action.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await captureEvidence(page, `whats-new-0.20.1-${viewport}`);
    await body.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await expect(body.getByRole("listitem").last()).toBeInViewport();
    await expect(continueButton).toBeInViewport();
    await link.focus();
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    // The exact immutable URL is inspected only; the unpublished release link
    // is never followed and this synthetic test makes no network request.
  });
  for (const reviewUnavailable of [false, true]) {
    test(`Settings ${viewport} retains visible action labels with ${reviewUnavailable ? "unavailable" : "available"} legacy review`, async ({ page }) => {
      await openView(page, { mobile, count: 8 });
      await openSettings(page, { reviewUnavailable });
      await captureEvidence(page, `settings-${viewport}-${reviewUnavailable ? "unavailable" : "available"}`);
      const expected = [
        ["Active knowledge base", ["Manage…"]],
        ["Manage libraries", ["Manage…"]],
        ["Library creation profiles", ["Configure…"]],
        ["Linked Index folders", ["Link folder…"]],
        ["Legacy", reviewUnavailable ? ["Review…", "Keep linked"] : ["Review…", "Review…"]],
        ["Linked research", ["Unlink"]],
      ] as const;
      for (const [name, labels] of expected) {
        const buttons = settingsRow(page, name).getByRole("button");
        expect(await buttons.allTextContents(), `${name} must retain readable button text, not just an SVG or tooltip`).toEqual(labels);
        for (let index = 0; index < labels.length; index += 1) {
          await expect(buttons.nth(index)).toHaveAccessibleName(labels[index]);
          await expect(buttons.nth(index)).toBeEnabled();
        }
      }
      await settingsRow(page, "Linked research").scrollIntoViewIfNeeded();
      await captureEvidence(page, `settings-${viewport}-${reviewUnavailable ? "unavailable" : "available"}-membership`);
      await openSettings(page, { reviewUnavailable, readOnly: true });
      for (const [name, labels] of expected) {
        const buttons = settingsRow(page, name).getByRole("button");
        expect(await buttons.allTextContents()).toEqual(labels);
        for (let index = 0; index < labels.length; index += 1) await expect(buttons.nth(index)).toBeDisabled();
      }
      await openSettings(page, { reviewUnavailable, noLibraries: true });
      await expect(settingsRow(page, "Library creation profiles").getByRole("button", { name: "Configure…", exact: true })).toBeDisabled();
      await expect(settingsRow(page, "Linked research").getByRole("button", { name: "Unlink", exact: true })).toBeEnabled();
    });
  }

  test(`Settings ${viewport} keyboard actions preserve unlink confirmation and stale-state guards`, async ({ page }, testInfo) => {
    await openView(page, { mobile, count: 8 });
    await openSettings(page, { reviewUnavailable: true });
    const unlink = settingsRow(page, "Linked research").getByRole("button", { name: "Unlink", exact: true });
    const linkFolder = settingsRow(page, "Linked Index folders").getByRole("button", { name: "Link folder…", exact: true });
    await linkFolder.focus();
    // macOS WebKit uses Option+Tab to include every native control.
    await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
    await expect(settingsRow(page, "Legacy").getByRole("button", { name: "Review…", exact: true })).toBeFocused();
    await unlink.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog", { name: "Unlink folder from this Index?", exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("No Markdown file will be changed.");
    expect((await settingsSnapshot(page)).unlinked).toEqual([]);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await settingsSnapshot(page)).unlinked).toEqual([]);
    await unlink.click();
    await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { invalidateSettings(): void } }).kbccBrowserHarness.invalidateSettings());
    await confirmation.getByRole("button", { name: "Unlink folder", exact: true }).click();
    expect((await settingsSnapshot(page)).unlinked).toEqual([]);
    await expect(confirmation).toBeHidden();
    await unlink.click();
    await expect(confirmation).toBeHidden();
    await openSettings(page, { reviewUnavailable: true });
    await unlink.click();
    await confirmation.getByRole("button", { name: "Unlink folder", exact: true }).click();
    expect((await settingsSnapshot(page)).unlinked).toEqual(["explicit-source"]);
    await settingsRow(page, "Legacy").getByRole("button", { name: "Keep linked", exact: true }).click();
    await page.getByRole("dialog", { name: "Keep this folder linked to the Index?", exact: true }).getByRole("button", { name: "Keep linked", exact: true }).click();
    expect((await settingsSnapshot(page)).kept).toEqual(["legacy-source"]);
    await openSettings(page);
    await settingsRow(page, "Legacy").getByRole("button", { name: "Review…", exact: true }).first().click();
    await expect.poll(async () => (await settingsSnapshot(page)).reviews).toEqual(["legacy-source"]);
    await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { invalidateSettings(): void } }).kbccBrowserHarness.invalidateSettings());
    await settingsRow(page, "Legacy").getByRole("button", { name: "Review…", exact: true }).last().click();
    expect((await settingsSnapshot(page)).reviews).toEqual(["legacy-source"]);
  });

  test(`Settings ${viewport} waits for pending saves before opening legacy review and rejects replaced data`, async ({ page }) => {
    await openView(page, { mobile, count: 8 });
    for (const replaceData of [false, true]) {
      await openSettings(page, { holdSave: true });
      await settingsRow(page, "Header description").getByRole("textbox").fill("Pending synthetic settings change");
      await settingsRow(page, "Legacy").getByRole("button", { name: "Review…", exact: true }).first().click();
      await expect.poll(async () => (await settingsSnapshot(page)).saves).toBe(1);
      expect((await settingsSnapshot(page)).reviews).toEqual([]);
      if (replaceData) await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { invalidateSettings(): void } }).kbccBrowserHarness.invalidateSettings());
      await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { releaseSettingsSave(): void } }).kbccBrowserHarness.releaseSettingsSave());
      if (replaceData) {
        // Let the real Settings save/review promise continuations settle.
        await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
        expect((await settingsSnapshot(page)).reviews).toEqual([]);
      } else {
        await expect.poll(async () => (await settingsSnapshot(page)).reviews).toEqual(["legacy-source"]);
      }
    }
  });
}

async function expectReadableMetadata(page: Page): Promise<void> {
  for (const selector of [".ent-cc-health-summary", ".ent-cc-subject-id"]) {
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    const contrast = await target.evaluate((element) => {
      // Resolve computed colors through the native canvas color parser. Composite
      // solid ancestor backgrounds instead of assuming the body's background.
      const canvas = document.body.createEl("canvas");
      canvas.remove();
      canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable for color contrast check");
      context.fillStyle = "white"; context.fillRect(0, 0, 1, 1);
      const ancestors: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
      for (const ancestor of ancestors) {
        const style = getComputedStyle(ancestor);
        if (style.backgroundImage !== "none" || Number(style.opacity) !== 1) throw new Error("Contrast helper requires solid backgrounds without group opacity");
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const background = context.getImageData(0, 0, 1, 1).data;
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const foreground = context.getImageData(0, 0, 1, 1).data;
      const luminance = (channels: Uint8ClampedArray): number => {
        const values = Array.from(channels).slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const light = luminance(foreground); const dark = luminance(background);
      return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    });
    expect(contrast, `${selector} contrast in the synthetic host theme`).toBeGreaterThanOrEqual(4.5);
  }
}

test.afterEach(async ({ page }) => {
  expect(failures.get(page) ?? [], "production renderer must not emit runtime or console errors").toEqual([]);
  await page.evaluate(() => (window as unknown as { kbccBrowserHarness?: { close(): Promise<void> } }).kbccBrowserHarness?.close());
});

test("production tabs keep keyboard focus on the selected tab", async ({ page }) => {
  await openView(page, { count: 8 });
  const tabs = page.getByRole("tablist", { name: "Command center sections" });
  await tabs.getByRole("tab").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: /Reading/u })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab").first()).toBeFocused();
});

test("workspace options expose a keyboard-operable density choice that survives refresh", async ({ page }) => {
  await openView(page, { count: 8 });
  const options = page.locator(".ent-cc-workspace-options");
  const summary = options.locator("summary");
  await expect(options).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Use compact view density" })).toBeHidden();
  const row = page.locator(".ent-cc-subject-row").first();
  const comfortableHeight = await row.evaluate((element) => element.getBoundingClientRect().height);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(options).toHaveAttribute("open");
  await page.getByRole("button", { name: "Use compact view density" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ent-cc-view")).toHaveClass(/is-density-compact/u);
  const density = page.getByRole("button", { name: "Use comfortable view density" });
  await expect(density).toBeFocused();
  await expect(density).toHaveAttribute("aria-pressed", "true");
  expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(comfortableHeight);
  await refresh(page);
  await expect(density).toBeFocused();
  await expect(page.locator(".ent-cc-view")).toHaveClass(/is-density-compact/u);
  await page.keyboard.press("Enter");
  await expect(page.locator(".ent-cc-view")).not.toHaveClass(/is-density-compact/u);
});

test("Show more, selection and focus survive same-route refresh on a real DOM", async ({ page }) => {
  await openView(page);
  const rows = page.locator(".ent-cc-tree-body .ent-cc-subject-title");
  await expect(rows).toHaveCount(300);
  const more = page.locator(".ent-cc-browse-limit button");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(600);
  await expect(page.locator(".ent-cc-browse-limit button")).toBeFocused();
  await refresh(page);
  await expect(rows).toHaveCount(600);
  await expect(page.locator(".ent-cc-browse-limit button")).toBeFocused();
  const chosen = page.getByRole("button", { name: /^Research note 420,/u });
  await chosen.focus();
  await page.keyboard.press("Space");
  await refresh(page);
  await expect(chosen).toBeFocused();
  await expect(rows).toHaveCount(600);
  await expect(chosen.locator("..")).toHaveClass(/is-selected/u);
});

test("focused search survives both ordinary refresh and a data-epoch refresh", async ({ page }) => {
  await openView(page, { count: 8 });
  const input = page.locator('.ent-cc-search-box input[type="search"]');
  await input.fill("Search");
  await expect(page.getByRole("button", { name: /^Search project,/u })).toBeVisible();
  await refresh(page);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Search");
  await refresh(page, true);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Search");
});

test("the final browse page leaves focus on a live newly revealed row", async ({ page }) => {
  await openView(page, { count: 310 });
  await page.locator(".ent-cc-browse-limit button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ent-cc-tree-body .ent-cc-subject-title")).toHaveCount(311);
  await expect(page.locator(".ent-cc-browse-limit button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Research note 300,/u })).toBeFocused();
});

test("mobile detail refresh restores its live action and respects focus outside the view", async ({ page }) => {
  await openView(page, { mobile: true, count: 8 });
  await page.getByRole("button", { name: /^Research note 000,/u }).click();
  const action = page.locator(".ent-cc-inspector-actions button").first();
  await action.focus();
  await refresh(page);
  await expect(action).toBeFocused();
  await page.evaluate(() => {
    const outside = document.body.createEl("input");
    outside.id = "synthetic-other-surface";
    document.body.appendChild(outside);
    outside.focus();
  });
  await refresh(page);
  await expect(page.locator("#synthetic-other-surface")).toBeFocused();
});

test("scope and note-availability controls filter the real rendered search results", async ({ page }) => {
  await openView(page, { count: 8 });
  const input = page.locator('.ent-cc-search-box input[type="search"]');
  await input.fill("Search");
  await expect(page.getByRole("button", { name: /^Search project,/u })).toBeVisible();
  await page.getByRole("combobox", { name: "Search scope" }).selectOption("current");
  await expect(page.getByRole("button", { name: /^Search project,/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Search draft,/u })).toBeVisible();
  await page.getByRole("combobox", { name: "Note availability" }).selectOption("linked");
  await expect(page.getByRole("button", { name: /^Search draft,/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Search reference,/u })).toBeVisible();
  await page.getByRole("combobox", { name: "Note availability" }).selectOption("placeholders");
  await expect(page.locator(".ent-cc-tree-body .ent-cc-subject-title")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Search draft,/u })).toBeVisible();
  await page.getByRole("combobox", { name: "Note availability" }).selectOption("all");
  await page.getByRole("checkbox", { name: "Show linked notes first" }).check();
  await expect(page.locator(".ent-cc-tree-body .ent-cc-subject-title").first()).not.toHaveText("Search draft");
  await page.getByRole("tab", { name: /Reading/u }).click();
  await page.getByRole("combobox", { name: "Search scope" }).selectOption("library");
  await input.fill("Search");
  await expect(page.locator(".ent-cc-tree-body .ent-cc-subject-title")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Search reference,/u })).toBeVisible();
});

for (const mobile of [false, true]) {
  const device = mobile ? "mobile" : "desktop";
  test(`production completed import ${device}: visible labels and keyboard actions remain intact`, async ({ page, browserName }) => {
    await openView(page, { mobile, count: 8 });
    const openCompletedImport = async (): Promise<void> => {
      await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { openCompletedImport(): void } }).kbccBrowserHarness.openCompletedImport());
      await expect(page.getByRole("dialog").getByText("Import complete", { exact: true })).toBeVisible();
    };
    const actionSnapshot = () => page.evaluate(() => (window as unknown as {
      kbccBrowserHarness: { snapshot(): { completedImportActions: { undo: number; placeholderQueue: number; closed: boolean[] } } };
    }).kbccBrowserHarness.snapshot().completedImportActions);
    await openCompletedImport();
    const panel = page.getByRole("dialog").locator(".ent-cc-portability-panel");
    const undo = panel.getByRole("button", { name: "Undo import", exact: true });
    const queue = panel.getByRole("button", { name: "Open placeholder queue", exact: true });
    const close = panel.getByRole("button", { name: "Close", exact: true });
    for (const label of ["Undo import", "Open placeholder queue", "Close"]) {
      const button = panel.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveText(label);
      await expect(button).toHaveAccessibleName(label);
      await expect(button).toBeEnabled();
    }
    await undo.focus();
    await expect(undo).toBeFocused();
    // The macOS WebKit host uses Option-Tab to traverse native buttons.
    const nextControl = browserName === "webkit" ? "Alt+Tab" : "Tab";
    const previousControl = browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab";
    await page.keyboard.press(nextControl);
    await expect(queue).toBeFocused();
    await page.keyboard.press(nextControl);
    await expect(close).toBeFocused();
    await captureEvidence(page, `completed-import-${device}`);
    await page.keyboard.press(previousControl);
    await expect(queue).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await actionSnapshot()).toEqual({ undo: 0, placeholderQueue: 1, closed: [false] });

    await openCompletedImport();
    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await actionSnapshot()).toEqual({ undo: 1, placeholderQueue: 1, closed: [false, true] });

    await openCompletedImport();
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await actionSnapshot()).toEqual({ undo: 1, placeholderQueue: 1, closed: [false, true, false] });
  });

  test(`production empty Collection ${device}: create opens the named destination directly`, async ({ page }) => {
    await openView(page, { mobile, count: 8 });
    await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { showEmptyCollection(): Promise<void> } }).kbccBrowserHarness.showEmptyCollection());
    const empty = page.locator(".ent-cc-empty-collection");
    await expect(page.locator(".ent-cc-topic-count")).toContainText("1 collection · 0 entries · 0 linked notes · 0 placeholders");
    await expect(empty.getByRole("button", { name: "Add existing note", exact: true })).toBeVisible();
    await expect(empty.getByRole("button", { name: "Create note", exact: true })).toBeVisible();
    if (mobile) {
      for (const label of ["Add existing note", "Create note"]) {
        const target = await empty.getByRole("button", { name: label, exact: true }).boundingBox();
        expect(target?.height, `${label} must keep a 44px mobile target`).toBeGreaterThanOrEqual(44);
      }
    }
    await captureEvidence(page, `empty-collection-${device}`);
    await empty.getByRole("button", { name: "Create note", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create note", exact: true })).toBeVisible();
    await expect(dialog.getByText("This note will be added to Reading this week. The collection destination is fixed for this action.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Add to a collection after creation", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: mobile ? "Close" : "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`production note and setup dialogs ${device}: common fields precede optional details`, async ({ page }) => {
    await openView(page, { mobile, count: 8 });
    await openModal(page, "note");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create note", exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "note title", exact: true })).toBeVisible();
    await expect(dialog.locator(".ent-cc-note-advanced")).not.toHaveAttribute("open");
    await expect(dialog.getByRole("textbox", { name: "Destination folder", exact: true })).toBeHidden();
    await dialog.getByRole("textbox", { name: "note title", exact: true }).fill("A new research note");
    await expect(dialog.locator(".ent-cc-path-preview-value")).toHaveText("Research/A new research note.md");
    await captureEvidence(page, `create-note-${device}`);
    await dialog.locator(".ent-cc-note-advanced summary").click();
    await expect(dialog.getByRole("textbox", { name: "Destination folder", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: mobile ? "Close" : "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openModal(page, "setup");
    await expect(dialog.getByRole("textbox", { name: "Command center name", exact: true })).toBeVisible();
    await expect(dialog.locator(".ent-cc-setup-advanced")).not.toHaveAttribute("open");
    await expect(dialog.getByRole("textbox", { name: "Header description", exact: true })).toBeHidden();
    await captureEvidence(page, `setup-${device}`);
    await dialog.locator(".ent-cc-setup-advanced summary").click();
    await expect(dialog.getByRole("textbox", { name: "Header description", exact: true })).toBeVisible();
  });

  test(`production export and recovery dialogs ${device}: presets retain private-backup confirmation`, async ({ page }) => {
    await openView(page, { mobile, count: 8 });
    await openModal(page, "export");
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".ent-cc-export-custom")).not.toHaveAttribute("open");
    await expect(dialog.getByRole("button", { name: "Transfer structure", exact: true })).toBeVisible();
    await captureEvidence(page, `export-${device}`);
    await dialog.getByRole("button", { name: "Back up organization for this vault", exact: true }).click();
    await expect(dialog.getByText("Exact vault paths will be included", { exact: true })).toBeVisible();
    const submit = dialog.getByRole("button", { name: "Export selected sections", exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "Confirm private recovery export", exact: true }).check();
    await expect(submit).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await openModal(page, "sync");
    await expect(dialog.getByText("Local changes saved", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Back up organization…", exact: true })).toBeVisible();
    await expect(dialog.locator(".ent-cc-sync-recovery-diagnostics")).not.toHaveAttribute("open");
    await expect(dialog.getByText("1234abcd…", { exact: true })).toBeHidden();
    await captureEvidence(page, `recovery-${device}`);
    await dialog.locator(".ent-cc-sync-recovery-diagnostics summary").click();
    await expect(dialog.getByText("1234abcd…", { exact: true })).toBeVisible();
  });

  test(`production Organizer ${device}: external refresh preserves the draft and expires review`, async ({ page }) => {
    await openView(page, { mobile, count: 8 });
    await openModal(page, "organizer");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Choose destinations", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Choose destinations", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Prepare review", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Prepare review", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Apply organization", exact: true })).toBeEnabled();
    await captureEvidence(page, `organizer-review-${device}`);
    await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { refreshOrganizer(): Promise<void> } }).kbccBrowserHarness.refreshOrganizer());
    await expect(dialog.getByRole("button", { name: "Apply organization", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Refresh review", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Refresh review", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Apply organization", exact: true })).toBeEnabled();
    await expect(dialog.locator(".ent-cc-note-organizer-review-row")).toHaveCount(2);
  });

  for (const dark of [false, true]) {
    test(`production Generic view ${mobile ? "mobile" : "desktop"} ${dark ? "dark" : "light"}: usable first viewport`, async ({ page }) => {
      await openView(page, { mobile, dark, count: 8 });
      await expect(page.getByRole("button", { name: /^Research note 000,/u })).toBeVisible();
      await expect(page.locator(".ent-cc-topic-count")).toContainText("9 entries · 8 linked notes · 1 placeholder");
      await expect(page.getByRole("tab", { name: /My Collections/u }).getByText("4 members", { exact: true })).toBeVisible();
      const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
      if (mobile) {
        await page.locator(".ent-cc-mobile-filters > summary").click();
        for (const label of ["Search scope", "Note availability"]) {
          const target = await page.getByRole("combobox", { name: label }).boundingBox();
          expect(target?.height, `${label} must keep a 44px mobile target`).toBeGreaterThanOrEqual(44);
        }
        await page.locator(".ent-cc-mobile-filters > summary").click();
      }
      const input = page.locator('.ent-cc-search-box input[type="search"]');
      await input.fill("Research note 003");
      await expect(page.getByRole("button", { name: /^Research note 003,/u })).toBeVisible();
      await expect(input).toBeFocused();
      await input.fill("");
      await input.blur();
      if (!mobile) await expectReadableMetadata(page);
      await captureEvidence(page, `generic-${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}`);
    });
  }
}
