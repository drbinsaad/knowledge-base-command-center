import { TFile, type App } from "obsidian";
import { renderLibraryCover, resolveLibraryCover } from "../../src/library-cover";
import { normalizeLibraryDisplayProfile } from "../../src/library-display-profile";

// Production resolution/rendering with an isolated vault adapter. The data URI is
// a synthetic stand-in for Obsidian's trusted getResourcePath result; arbitrary
// blob/data URLs supplied as note properties must still be rejected.
const localFile = new TFile("Covers/Example.png");
const unsafeLocalFile = new TFile("Covers/Unsafe.svg");
const localResource = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
const legacyKey = "ent-vault-command-center.library-images.v1";
const appLocalFixture = new Map<string, unknown>();
const stats = { localLookups: [] as Array<{ path: string; sourcePath: string }>, resourceLookups: [] as string[], legacyReads: 0 };
const app = {
  metadataCache: {
    getFirstLinkpathDest(path: string, sourcePath: string): TFile | null {
      stats.localLookups.push({ path, sourcePath });
      if (path === localFile.path || path === "../Covers/Example.png") return localFile;
      return path === unsafeLocalFile.path ? unsafeLocalFile : null;
    },
  },
  vault: {
    getResourcePath(file: TFile): string {
      stats.resourceLookups.push(file.path);
      if (file !== localFile) throw new Error("Unexpected vault resource lookup");
      return localResource;
    },
  },
  // Inert legacy storage only. No permission switch or enabling behavior exists.
  loadLocalStorage(key: string): unknown { stats.legacyReads += 1; return appLocalFixture.get(key) ?? null; },
} as unknown as Pick<App, "metadataCache" | "vault">;

export interface LibraryCoverPrivacyHarness {
  render(value: string): string;
  seedLegacyPermission(): void;
  legacyStorageValue(): unknown;
  snapshot(): typeof stats;
  dispose(): void;
}

const harness: LibraryCoverPrivacyHarness = {
  render(value) {
    const parent = document.querySelector<HTMLElement>("main")!;
    parent.replaceChildren();
    const cover = resolveLibraryCover(app, value, "Books/Synthetic private note.md");
    renderLibraryCover(parent, cover, normalizeLibraryDisplayProfile({ layout: "cards" }));
    return cover.state;
  },
  seedLegacyPermission() {
    appLocalFixture.set(legacyKey, { version: 1, externalImagesAllowed: true });
  },
  legacyStorageValue() { return structuredClone(appLocalFixture.get(legacyKey) ?? null); },
  snapshot() { return structuredClone(stats); },
  dispose() { document.querySelector("main")?.replaceChildren(); appLocalFixture.clear(); },
};
(window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy = harness;
