import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Existing Playwright workflow: production renderers with an isolated synthetic
// host, not a physical iPhone/iPad or a native Obsidian claim.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let css: string;
let hostCss: string;
const errorsByPage = new WeakMap<Page, string[]>();
const networkByPage = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const [built, product, host] = await Promise.all([
    build({ entryPoints: [path.join(root, "tests/browser/view-harness.ts")], bundle: true, write: false,
      format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } }),
    readFile(path.join(root, "styles.css"), "utf8"), readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  css = product; hostCss = host;
});

async function open(page: Page, { mobile = true, width = 1180, height = 820, dark = false, galleryTitleStress = false } = {}): Promise<void> {
  const errors: string[] = [];
  const network: string[] = [];
  errorsByPage.set(page, errors);
  networkByPage.set(page, network);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  // All fixture assets are inline or generated local image data. Any attempted
  // network request is a regression, regardless of which hostname it targets.
  await page.route("**/*", async (route) => { network.push(route.request().url()); await route.abort(); });
  await page.setViewportSize({ width, height });
  await page.goto(`about:blank#mobile=${mobile}&scenario=library-gallery&galleryTitleStress=${galleryTitleStress}`);
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC Library gallery · synthetic vault</title></head><body class="${dark ? "theme-dark" : "theme-light"}${mobile ? " is-mobile" : ""}"><main id="kbcc-view" class="view-content"></main></body></html>`);
  await page.addStyleTag({ content: hostCss });
  // The native host gives ordinary buttons a fixed height. This synthetic rule
  // reproduces that constraint without importing a real vault or theme.
  if (galleryTitleStress) await page.addStyleTag({ content: "button { height: var(--input-height); }" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccBrowserHarness?: { ready: boolean } }).kbccBrowserHarness?.ready))).toBe(true);
  await expect(page).toHaveTitle("KBCC Library gallery · synthetic vault");
  expect(page.url()).toContain("scenario=library-gallery");
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(8);
  await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal")).toHaveCount(0);
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Evidence must stay outside the repository");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-gallery-${name}.png`) });
}

async function expectPinnedSave(dialog: Locator): Promise<void> {
  // Check the actual first-viewport hit target; locator.click() would conceal
  // the original below-the-fold bug by automatically scrolling the button.
  const geometry = await dialog.getByRole("button", { name: "Save display", exact: true }).evaluate((element) => {
    const r = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const footer = element.closest<HTMLElement>(".ent-cc-library-settings-footer")!;
    const body = element.closest(".modal")!.querySelector<HTMLElement>(".ent-cc-library-settings-scroll")!;
    return { visible: r.top >= top && r.bottom <= bottom && r.left >= 0 && r.right <= window.innerWidth,
      hit: element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      width: r.width, height: r.height, bodyHeight: body.clientHeight,
      separate: body.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1,
      noOverflow: footer.scrollWidth <= footer.clientWidth + 1 };
  });
  expect(geometry.visible, "Save stays within the visible viewport without scrolling").toBe(true);
  expect(geometry.hit, "Save is not hidden behind another element").toBe(true);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.bodyHeight).toBeGreaterThan(40);
  expect(geometry.separate).toBe(true);
  expect(geometry.noOverflow).toBe(true);
}

async function savedImageProperty(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as {
    kbccBrowserHarness: { libraryDisplaySnapshot(): { imageProperty: string } };
  }).kbccBrowserHarness.libraryDisplaySnapshot().imageProperty);
}

async function expectCompactPlaceholder(cover: Locator): Promise<void> {
  await expect(cover).toHaveClass(/is-placeholder/u);
  const geometry = await cover.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return { width: bounds.width, height: bounds.height, aspectRatio: getComputedStyle(element).aspectRatio,
      noOverflow: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      contentsInside: [...range.getClientRects()].every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
        && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1) };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeLessThanOrEqual(88);
  expect(geometry.aspectRatio).toBe("auto");
  expect(geometry.noOverflow).toBe(true);
  expect(geometry.contentsInside).toBe(true);
}

