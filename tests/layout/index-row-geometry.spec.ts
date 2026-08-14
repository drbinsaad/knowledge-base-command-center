import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(root, "tests", "layout", "fixtures", "index-rows.html");
const stylesPath = path.join(root, "styles.css");

interface LayoutVariant {
  name: string;
  viewportWidth: number;
  surfaceWidth: number;
  direction: "ltr" | "rtl";
  fontSize: number;
  zoom: number;
  compactClass?: "is-pane-compact" | "is-pane-narrow";
  compactGeometry: boolean;
}

const variants: LayoutVariant[] = [
  { name: "wide desktop LTR", viewportWidth: 1600, surfaceWidth: 1240, direction: "ltr", fontSize: 16, zoom: 1, compactGeometry: false },
  { name: "wide desktop RTL at 150% text", viewportWidth: 1600, surfaceWidth: 1240, direction: "rtl", fontSize: 24, zoom: 1, compactGeometry: false },
  { name: "wide desktop at 125% zoom", viewportWidth: 1600, surfaceWidth: 1040, direction: "ltr", fontSize: 16, zoom: 1.25, compactGeometry: false },
  { name: "compact pane LTR", viewportWidth: 1280, surfaceWidth: 720, direction: "ltr", fontSize: 16, zoom: 1, compactClass: "is-pane-compact", compactGeometry: true },
  { name: "compact pane RTL at 150% text", viewportWidth: 1280, surfaceWidth: 720, direction: "rtl", fontSize: 24, zoom: 1, compactClass: "is-pane-narrow", compactGeometry: true },
  { name: "phone-width LTR", viewportWidth: 390, surfaceWidth: 358, direction: "ltr", fontSize: 16, zoom: 1, compactGeometry: true },
  { name: "phone-width RTL at 125% text", viewportWidth: 390, surfaceWidth: 358, direction: "rtl", fontSize: 20, zoom: 1, compactGeometry: true },
];

async function loadFixture(page: Page, variant: LayoutVariant): Promise<void> {
  const [fixture, styles] = await Promise.all([readFile(fixturePath, "utf8"), readFile(stylesPath, "utf8")]);
  await page.setViewportSize({ width: variant.viewportWidth, height: 700 });
  await page.setContent(fixture);
  await page.addStyleTag({ content: styles });
  await page.evaluate(({ compactClass, direction, fontSize, surfaceWidth, zoom }) => {
    document.documentElement.dir = direction;
    document.documentElement.style.fontSize = `${fontSize}px`;
    document.body.style.zoom = String(zoom);
    const surface = document.querySelector<HTMLElement>("#fixture");
    if (!surface) throw new Error("Missing row-geometry fixture surface.");
    surface.style.width = `${surfaceWidth}px`;
    if (compactClass) surface.classList.add(compactClass);
  }, variant);
}

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

function intersects(first: Box, second: Box, tolerance = 0.75): boolean {
  return first.x + first.width > second.x + tolerance
    && second.x + second.width > first.x + tolerance
    && first.y + first.height > second.y + tolerance
    && second.y + second.height > first.y + tolerance;
}

async function visibleUnion(locator: Locator): Promise<Box | null> {
  const boxes = (await Promise.all((await locator.all()).map((item) => item.boundingBox()))).filter((box): box is Box => box !== null && box.width > 0 && box.height > 0);
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

for (const variant of variants) {
  test(`${variant.name}: metadata, status badges, title, and actions never collide`, async ({ page }) => {
    await loadFixture(page, variant);

    for (const row of await page.locator("[data-row]").all()) {
      const rowName = await row.getAttribute("data-row") ?? "unknown row";
      const rowBox = await row.boundingBox();
      const titleBox = await row.locator(".ent-cc-subject-title").boundingBox();
      const metadataBox = await row.locator(".ent-cc-subject-id").boundingBox();
      const badgesBox = await visibleUnion(row.locator(".ent-cc-row-badges > *"));
      const moreBox = await row.locator(".ent-cc-row-more").boundingBox();
      expect(rowBox, `${rowName} should render`).not.toBeNull();
      expect(titleBox, `${rowName} title should render`).not.toBeNull();
      expect(badgesBox, `${rowName} should keep at least one visible status`).not.toBeNull();
      expect(moreBox, `${rowName} action should render`).not.toBeNull();
      if (!rowBox || !titleBox || !badgesBox || !moreBox) continue;

      for (const [name, box] of [["title", titleBox], ["badges", badgesBox], ["action", moreBox]] as const) {
        expect(box.x, `${rowName} ${name} starts inside its row`).toBeGreaterThanOrEqual(rowBox.x - 0.75);
        expect(box.x + box.width, `${rowName} ${name} ends inside its row`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.75);
      }
      expect(intersects(titleBox, badgesBox), `${rowName} title must not collide with badges`).toBe(false);
      expect(intersects(badgesBox, moreBox), `${rowName} badges must not collide with the action`).toBe(false);
      expect(intersects(titleBox, moreBox), `${rowName} title must not collide with the action`).toBe(false);

      if (variant.compactGeometry) {
        expect(metadataBox, `${rowName} verbose metadata is hidden in compact geometry`).toBeNull();
        expect(moreBox.width, `${rowName} compact action target width`).toBeGreaterThanOrEqual(43.5);
        expect(moreBox.height, `${rowName} compact action target height`).toBeGreaterThanOrEqual(43.5);
      } else {
        expect(metadataBox, `${rowName} metadata should render on wide panes`).not.toBeNull();
        if (metadataBox) {
          expect(intersects(metadataBox, badgesBox), `${rowName} metadata must not collide with its badges`).toBe(false);
          expect(intersects(titleBox, metadataBox), `${rowName} title must not collide with metadata`).toBe(false);
        }
      }

      const overflow = await row.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(overflow.scrollWidth, `${rowName} should not create horizontal row overflow`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
}
