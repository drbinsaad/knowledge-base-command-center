import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(root, "tests", "layout", "fixtures", "note-organizer.html");
const stylesPath = path.join(root, "styles.css");

type OrganizerStage = "notes" | "destinations" | "review";

interface LayoutVariant {
  name: string;
  viewport: { width: number; height: number };
  direction: "ltr" | "rtl";
  fontSize: number;
  phone: boolean;
}

const variants: LayoutVariant[] = [
  { name: "desktop LTR", viewport: { width: 1440, height: 940 }, direction: "ltr", fontSize: 16, phone: false },
  { name: "desktop RTL", viewport: { width: 1440, height: 940 }, direction: "rtl", fontSize: 16, phone: false },
  { name: "desktop LTR at 200% text", viewport: { width: 1600, height: 1000 }, direction: "ltr", fontSize: 32, phone: false },
  { name: "phone LTR", viewport: { width: 390, height: 844 }, direction: "ltr", fontSize: 16, phone: true },
  { name: "phone RTL", viewport: { width: 390, height: 844 }, direction: "rtl", fontSize: 16, phone: true },
  { name: "phone LTR at 125% text", viewport: { width: 430, height: 932 }, direction: "ltr", fontSize: 20, phone: true },
];

const landscapePhoneVariants: LayoutVariant[] = [
  { name: "emulated phone landscape LTR", viewport: { width: 1267, height: 400 }, direction: "ltr", fontSize: 16, phone: true },
  { name: "emulated phone landscape RTL", viewport: { width: 844, height: 390 }, direction: "rtl", fontSize: 16, phone: true },
];

const stageActions: Record<OrganizerStage, readonly string[]> = {
  notes: ["Cancel", "Choose destinations"],
  destinations: ["Cancel", "Back to notes", "Prepare review"],
  review: ["Cancel", "Back to destinations", "Apply organization"],
};

async function loadFixture(page: Page, variant: LayoutVariant): Promise<void> {
  const [fixture, styles] = await Promise.all([readFile(fixturePath, "utf8"), readFile(stylesPath, "utf8")]);
  await page.setViewportSize(variant.viewport);
  await page.setContent(fixture);
  await page.addStyleTag({ content: styles });
  await page.evaluate(({ direction, fontSize }) => {
    document.documentElement.dir = direction;
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, variant);
}

async function showStage(page: Page, stage: OrganizerStage): Promise<Locator> {
  await page.evaluate((nextStage) => {
    (window as unknown as { showFixtureStage(stage: OrganizerStage): void }).showFixtureStage(nextStage);
  }, stage);
  const surface = page.locator(`[data-stage="${stage}"]`);
  await expect(surface).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-active-stage", stage);
  return surface;
}

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

function intersects(first: Box, second: Box, tolerance = 0.75): boolean {
  return first.x + first.width > second.x + tolerance
    && second.x + second.width > first.x + tolerance
    && first.y + first.height > second.y + tolerance
    && second.y + second.height > first.y + tolerance;
}

async function expectNoGroupedOverlap(scope: Locator, label: string): Promise<void> {
  const groups = await scope.locator("[data-layout-group]").all();
  for (const [groupIndex, group] of groups.entries()) {
    const boxes = (await Promise.all((await group.locator(":scope > *").all()).map(async (item) => item.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      return {
        box: {
          x: htmlElement.offsetLeft,
          y: htmlElement.offsetTop,
          width: htmlElement.offsetWidth,
          height: htmlElement.offsetHeight,
        },
        text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 60) ?? "",
      };
    })))).filter((item): item is { box: Box; text: string } => item.box.width > 0 && item.box.height > 0);
    for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
        const first = boxes[firstIndex];
        const second = boxes[secondIndex];
        if (!first || !second) continue;
        expect(
          intersects(first.box, second.box),
          `${label} layout group ${groupIndex + 1}: “${first.text}” must not overlap “${second.text}”`,
        ).toBe(false);
      }
    }
  }
}

