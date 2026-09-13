import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Browser plugin not available. The existing Playwright production-renderer
// workflow covers browser layout, keyboard events and wheel panning. The Menu
// host is synthetic; neither it nor viewport emulation is physical-device QA.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lastTab = "library:tabs-library-9";
let bundle: string;
let productCss: string;
let hostCss: string;
const failures = new WeakMap<Page, string[]>();
interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
  paneWidth?: number;
  rtl?: boolean;
  largeText?: boolean;
  dark?: boolean;
}
const viewports: Viewport[] = [
  { name: "desktop1440", width: 1440, height: 960, mobile: false },
  { name: "desktop720", width: 720, height: 900, mobile: false },
  { name: "desktop-pane420", width: 1440, height: 960, paneWidth: 420, mobile: false },
  { name: "phone320", width: 320, height: 740, mobile: true },
  { name: "phone390", width: 390, height: 844, mobile: true },
  { name: "phone-landscape844", width: 844, height: 390, mobile: true },
  { name: "tablet820", width: 820, height: 1180, mobile: true },
  { name: "tablet1180", width: 1180, height: 820, mobile: true },
];

test.beforeAll(async () => {
  const [built, css, host] = await Promise.all([
    build({ entryPoints: [path.join(root, "tests/browser/view-harness.ts")], bundle: true, write: false,
      format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } }),
    readFile(path.join(root, "styles.css"), "utf8"), readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  expect(bundle).toContain("EntVaultCommandCenterView");
  productCss = css; hostCss = host;
});

async function open(page: Page, viewport: Viewport): Promise<void> {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`about:blank#mobile=${viewport.mobile}&count=24&scenario=tab-navigation`);
  await page.setContent(`<!doctype html><html lang="${viewport.rtl ? "ar" : "en"}" dir="${viewport.rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>KBCC tab navigation · synthetic vault</title></head><body class="${viewport.dark ? "theme-dark" : "theme-light"}${viewport.mobile ? " is-mobile" : ""}${viewport.largeText ? " kbcc-browser-large-text" : ""}"><main id="kbcc-view" class="view-content"></main></body></html>`);
  await page.addStyleTag({ content: hostCss });
  if (viewport.paneWidth) await page.addStyleTag({ content: `#kbcc-view { width: ${viewport.paneWidth}px; }` });
  // Reproduce an always-visible host scrollbar: product-scoped suppression must
  // win even when macOS/Obsidian does not use transient overlay scrollbars.
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 14px; height: 14px; } ::-webkit-scrollbar-thumb { background: #777; }" });
  await page.addStyleTag({ content: productCss });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  expect(page.url()).toContain("scenario=tab-navigation");
  await expect(page).toHaveTitle("KBCC tab navigation · synthetic vault");
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Command center sections", exact: true }).getByRole("tab")).toHaveCount(15);
  await expect(page.locator('vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal')).toHaveCount(0);
  await expectActiveVisible(page, lastTab);
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Evidence must remain outside the repository");
  await mkdir(directory, { recursive: true });
  await page.mouse.move(1, 1);
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-tabs-${name}.png`) });
}

async function expectActiveVisible(page: Page, id: string): Promise<void> {
  const active = page.locator(`.ent-cc-tab[data-tab="${id}"]`);
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => active.evaluate((element) => {
    const tab = element.getBoundingClientRect();
    const bar = element.closest(".ent-cc-tabs")!.getBoundingClientRect();
    // Oversized labels may be clipped, but the rail must show a full viewport
    // of the active tab instead of leaving it entirely outside the strip.
    return tab.width <= bar.width + 2
      ? tab.left >= bar.left - 2 && tab.right <= bar.right + 2
      : tab.left <= bar.left + 2 && tab.right >= bar.right - 2;
  })).toBe(true);
}

async function expectControlReachable(control: Locator): Promise<void> {
  const geometry = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height,
      inViewport: bounds.left >= 0 && bounds.right <= window.innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1,
      unobscured: element.contains(element.ownerDocument.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)),
      outsideRail: !element.closest(".ent-cc-tabs") };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.inViewport).toBe(true);
  expect(geometry.unobscured).toBe(true);
  expect(geometry.outsideRail).toBe(true);
}

async function refresh(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { kbccBrowserHarness: { refresh(): Promise<void> } }).kbccBrowserHarness.refresh());
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
}

test.afterEach(async ({ page }) => { expect(failures.get(page) ?? []).toEqual([]); });

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.mobile });
    test("hidden scrollbar preserves native pan, semantic labels and fixed section access", async ({ page }) => {
      await open(page, viewport);
      const rail = page.getByRole("tablist", { name: "Command center sections", exact: true });
      const libraries = rail.getByRole("group", { name: "Libraries", exact: true });
      for (const container of [rail, libraries]) {
        await expect(container).toHaveAttribute("aria-labelledby", /.+/u);
        await expect(container).not.toHaveAttribute("aria-label");
        await expect(container).not.toHaveAttribute("title");
      }
      const style = await rail.evaluate((element) => {
        const main = getComputedStyle(element);
        const scrollbar = getComputedStyle(element, "::-webkit-scrollbar");
        return { overflowX: main.overflowX, touchAction: main.touchAction, width: main.scrollbarWidth,
          pseudoDisplay: scrollbar.display, pseudoHeight: scrollbar.height, scrollable: element.scrollWidth > element.clientWidth + 100 };
      });
      expect(style.overflowX).toMatch(/auto|scroll/u);
      expect(style.touchAction).not.toBe("none");
      expect(style.width === "none" || style.pseudoDisplay === "none" || style.pseudoHeight === "0px").toBe(true);
      expect(style.scrollable).toBe(true);
      expect(await page.locator(".ent-cc-tabs-row, .ent-cc-shell").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const all = page.getByRole("button", { name: "All sections", exact: true });
      const settings = page.getByRole("button", { name: "Library settings", exact: true });
      await expectControlReachable(all); await expectControlReachable(settings);
      await expect(all).toHaveAttribute("aria-haspopup", "menu");
      await expect(all).toHaveAttribute("aria-expanded", "false");
      const controlBefore = await all.boundingBox();
      const scrollBefore = await rail.evaluate((element) => element.scrollLeft);
      const bounds = await rail.boundingBox();
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
      await page.mouse.wheel(-300, 0);
      await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeLessThan(scrollBefore - 10);
      await expect(page.locator(`.ent-cc-tab[data-tab="${lastTab}"]`)).toHaveAttribute("aria-selected", "true");
      expect(await all.boundingBox()).toEqual(controlBefore);
      await expectControlReachable(all); await expectControlReachable(settings);
      if (viewport.mobile && test.info().project.name === "chromium") {
        // Genuine browser touch input complements wheel/pointer checks. This
        // does not emulate Safari/iOS edge-swipe routing or physical hardware.
        const beforeTouch = await rail.evaluate((element) => element.scrollLeft);
        const cdp = await page.context().newCDPSession(page);
        const y = bounds!.y + bounds!.height / 2;
        const start = bounds!.x + bounds!.width * 0.2;
        try {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y, id: 1 }] });
          for (let index = 1; index <= 8; index += 1) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start + bounds!.width * 0.6 * index / 8, y, id: 1 }] });
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeLessThan(beforeTouch - 10);
        } finally { await cdp.detach(); }
        await expectControlReachable(all); await expectControlReachable(settings);
      }
      await refresh(page);
      await expectActiveVisible(page, lastTab);
      await capture(page, viewport.name);

      // The synthetic Menu preserves the production item-building callbacks.
      // Host focus/position behavior is separately checked in native Obsidian.
      if (viewport.mobile) await all.tap(); else await all.click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(all).toHaveAttribute("aria-expanded", "true");
      await expect(menu.locator('[role^="menuitem"]')).toHaveCount(15);
      await expect(menu.locator('[aria-checked="true"]')).toHaveCount(1);
      await expect(menu.locator('[aria-checked="true"]')).toContainText("مكتبة");
      if (["phone390", "desktop1440"].includes(viewport.name)) await capture(page, `${viewport.name}-all-sections`);
      await menu.locator('[role^="menuitem"]').filter({ hasText: /^Reading$/u }).click();
      await expect(menu).toHaveCount(0);
      await expectActiveVisible(page, "library:reading");
      await expect(all).toHaveAttribute("aria-expanded", "false");
      await expectControlReachable(settings);
      await settings.click();
      await expect(page.getByRole("dialog", { name: "Library settings — Reading", exact: true })).toBeVisible();
    });

    test("Home End and arrows reveal active tabs while refresh preserves vertical reading position", async ({ page }) => {
      await open(page, viewport);
      const tabs = page.getByRole("tab");
      await tabs.last().focus();
      await page.keyboard.press("Home");
      await expectActiveVisible(page, "curriculum");
      await expect(tabs.first()).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expectActiveVisible(page, "inbox");
      await page.keyboard.press("ArrowLeft");
      await expectActiveVisible(page, "curriculum");
      await page.keyboard.press("End");
      await expectActiveVisible(page, lastTab);
      await expect(tabs.last()).toBeFocused();
      // Move focus out before scrolling, so the test isolates refresh/reveal
      // from the browser's native focus-scroll behavior.
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      const before = await page.evaluate(() => {
        const owners = [".ent-cc-workspace", ".ent-cc-tree-panel"];
        const owner = owners.map((selector) => document.querySelector<HTMLElement>(selector)!)
          .find((element) => element.scrollHeight > element.clientHeight + 200)!;
        owner.scrollTop = 180;
        return owners.map((selector) => document.querySelector<HTMLElement>(selector)!.scrollTop);
      });
      expect(Math.max(...before)).toBeGreaterThan(100);
      await refresh(page);
      await expectActiveVisible(page, lastTab);
      const after = await page.evaluate(() => [".ent-cc-workspace", ".ent-cc-tree-panel"].map((selector) => document.querySelector<HTMLElement>(selector)!.scrollTop));
      after.forEach((value, index) => expect(value).toBeCloseTo(before[index], 0));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}

for (const viewport of [
  { name: "phone320-rtl-large", width: 320, height: 740, mobile: true, rtl: true, largeText: true },
  { name: "tablet1180-rtl", width: 1180, height: 820, mobile: true, rtl: true },
  { name: "desktop1440-rtl-dark", width: 1440, height: 960, mobile: false, rtl: true, dark: true },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.mobile });
    test("RTL keys follow visual direction and keyboard section menu remains reachable", async ({ page }) => {
      await open(page, viewport);
      await expectControlReachable(page.getByRole("button", { name: "All sections", exact: true }));
      await expectControlReachable(page.getByRole("button", { name: "Library settings", exact: true }));
      const active = page.locator(`.ent-cc-tab[data-tab="${lastTab}"]`);
      await active.focus();
      await page.keyboard.press("Home");
      await expectActiveVisible(page, "curriculum");
      await page.keyboard.press("ArrowLeft");
      await expectActiveVisible(page, "inbox");
      await page.keyboard.press("ArrowRight");
      await expectActiveVisible(page, "curriculum");
      await page.keyboard.press("End");
      await expectActiveVisible(page, lastTab);
      const all = page.getByRole("button", { name: "All sections", exact: true });
      await all.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expectActiveVisible(page, "curriculum");
      await all.focus();
      await page.keyboard.press("Space");
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(all).toBeFocused();
      await expect(all).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await capture(page, viewport.name);
    });
  });
}