async function expectFullCardTitle(card: Locator): Promise<void> {
  const geometry = await card.evaluate((element) => {
    const title = element.querySelector<HTMLElement>(".ent-cc-subject-title")!;
    const action = element.querySelector<HTMLElement>(".ent-cc-row-more")!;
    const bounds = element.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const actionBounds = action.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(title);
    return { titleHeight: titleBounds.height, actionWidth: actionBounds.width, actionHeight: actionBounds.height,
      noOverflow: title.scrollWidth <= title.clientWidth + 1 && title.scrollHeight <= title.clientHeight + 1
        && element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      allTextInside: [...range.getClientRects()].every((rect) => rect.left >= titleBounds.left - 1 && rect.right <= titleBounds.right + 1
        && rect.top >= titleBounds.top - 1 && rect.bottom <= titleBounds.bottom + 1),
      titleInsideCard: titleBounds.top >= bounds.top && titleBounds.bottom <= bounds.bottom,
      separateAction: titleBounds.right <= actionBounds.left + 1 || titleBounds.left >= actionBounds.right - 1 };
  });
  expect(geometry.titleHeight).toBeGreaterThan(44);
  expect(geometry.actionWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.actionHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.noOverflow).toBe(true);
  expect(geometry.allTextInside).toBe(true);
  expect(geometry.titleInsideCard).toBe(true);
  expect(geometry.separateAction).toBe(true);
}

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page) ?? []).toEqual([]);
  expect(networkByPage.get(page) ?? [], "Vault-only galleries do not request network assets").toEqual([]);
});