async function expectNoHorizontalOverflow(page: Page, stage: Locator, label: string): Promise<void> {
  const documentGeometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentGeometry.scrollWidth, `${label}: document must not scroll horizontally`).toBeLessThanOrEqual(documentGeometry.clientWidth + 1);

  const surfaces = stage.locator([
    ".ent-cc-note-organizer-panel",
    ".ent-cc-note-organizer-notes-layout",
    ".ent-cc-note-organizer-browser",
    ".ent-cc-note-organizer-selected",
    ".ent-cc-note-organizer-tree-item",
    ".ent-cc-note-organizer-selected-item",
    ".ent-cc-note-organizer-destination-section",
    ".ent-cc-note-organizer-destination-card",
    ".ent-cc-note-organizer-overrides",
    ".ent-cc-note-organizer-override-row",
    ".ent-cc-note-organizer-custom-editor",
    ".ent-cc-note-organizer-clear-confirmation",
    ".ent-cc-note-organizer-pagination",
    ".ent-cc-note-organizer-review-row",
    ".ent-cc-note-organizer-footer",
  ].join(","));
  for (const [index, surface] of (await surfaces.all()).entries()) {
    const geometry = await surface.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth, `${label}: rendered surface ${index + 1} must not overflow horizontally`).toBeLessThanOrEqual(geometry.clientWidth + 1);
  }

  for (const [index, step] of (await page.locator("[data-step]").all()).entries()) {
    const geometry = await step.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(geometry.scrollWidth, `${label}: progress step ${index + 1} must contain its label`).toBeLessThanOrEqual(geometry.clientWidth + 1);
  }
}

async function expectOrganizerTargets(stage: Locator, label: string): Promise<void> {
  const controls = stage.locator([
    ".ent-cc-note-organizer-search",
    ".ent-cc-note-organizer-tree-toggle",
    ".ent-cc-note-organizer-checkbox-target",
    ".ent-cc-note-organizer-text-button",
    ".ent-cc-note-organizer-remove",
    ".ent-cc-note-organizer-primary-button",
    ".ent-cc-note-organizer-secondary-button",
    ".ent-cc-note-organizer-field select",
    ".ent-cc-note-organizer-override-mode",
    ".ent-cc-note-organizer-clear-confirmation",
  ].join(","));
  for (const [index, control] of (await controls.all()).entries()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.width, `${label}: control ${index + 1} target width`).toBeGreaterThanOrEqual(43.5);
    expect(box.height, `${label}: control ${index + 1} target height`).toBeGreaterThanOrEqual(43.5);
  }
}

async function expectSequentialActions(page: Page, stage: Locator, stageName: OrganizerStage, phone: boolean, label: string): Promise<void> {
  const actionButtons = stage.locator(".ent-cc-note-organizer-footer button");
  await expect(actionButtons).toHaveText(stageActions[stageName]);

  const cancel = stage.locator(".fixture-action-cancel");
  await cancel.focus();
  await expect(cancel).toBeFocused();
  for (const expected of stageActions[stageName].slice(1)) {
    await page.keyboard.press("Tab");
    await expect(stage.getByRole("button", { name: expected, exact: true })).toBeFocused();
  }

  if (phone) {
    const boxes = await Promise.all((await actionButtons.all()).map((button) => button.boundingBox()));
    const visible = boxes.filter((box): box is Box => box !== null);
    for (let index = 1; index < visible.length; index += 1) {
      const previous = visible[index - 1];
      const current = visible[index];
      if (!previous || !current) continue;
      expect(current.y, `${label}: mobile actions retain DOM order from top to bottom`).toBeGreaterThanOrEqual(previous.y + previous.height - 0.75);
    }
  }
}

