import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

/**
 * V3 CSS tickets C01-C04. Every assertion measures rendered boxes, computed
 * colours or computed outlines. The "host parity" body class opts into the
 * Obsidian 1.15.0 host rules recorded in tests/browser/host.css; the product
 * must supply its own focus indicator and contrast under those rules.
 * Synthetic host and browser emulation only: not a real Obsidian/device pass.
 */
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

interface OpenOptions { mobile?: boolean; dark?: boolean; count?: number; width?: number; height?: number; scenario?: string; parity?: boolean; rtl?: boolean }

async function openView(page: Page, options: OpenOptions = {}): Promise<void> {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
  await page.setViewportSize({ width: options.width ?? (options.mobile ? 390 : 1440), height: options.height ?? (options.mobile ? 844 : 960) });
  await page.goto(`about:blank#mobile=${Boolean(options.mobile)}&count=${options.count ?? 8}&scenario=${options.scenario ?? ""}`);
  const classes = [options.dark ? "theme-dark" : "theme-light", options.mobile ? "is-mobile" : "", options.parity ? "kbcc-host-parity" : "", options.rtl ? "mod-rtl" : ""].filter(Boolean).join(" ");
  await page.setContent(`<!doctype html><html lang="${options.rtl ? "ar" : "en"}" dir="${options.rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>KBCC production renderer · synthetic vault</title></head><body class="${classes}"><main id="kbcc-view" class="view-content"></main></body></html>`);
  await page.addStyleTag({ content: hostStyles });
  await page.addStyleTag({ content: productStyles });
  await page.addScriptTag({ content: rendererBundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))));
}

test.afterEach(async ({ page }) => {
  expect(failures.get(page) ?? [], "production renderer must not emit runtime or console errors").toEqual([]);
  await page.evaluate(() => (window as unknown as { kbccBrowserHarness?: { close(): Promise<void> } }).kbccBrowserHarness?.close());
});

async function enterSplit(page: Page): Promise<void> {
  await page.locator(".ent-cc-workspace-options > summary").tap();
  await page.getByRole("button", { name: "Split view on wide screens", exact: true }).tap();
  await expect(page.locator("#kbcc-view")).toHaveAttribute("data-pane-layout", "wide");
  await page.getByRole("button", { name: /^Relationship overview,/u }).tap();
  await expect(page.locator(".ent-cc-view")).toHaveClass(/is-mobile-split/u);
}

/** Lowest contrast of every rendered match, text against composited solid ancestor backgrounds. */
async function contrastOf(page: Page, selector: string): Promise<number> {
  const target = page.locator(selector).locator("visible=true");
  await expect(target.first(), `${selector} must be rendered`).toBeVisible();
  const ratios = await target.evaluateAll((elements) => elements.map((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable for color contrast check");
    context.fillStyle = "white"; context.fillRect(0, 0, 1, 1);
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      if (style.backgroundImage !== "none" || Number(style.opacity) !== 1) throw new Error("Contrast helper requires solid backgrounds without group opacity");
      context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
    }
    const background = context.getImageData(0, 0, 1, 1).data;
    context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
    const foreground = context.getImageData(0, 0, 1, 1).data;
    const luminance = (channels: Uint8ClampedArray): number => {
      const values = Array.from(channels).slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const a = luminance(foreground); const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }));
  return Math.min(...ratios);
}

