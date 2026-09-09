import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

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

async function openView(page: Page, options: { mobile?: boolean; dark?: boolean; count?: number } = {}): Promise<void> {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize(options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
  await page.goto(`about:blank#mobile=${Boolean(options.mobile)}&count=${options.count ?? 650}`);
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC production renderer · synthetic vault</title></head><body class="${options.dark ? "theme-dark" : "theme-light"}${options.mobile ? " is-mobile" : ""}"><main id="kbcc-view" class="view-content"></main></body></html>`);
  await page.addStyleTag({ content: hostStyles });
  await page.addStyleTag({ content: productStyles });
  await page.addScriptTag({ content: rendererBundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  await expect(page).toHaveTitle("KBCC production renderer · synthetic vault");
  await expect(page.getByRole("heading", { name: "Research workspace", exact: true })).toBeVisible();
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
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
  test(`production 0.20.0 update announcement ${viewport}: readable news and reachable actions`, async ({ page }, testInfo) => {
    await openView(page, { mobile, count: 8 });
    await openModal(page, "whats-new");
    const dialog = page.getByRole("dialog", { name: "What’s new in Knowledge Base Command Center 0.20.0", exact: true });
    await expect(dialog).toHaveAccessibleDescription("A clearer workspace, more dependable navigation, and stronger safeguards for your organization.");
    const body = dialog.getByRole("region", { name: "Version 0.20.0 highlights", exact: true });
    await expect(body.getByRole("listitem")).toHaveCount(5);
    await expect(body).toContainText("explicit search scope");
    await expect(body).toContainText("compact mobile Settings spacing");
    const link = dialog.getByRole("link", { name: "Read the complete 0.20.0 release notes on GitHub (opens in your browser)", exact: true });
    const continueButton = dialog.getByRole("button", { name: "Continue", exact: true });
    await expect(link).toHaveText("Read complete release notes");
    await expect(link).toHaveAttribute("href", "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.20.0");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    for (const action of [link, continueButton]) {
      await expect(action).toBeInViewport();
      expect(await action.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await captureEvidence(page, `whats-new-0.20.0-${viewport}`);
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
        for (const label of ["Search scope", "Note availability"]) {
          const target = await page.getByRole("combobox", { name: label }).boundingBox();
          expect(target?.height, `${label} must keep a 44px mobile target`).toBeGreaterThanOrEqual(44);
        }
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