async function expectLandscapeStageUsable(stage: Locator, label: string): Promise<void> {
  const panel = stage.locator(".ent-cc-note-organizer-panel");
  const footer = stage.locator(".ent-cc-note-organizer-footer");
  const heading = panel.locator(".ent-cc-note-organizer-section-heading");
  const [stageBox, panelBox, footerBox, headingBox] = await Promise.all([
    stage.boundingBox(),
    panel.boundingBox(),
    footer.boundingBox(),
    heading.boundingBox(),
  ]);

  expect(stageBox, `${label}: stage has geometry`).not.toBeNull();
  expect(panelBox, `${label}: scrollable body has geometry`).not.toBeNull();
  expect(footerBox, `${label}: footer has geometry`).not.toBeNull();
  expect(headingBox, `${label}: body heading has geometry`).not.toBeNull();
  if (!stageBox || !panelBox || !footerBox || !headingBox) return;

  expect(panelBox.height, `${label}: body retains a usable visible scrollport`).toBeGreaterThanOrEqual(80);
  expect(panelBox.height / stageBox.height, `${label}: body retains most of the short stage height`).toBeGreaterThanOrEqual(0.55);
  expect(intersects(panelBox, footerBox), `${label}: footer must not cover the body`).toBe(false);
  expect(footerBox.y + footerBox.height, `${label}: footer stays inside the stage`).toBeLessThanOrEqual(stageBox.y + stageBox.height + 0.75);
  expect(footerBox.height, `${label}: footer actions stay on one compact row`).toBeLessThanOrEqual(60);
  expect(headingBox.y, `${label}: body heading starts inside the scrollport`).toBeGreaterThanOrEqual(panelBox.y - 0.75);
  expect(headingBox.y + Math.min(headingBox.height, 20), `${label}: body heading remains visibly usable`).toBeLessThanOrEqual(panelBox.y + panelBox.height + 0.75);

  const panelGeometry = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(panelGeometry.clientHeight, `${label}: body exposes a non-zero client height`).toBeGreaterThanOrEqual(80);
  expect(panelGeometry.scrollHeight, `${label}: overflowing review content stays available by scrolling`).toBeGreaterThan(panelGeometry.clientHeight);

  const actionTops: number[] = [];
  for (const [index, action] of (await footer.locator("button").all()).entries()) {
    const actionBox = await action.boundingBox();
    expect(actionBox, `${label}: footer action ${index + 1} is visible`).not.toBeNull();
    if (!actionBox) continue;
    actionTops.push(actionBox.y);
    expect(actionBox.height, `${label}: footer action ${index + 1} keeps a 44px target`).toBeGreaterThanOrEqual(43.5);
    expect(actionBox.y, `${label}: footer action ${index + 1} starts inside the footer`).toBeGreaterThanOrEqual(footerBox.y - 0.75);
    expect(actionBox.y + actionBox.height, `${label}: footer action ${index + 1} stays inside the footer`).toBeLessThanOrEqual(footerBox.y + footerBox.height + 0.75);
  }
  expect(Math.max(...actionTops) - Math.min(...actionTops), `${label}: footer actions share one row`).toBeLessThanOrEqual(0.75);
}

async function expectIndicators(page: Page, variant: LayoutVariant): Promise<void> {
  const indicatorSurface = page.locator("#membership-indicators");
  await indicatorSurface.scrollIntoViewIfNeeded();
  const indicators = indicatorSurface.locator(".ent-cc-note-membership-indicator");
  await expect(indicators).toHaveCount(5);
  const colors: string[] = [];
  for (const [index, indicator] of (await indicators.all()).entries()) {
    await expect(indicator, `${variant.name}: indicator ${index + 1} should remain visible`).toBeVisible();
    await expect(indicator).toHaveAttribute("aria-label", /.+/u);
    const box = await indicator.boundingBox();
    expect(box, `${variant.name}: indicator ${index + 1} has geometry`).not.toBeNull();
    if (box) {
      expect(box.width, `${variant.name}: indicator ${index + 1} width`).toBeGreaterThanOrEqual(variant.phone ? 43.5 : 31.5);
      expect(box.height, `${variant.name}: indicator ${index + 1} height`).toBeGreaterThanOrEqual(variant.phone ? 43.5 : 31.5);
    }
    colors.push(await indicator.evaluate((element) => getComputedStyle(element).color));
  }
  expect(new Set(colors).size, `${variant.name}: indicator states retain visibly distinct colors`).toBeGreaterThanOrEqual(4);

  const countedIndicators = indicatorSurface.locator(".ent-cc-note-membership-indicator[data-kbcc-count]");
  await expect(countedIndicators).toHaveCount(2);
  for (const counted of await countedIndicators.all()) {
    const pseudo = await counted.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return {
        content: style.content,
        fontSize: Number.parseFloat(style.fontSize),
        height: Number.parseFloat(style.height),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(pseudo.content, `${variant.name}: count badge exposes its configured count`).toMatch(/[23]/u);
    expect(pseudo.fontSize, `${variant.name}: count badge text stays rendered`).toBeGreaterThan(0);
    expect(pseudo.height, `${variant.name}: count badge has visible height`).toBeGreaterThanOrEqual(pseudo.fontSize);
    expect(pseudo.lineHeight, `${variant.name}: count badge line box contains its text`).toBeGreaterThanOrEqual(pseudo.fontSize);
  }
  const issueEdge = indicatorSurface.locator('[data-fixture-surface="membership-issue-edge"]');
  const issueBorder = await issueEdge.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.borderInlineStartColor,
      width: Number.parseFloat(style.borderInlineStartWidth),
    };
  });
  expect(issueBorder.width, `${variant.name}: non-current broken membership keeps a visible danger edge`).toBeGreaterThanOrEqual(3);
  expect(issueBorder.color, `${variant.name}: broken membership edge uses the configured error color`).toBe("rgb(255, 107, 107)");
  await expectNoGroupedOverlap(indicatorSurface, `${variant.name} indicators`);
}