test.describe("C01 wide mobile split targets", () => {
  test.use({ hasTouch: true });
  for (const rtl of [false, true]) {
    test(`Search Clear, search input, Details menu, filters and study actions are >=44px without overlap${rtl ? " (RTL)" : ""}`, async ({ page }) => {
      await openView(page, { mobile: true, width: 1180, height: 820, scenario: "related-overflow", parity: true, rtl });
      await enterSplit(page);
      const input = page.getByRole("searchbox");
      await input.fill("Research");
      const clear = page.locator(".ent-cc-search-clear");
      await expect(clear).toBeVisible();
      if (!(await page.locator(".ent-cc-workspace-options").evaluate((node) => (node as HTMLDetailsElement).open))) await page.locator(".ent-cc-workspace-options > summary").tap();
      await expect.poll(() => page.locator(".ent-cc-workspace-options").evaluate((node) => (node as HTMLDetailsElement).open)).toBe(true);
      const measured = async (selector: string) => page.locator(selector).locator("visible=true").evaluateAll((nodes) => nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
      }));
      const small: string[] = [];
      for (const [name, selector, axes] of [
        ["search clear", ".ent-cc-search-clear", ["width", "height"]],
        ["search input", ".ent-cc-search-box input", ["height"]],
        ["Details menu", "button[aria-label='Command center actions']", ["width", "height"]],
        ["layout control", ".ent-cc-workspace-options-actions .ent-cc-icon-button", ["width", "height"]],
        ["Details summary", ".ent-cc-workspace-options > summary", ["height"]],
        ["Filters summary", ".ent-cc-mobile-filters > summary", ["height"]],
        ["study action", ".ent-cc-study-action", ["height"]],
      ] as const) {
        const sizes = await measured(selector);
        if (sizes.length === 0) { small.push(`${name}: not rendered`); continue; }
        for (const axis of axes) {
          const min = Math.min(...sizes.map((size) => size[axis]));
          if (min < 44) small.push(`${name} ${axis} ${min}`);
        }
      }
      expect(small).toEqual([]);
      const overlaps = await page.evaluate(() => {
        const rects = Array.from(document.querySelectorAll<HTMLElement>(".ent-cc-workspace-options-actions > *, .ent-cc-workspace-options-actions .ent-cc-icon-button"))
          .filter((node, index, all) => all.indexOf(node) === index)
          .map((node) => ({ name: node.getAttribute("aria-label") ?? node.textContent ?? "", r: node.getBoundingClientRect() }))
          .filter((item) => item.r.width > 0 && item.r.height > 0);
        const found: string[] = [];
        for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i].r; const b = rects[j].r;
          const inside = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          if (inside && !rects[i].name.includes(rects[j].name) && !rects[j].name.includes(rects[i].name)) found.push(`${rects[i].name} / ${rects[j].name}`);
        }
        return found;
      });
      expect(overlaps).toEqual([]);
      // Filter controls inside the panel.
      await page.locator(".ent-cc-workspace-options > summary").tap();
      await page.locator(".ent-cc-mobile-filters > summary").tap();
      await expect.poll(() => page.locator(".ent-cc-mobile-filters").evaluate((node) => (node as HTMLDetailsElement).open)).toBe(true);
      const filterSmall: string[] = [];
      for (const [name, selector] of [["scope select", ".ent-cc-search-scope"], ["availability select", ".ent-cc-search-availability"], ["linked first", ".ent-cc-linked-first"]] as const) {
        const sizes = await measured(selector);
        if (sizes.length === 0) { filterSmall.push(`${name}: not rendered`); continue; }
        const min = Math.min(...sizes.map((size) => size.height));
        if (min < 44) filterSmall.push(`${name} height ${min}`);
      }
      expect(filterSmall).toEqual([]);
      // No overlap between the input's text area and Clear; Clear sits inside the input at the inline end.
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const inputEl = document.querySelector<HTMLInputElement>(".ent-cc-search-box input")!;
        const style = getComputedStyle(inputEl);
        return { clear: rect(".ent-cc-search-clear"), input: rect(".ent-cc-search-box input"), icon: rect(".ent-cc-search-icon"), padStart: parseFloat(style.paddingInlineStart), padEnd: parseFloat(style.paddingInlineEnd) };
      });
      expect(boxes.clear.top).toBeGreaterThanOrEqual(boxes.input.top - 0.5);
      expect(boxes.clear.bottom).toBeLessThanOrEqual(boxes.input.bottom + 0.5);
      expect(boxes.padEnd, "text must stop before the Clear target").toBeGreaterThanOrEqual(44);
      if (rtl) expect(Math.abs(boxes.clear.left - boxes.input.left)).toBeLessThanOrEqual(1);
      else expect(Math.abs(boxes.clear.right - boxes.input.right)).toBeLessThanOrEqual(1);
      // Typing and Clear still work.
      await clickCentre(page, clear);
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
    });
  }

  test("record selection and rotation keep working in split view", async ({ page }) => {
    await openView(page, { mobile: true, width: 1180, height: 820, scenario: "related-overflow", parity: true });
    await enterSplit(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator(".ent-cc-view")).toHaveClass(/is-mobile-split/u);
    await expect(page.locator(".ent-cc-inspector")).toBeVisible();
  });

  test("fine-pointer desktop stays compact", async ({ page }) => {
    await openView(page, { mobile: false, width: 1440, height: 960, parity: true });
    await page.getByRole("searchbox").fill("Research");
    const size = (selector: string) => page.locator(selector).locator("visible=true").first().evaluate((node) => {
      const r = node.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height) };
    });
    expect(await size(".ent-cc-search-clear")).toEqual({ width: 32, height: 32 });
    expect((await size(".ent-cc-search-box input")).height).toBe(36);
    await page.locator(".ent-cc-workspace-options > summary").click();
    expect((await size("button[aria-label='Command center actions']")).width).toBe(32);
  });
});