for (const device of [
  { name: "phone320", mobile: true, width: 320, height: 740 },
  { name: "phone390", mobile: true, width: 390, height: 844 },
  { name: "phone-landscape844", mobile: true, width: 844, height: 390 },
  { name: "tablet820", mobile: true, width: 820, height: 1180 },
  { name: "tablet1180", mobile: true, width: 1180, height: 820 },
  { name: "desktop1440-dark", mobile: false, width: 1440, height: 960, dark: true },
]) {
  test.describe(device.name, () => {
    test.use({ hasTouch: device.mobile });
    test("Save is always reachable and cover property drafts persist only after saving", async ({ page }) => {
      await open(page, device);
      // The first synthetic note uses capitalized Cover; default cover resolves
      // it without any note mutation. The second uses a local Markdown link.
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 0.md"] img')).toHaveJSProperty("naturalWidth", 400);
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 1.md"] img')).toHaveJSProperty("naturalWidth", 400);
      const settings = page.getByRole("button", { name: "Library settings", exact: true });
      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Library settings — Books" });
      await dialog.getByRole("button", { name: "Display", exact: true }).click();
      await expectPinnedSave(dialog);
      await capture(page, `${device.name}-save-first-viewport`);
      await dialog.getByRole("textbox", { name: "Image property", exact: true }).fill("Cover");
      await expect(dialog.locator(".ent-cc-library-settings-status")).toContainText("Unsaved changes");
      expect(await savedImageProperty(page)).toBe("cover");
      const scroll = dialog.locator(".ent-cc-library-settings-scroll");
      for (const position of [0, 0.5, 1]) {
        await scroll.evaluate((element, fraction) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction; }, position);
        await expectPinnedSave(dialog);
      }
      await capture(page, `${device.name}-save-unsaved`);
      const save = dialog.getByRole("button", { name: "Save display", exact: true });
      const bounds = (await save.boundingBox())!;
      if (device.mobile) await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      else await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(dialog.locator(".ent-cc-library-settings-status")).toHaveText("Display saved");
      expect(await savedImageProperty(page)).toBe("Cover");
      await expectPinnedSave(dialog);
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
      await settings.click();
      await dialog.getByRole("button", { name: "Display", exact: true }).click();
      await expect(dialog.getByRole("textbox", { name: "Image property", exact: true })).toHaveValue("Cover");
      await expectPinnedSave(dialog);
    });
    test("missing covers are compact and long titles remain fully visible under fixed-height host buttons", async ({ page }) => {
      await open(page, { ...device, galleryTitleStress: true });
      const covers = page.locator(".ent-cc-library-cover.is-placeholder");
      await expect(covers).toHaveCount(4);
      for (const cover of await covers.all()) await expectCompactPlaceholder(cover);
      const readyCover = page.locator(".ent-cc-library-cover:not(.is-placeholder)").first();
      await expect(readyCover.locator("img")).toHaveJSProperty("naturalWidth", 400);
      const imageBounds = await readyCover.boundingBox();
      expect(imageBounds!.width / imageBounds!.height).toBeCloseTo(2 / 3, 2);
      for (const index of [4, 5, 6, 7]) await expectFullCardTitle(page.locator(".ent-cc-library-card").nth(index));
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 5.md"] .ent-cc-subject-title')).toHaveAttribute("dir", "auto");
      const placeholderCard = page.locator('.ent-cc-library-card[data-record-path="Reading/Book 4.md"]');
      await placeholderCard.scrollIntoViewIfNeeded();
      await capture(page, `${device.name}-compact-placeholders`);
      await placeholderCard.locator(".ent-cc-library-cover-button").click();
      if (device.mobile) await page.getByRole("button", { name: "Back to main page", exact: true }).click();
      await expect(placeholderCard).toHaveClass(/is-selected/u);
      await expectCompactPlaceholder(placeholderCard.locator(".ent-cc-library-cover"));
    });
    test("Library cards keep hierarchy, readable covers, metadata and unobscured settings controls", async ({ page }) => {
      await open(page, device);
      await expect(page.locator(".ent-cc-library-card-grid")).toHaveCount(3);
      await expect(page.locator(".ent-cc-library-card-grid").nth(0).locator(".ent-cc-library-card")).toHaveCount(4);
      await expect(page.getByText("Unplaced Books", { exact: true })).toBeVisible();
      await expect(page.locator(".ent-cc-library-cover img").first()).toHaveJSProperty("naturalWidth", 400);
      await expect(page.locator(".ent-cc-library-cover img").first()).toHaveAttribute("loading", "lazy");
      await expect(page.locator(".ent-cc-library-card-property").first()).toContainText("A. Researcher");
      expect(await page.locator(".ent-cc-shell").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.locator(".ent-cc-library-card").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
      const settings = page.getByRole("button", { name: "Library settings", exact: true });
      const bounds = await settings.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44); expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await settings.evaluate((element) => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      await capture(page, device.name);
      await page.locator(".ent-cc-library-cover-button").first().click();
      if (device.mobile) {
        await expect(page.getByRole("dialog", { name: "Selected knowledge record Atlas of discovery", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Back to main page", exact: true }).click();
      }
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 0.md"]')).toHaveClass(/is-selected/u);
      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Library settings — Books" });
      await expect(dialog.getByRole("button", { name: "Rename…", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Archive…", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Display", exact: true }).click();
      await expect(dialog.locator(".ent-cc-library-cover-info")).toContainText("Covers use images stored in this vault. Online images are not supported in this release.");
      await expect(dialog.getByRole("button", { name: /(?:Allow|Block) external images/u })).toHaveCount(0);
      await expect(dialog.getByRole("textbox", { name: "Image property", exact: true })).toHaveValue("cover");
      await dialog.locator(".ent-cc-library-cover-info").scrollIntoViewIfNeeded();
      await capture(page, `${device.name}-vault-cover-guidance`);
      expect(networkByPage.get(page)).toEqual([]);
      await expect(dialog.getByRole("combobox", { name: "Layout", exact: true })).toHaveValue("cards");
      expect((await dialog.getByRole("combobox", { name: "Layout", exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await dialog.getByRole("combobox", { name: "Card size", exact: true }).selectOption("small");
      await dialog.getByRole("combobox", { name: "Image proportions", exact: true }).selectOption("square");
      await dialog.getByRole("combobox", { name: "Image fit", exact: true }).selectOption("cover");
      await dialog.getByRole("textbox", { name: "Visible properties", exact: true }).fill("author, year");
      await capture(page, `${device.name}-settings`);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await dialog.getByRole("button", { name: "Save display", exact: true }).click();
      await expect(page.locator(".ent-cc-library-card-grid").first()).toHaveClass(/ent-cc-library-card-size-small/u);
      await expect(page.locator(".ent-cc-library-cover").first()).toHaveClass(/ent-cc-library-cover-square ent-cc-library-cover-cover/u);
      await expect(page.locator(".ent-cc-library-card").first()).toContainText("2026");
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
      await settings.click();
      await dialog.getByRole("button", { name: "Display", exact: true }).click();
      await expect(dialog.getByRole("combobox", { name: "Card size", exact: true })).toHaveValue("small");
      await dialog.getByRole("combobox", { name: "Layout", exact: true }).selectOption("list");
      await dialog.getByRole("button", { name: "Save display", exact: true }).click();
      await expect(page.locator(".ent-cc-library-card")).toHaveCount(0);
      await expect(page.locator(".ent-cc-subject-row")).toHaveCount(8);
      expect(networkByPage.get(page), "opening and saving profiles must not load network images").toEqual([]);
    });
  });
}

for (const device of [
  { name: "phone", mobile: true, width: 390, height: 844 },
  { name: "tablet", mobile: true, width: 820, height: 1180 },
  { name: "desktop", mobile: false, width: 1024, height: 420 },
]) {
  test(`Library settings ${device.name} keeps Save and focused fields usable in a short visual viewport`, async ({ page }) => {
    await open(page, device);
    await page.getByRole("button", { name: "Library settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Library settings — Books" });
    await dialog.getByRole("button", { name: "Display", exact: true }).click();
    // Synthetic geometry only: not a physical keyboard/VoiceOver/safe-area pass.
    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual viewport unavailable");
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 320 });
      Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 20 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    const field = dialog.getByRole("textbox", { name: "Image property", exact: true });
    await field.fill("Cover");
    await expect(field).toBeFocused();
    await expectPinnedSave(dialog);
    await expect.poll(() => field.evaluate((element) => {
      const field = element.getBoundingClientRect();
      const scroll = element.closest(".ent-cc-library-settings-scroll")!.getBoundingClientRect();
      return field.top >= scroll.top - 1 && field.bottom <= scroll.bottom + 1;
    })).toBe(true);
    await capture(page, `${device.name}-short-visual-viewport`);
    const save = dialog.getByRole("button", { name: "Save display", exact: true });
    const box = (await save.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dialog.locator(".ent-cc-library-settings-status")).toHaveText("Display saved");
    expect(await savedImageProperty(page)).toBe("Cover");
  });
}

test.describe("small Cards on a narrow phone", () => {
  test.use({ hasTouch: true });

  test("long LTR/RTL titles and blocked or missing cover labels fit the smallest cards", async ({ page }) => {
    await open(page, { width: 320, height: 740, galleryTitleStress: true });
    await page.getByRole("button", { name: "Library settings", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Library settings — Books" });
    await dialog.getByRole("button", { name: "Display", exact: true }).tap();
    await dialog.getByRole("combobox", { name: "Card size", exact: true }).selectOption("small");
    await dialog.getByRole("button", { name: "Save display", exact: true }).tap();
    await expect(page.locator(".ent-cc-library-card-grid").first()).toHaveClass(/ent-cc-library-card-size-small/u);
    await dialog.getByRole("button", { name: "Close", exact: true }).last().tap();

    for (const direction of ["ltr", "rtl"]) {
      await page.evaluate((value) => { document.documentElement.dir = value; }, direction);
      for (const index of [4, 5, 6, 7]) await expectFullCardTitle(page.locator(".ent-cc-library-card").nth(index));
      for (const cover of await page.locator(".ent-cc-library-cover.is-placeholder").all()) await expectCompactPlaceholder(cover);
      const blocked = page.locator('.ent-cc-library-card[data-record-path="Reading/Book 3.md"] .ent-cc-library-cover');
      await expect(blocked).toHaveText("Online covers unsupported");
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 4.md"] .ent-cc-library-cover')).toHaveText("Image not found in vault");
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 5.md"] .ent-cc-library-cover')).toHaveText("Cover property is empty");
      await expect(page.locator('.ent-cc-library-card[data-record-path="Reading/Book 5.md"] .ent-cc-subject-title')).toHaveCSS("direction", "rtl");
      expect(await page.locator(".ent-cc-shell").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await blocked.scrollIntoViewIfNeeded();
      await capture(page, `phone320-small-${direction}-blocked-cover`);
      await page.locator('.ent-cc-library-card[data-record-path="Reading/Book 5.md"]').scrollIntoViewIfNeeded();
      await capture(page, `phone320-small-${direction}-full-titles`);
    }
    expect(networkByPage.get(page), "small-card layout changes never load network images").toEqual([]);
  });
});

test("Library settings explain vault-only covers and offer no remote permission control", async ({ page }) => {
  await open(page, { mobile: false, width: 1440, height: 960 });
  const externalCover = page.locator('.ent-cc-library-card[data-record-path="Reading/Book 3.md"] .ent-cc-library-cover');
  await expectCompactPlaceholder(externalCover);
  await expect(externalCover).toHaveText("Online covers unsupported");
  await expect(externalCover.locator("img")).toHaveCount(0);
  await expect(page.locator(".ent-cc-library-cover img").first()).toHaveJSProperty("naturalWidth", 400);
  await page.getByRole("button", { name: "Library settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Library settings — Books" });
  await dialog.getByRole("button", { name: "Display", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Cover images", exact: true })).toBeVisible();
  await expect(dialog.locator(".ent-cc-library-cover-info")).toContainText("Covers use images stored in this vault. Online images are not supported in this release.");
  await expect(dialog.getByRole("button", { name: /(?:Allow|Block) external images/u })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Image property", exact: true })).toHaveValue("cover");
  await dialog.getByRole("button", { name: "Save display", exact: true }).click();
  await expect(externalCover.locator("img")).toHaveCount(0);
  expect(networkByPage.get(page)).toEqual([]);
  await dialog.locator(".ent-cc-library-cover-info").scrollIntoViewIfNeeded();
  await capture(page, "vault-only-settings");
});

test("an image error replaces its portrait frame with a compact readable fallback", async ({ page }) => {
  await open(page, { mobile: true, width: 390, height: 844 });
  const cover = page.locator(".ent-cc-library-cover").first();
  await expect(cover.locator("img")).toHaveJSProperty("naturalWidth", 400);
  await cover.locator("img").dispatchEvent("error");
  await expect(cover.locator("img")).toHaveCount(0);
  await expect(cover).toContainText("Image could not load");
  await expectCompactPlaceholder(cover);
});

test("Arrange temporarily uses a list and restores cards without changing their saved settings", async ({ page }) => {
  await open(page, { mobile: false, width: 1440, height: 960 });
  const options = page.locator(".ent-cc-workspace-options summary");
  if (await options.count()) await options.click();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(0);
  await expect(page.getByText(/Cards are temporarily shown as a list while arranging/u)).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(8);
});

test("scoped Library filters retain cards while all-base search uses the existing list", async ({ page }) => {
  await open(page, { mobile: false, width: 1440, height: 960 });
  await page.getByRole("combobox", { name: "Search scope", exact: true }).selectOption("library");
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(8);
  await page.getByRole("combobox", { name: "Note availability", exact: true }).selectOption("linked");
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(7);
  await page.getByRole("combobox", { name: "Note availability", exact: true }).selectOption("placeholders");
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(1);
  await expect(page.locator(".ent-cc-library-card")).toContainText("Reading wish list");
  await page.getByRole("combobox", { name: "Search scope", exact: true }).selectOption("all");
  await expect(page.locator(".ent-cc-library-card")).toHaveCount(0);
  await expect(page.locator(".ent-cc-subject-row")).toHaveCount(1);
});