for (const variant of variants) {
  test(`${variant.name}: organizer stages reflow, preserve targets, and keep sequential actions`, async ({ page }) => {
    await loadFixture(page, variant);

    const dialog = page.locator("#organizer");
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-labelledby", "organizer-title");
    await expect(dialog).toHaveAttribute("aria-describedby", "organizer-boundary");
    await expect(page.locator(".ent-cc-note-organizer-panel[role=\"tabpanel\"]")).toHaveCount(0);
    await expect(page.locator(".ent-cc-note-organizer-live")).toHaveCount(1);
    await expect(page.locator(".ent-cc-note-organizer-render-root")).toHaveAttribute("aria-busy", "false");

    const expectedFixtureSurfaces = [
      "add-collection-target",
      "replace-confirmation",
      "custom-destination-editor",
      "override-pagination",
      "refresh-review",
      "review-pagination",
    ];
    for (const surface of expectedFixtureSurfaces) {
      await expect(page.locator(`[data-fixture-surface="${surface}"]`), `${variant.name}: fixture includes ${surface}`).toHaveCount(1);
    }

    for (const stageName of ["notes", "destinations", "review"] as const) {
      const stage = await showStage(page, stageName);
      const label = `${variant.name} ${stageName}`;
      await expectNoHorizontalOverflow(page, stage, label);
      await expectNoGroupedOverlap(stage, label);
      await expectOrganizerTargets(stage, label);
      await expectSequentialActions(page, stage, stageName, variant.phone, label);
    }

    await showStage(page, "notes");
    const selectedPadding = await page.locator(".ent-cc-note-organizer-selected-item").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        inlineStart: Number.parseFloat(style.paddingInlineStart),
        inlineEnd: Number.parseFloat(style.paddingInlineEnd),
        left: Number.parseFloat(style.paddingLeft),
        right: Number.parseFloat(style.paddingRight),
      };
    });
    expect(selectedPadding.inlineStart, `${variant.name}: selected row keeps the larger logical start inset`).toBeGreaterThan(selectedPadding.inlineEnd);
    if (variant.direction === "rtl") {
      expect(selectedPadding.right, `${variant.name}: RTL selected-row start inset mirrors to the right`).toBeGreaterThan(selectedPadding.left);
    } else {
      expect(selectedPadding.left, `${variant.name}: LTR selected-row start inset remains on the left`).toBeGreaterThan(selectedPadding.right);
    }
    await page.getByRole("button", { name: "Choose destinations", exact: true }).click();
    await expect(page.locator('[data-stage="destinations"]')).toBeVisible();
    await page.getByRole("button", { name: "Prepare review", exact: true }).click();
    await expect(page.locator('[data-stage="review"]')).toBeVisible();
    await page.getByRole("button", { name: "Back to destinations", exact: true }).click();
    await expect(page.locator('[data-stage="destinations"]')).toBeVisible();

    await expectIndicators(page, variant);
  });
}

test.describe("touch phone landscape", () => {
  test.use({ hasTouch: true });

  for (const variant of landscapePhoneVariants) {
    test(`${variant.name}: review body and actions remain usable`, async ({ page }) => {
      await loadFixture(page, variant);
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        `${variant.name}: fixture exercises the coarse-pointer mobile rules`,
      ).toBe(true);

      const stage = await showStage(page, "review");
      await expectNoHorizontalOverflow(page, stage, `${variant.name} review`);
      await expectNoGroupedOverlap(stage, `${variant.name} review`);
      await expectOrganizerTargets(stage, `${variant.name} review`);
      await expectSequentialActions(page, stage, "review", false, `${variant.name} review`);
      await expectLandscapeStageUsable(stage, `${variant.name} review`);
    });
  }
});