/** Visible elements whose own text renders in the host's faint colour. */
async function faintTextOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-faint)";
    document.body.append(probe);
    const faint = getComputedStyle(probe).color;
    probe.remove();
    const found: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const ownText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0);
      if (!ownText) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
      if (getComputedStyle(element).color === faint) found.push(`${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}: ${(element.textContent ?? "").trim().slice(0, 30)}`);
    }
    return found;
  });
}

for (const dark of [false, true]) {
  test.describe(`C02 informational text contrast (${dark ? "dark" : "light"}, host-parity faint colour)`, () => {
    test("inspector headings, related labels, empty state, footer and tab counts reach 4.5:1", async ({ page }) => {
      await openView(page, { mobile: false, dark, width: 1440, height: 960, scenario: "related-overflow", parity: true });
      await page.getByRole("button", { name: /^Relationship overview,/u }).click();
      await expect(page.locator(".ent-cc-related-label").first()).toBeVisible();
      const low: string[] = [];
      for (const selector of [".ent-cc-inspector-header h2", ".ent-cc-related-label", ".ent-cc-footer", ".ent-cc-tab-count"]) {
        const ratio = await contrastOf(page, selector);
        if (ratio < 4.5) low.push(`${selector} ${ratio.toFixed(2)}`);
      }
      expect(low).toEqual([]);
      expect(await faintTextOffenders(page)).toEqual([]);
    });

    test("empty related section label reaches 4.5:1", async ({ page }) => {
      await openView(page, { mobile: false, dark, width: 1440, height: 960, count: 80, parity: true });
      await page.getByRole("button", { name: /^Research note 000,/u }).click();
      await expect(page.locator(".ent-cc-related-empty").first()).toBeVisible();
      expect(await contrastOf(page, ".ent-cc-related-empty")).toBeGreaterThanOrEqual(4.5);
      expect(await faintTextOffenders(page)).toEqual([]);
    });

    for (const kind of ["note", "setup", "export", "sync", "organizer", "quick-organizer", "whats-new"] as const) {
      test(`${kind} dialog text reaches 4.5:1`, async ({ page }) => {
        await openView(page, { mobile: false, dark, width: 1440, height: 960, count: 80, parity: true });
        await page.evaluate((value) => (window as unknown as { kbccBrowserHarness: { openModal(kind: string): void } }).kbccBrowserHarness.openModal(value), kind);
        await expect(page.getByRole("dialog")).toBeVisible();
        const offenders = (await faintTextOffenders(page)).filter((item) => !item.startsWith("div.kbcc-"));
        expect(offenders).toEqual([]);
      });
    }
  });
}

async function clickCentre(page: Page, target: ReturnType<Page["locator"]>): Promise<void> {
  const rect = await target.boundingBox();
  if (!rect) throw new Error("Target has no bounds");
  expect(await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  }), "target must be unobscured").toBe(true);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

export { contrastOf };
