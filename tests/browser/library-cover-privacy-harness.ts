import type { App } from "obsidian";
import { clearExternalLibraryCovers, renderLibraryCover, resolveLibraryCover } from "../../src/library-cover";
import { normalizeLibraryDisplayProfile } from "../../src/library-display-profile";

// Only the image request boundary is under test. Allowance is supplied by the
// test, not granted through native Obsidian UI, App-local storage, or Sync.
const app = {
  metadataCache: { getFirstLinkpathDest(): never { throw new Error("Remote cover entered the local resolver"); } },
  vault: { getResourcePath(): never { throw new Error("Unexpected local resource lookup"); } },
} as unknown as Pick<App, "metadataCache" | "vault">;

export interface LibraryCoverPrivacyHarness {
  render(value: string, allowed: boolean): string;
  revoke(): void;
}

const harness: LibraryCoverPrivacyHarness = {
  render(value, allowed) {
    const parent = document.querySelector<HTMLElement>("main")!;
    parent.replaceChildren();
    const cover = resolveLibraryCover(app, value, "Synthetic private note.md", allowed);
    renderLibraryCover(parent, cover, normalizeLibraryDisplayProfile({ layout: "cards" }));
    return cover.state;
  },
  revoke() { clearExternalLibraryCovers(document.querySelector<HTMLElement>("main")!); },
};
(window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy = harness;
