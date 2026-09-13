# Library display and privacy proposal

Status: **proposed, implemented locally, pending independent review and public release review**. This describes the unreleased source changes after 0.22.0. It does not claim that an issue, public privacy review, physical-device pass, or release has already happened. The public-review requirement in [Contributing](../CONTRIBUTING.md#non-negotiable-boundaries) still applies before release.

## User-facing behavior

Open **Library settings…** from a Library toolbar or **Manage libraries → Settings…**. General contains Rename, singular label, icon, Archive, Restore, and permanent deletion for archived custom Libraries. Built-in Libraries preserve their source classification and cannot be permanently deleted. A knowledge-base name such as ENT is managed separately through **Manage knowledge bases… → Rename**; renaming does not change its fixed Generic or ENT preset.

Display configures each Library independently:

| Choice | Options / default |
| --- | --- |
| Layout | List (default), Cards |
| Image property | Plain frontmatter property name; default `cover` |
| Card size | Small, Medium (default), Large |
| Image proportions | Portrait (default), Square, Landscape |
| Image fit | Show whole image (default), Crop to fill |
| Visible properties | Up to six property names; default `author, reading_status`; empty means titles only |

Property names are limited to 128 characters and exclude unsafe prototype keys and control characters. Values are rendered as bounded plain text. Settings follow the stable Library ID, so renaming and archiving retain them. Permanent deletion removes its display profile. Save and reset use the normal guarded transaction and Undo. Reset display restores the table's defaults; it does not change external-image permission.

Cards preserve the Library's existing headings, nested subheadings, ordering, Unplaced section, and note actions. Arrange uses the list presentation. This is a KBCC Library display, not an Obsidian `.base` query or a change to note storage.

## Local book covers

Place the cover in the vault, then set a property on its Markdown note:

~~~yaml
cover: "[[Covers/My book.jpg]]"
author: "Example Author"
reading_status: "Reading"
~~~

Choose Cards and image property `cover`. Existing vault paths, wikilinks, and embedded wikilinks resolve relative to the note through Obsidian. Supported local extensions are AVIF, BMP, GIF, JPEG/JPG, PNG, and WebP. The target must resolve to a current vault file; the browser receives an Obsidian-generated resource URL. Local SVG, arbitrary HTML, operating-system absolute paths, protocol-relative URLs, and supplied `file:`, `data:`, `javascript:`, or app resource URLs are not accepted. Cover references are limited to 2,048 characters.

There is no cover discovery service, remote search, automatic download, or scan of note bodies. KBCC reads the configured property from cached frontmatter. The browser reads the selected existing image to display it. Missing, invalid, blocked, or failed images show a placeholder; an unresolved **No note** subject has no note properties to read.

Local covers work offline and require no permission prompt. Choosing or changing a display profile does not add properties to Markdown, fetch book metadata, move files, or create a cover file.

## External images: explicit device-local permission

No network request is made for covers by default. A remote cover URL remains blocked until the user opens **Display → External images in this vault → Allow external images…** and accepts the separate disclosure. The permission applies to all Libraries in this vault on this device. Other vaults and devices keep their own permission. It is not a per-Library host allowlist.

Only an initial HTTPS URL is accepted. URLs with embedded username/password credentials, `.svg`/`.svgz` paths (including percent-encoded suffixes), or malformed URL-path escapes are rejected. No preflight request verifies the server, image MIME type, or final redirect destination. A remote URL can return unexpected content or redirect; the browser's image, security, and redirect policies control what loads. The plugin does not execute the value as HTML or script.

When allowed, the browser loads the URL as an image. The host can receive the user's IP address, request time, normal browser request metadata, and the full requested path/query. A URL may itself contain an account identifier or tracking token. KBCC does not append note content, note paths, Library names, or vault identifiers to the URL. The image uses `referrerpolicy="no-referrer"`; referrer suppression is not anonymity. Normal browser cookies, cache, redirects, and server tracking may still apply. Images are lazy-loaded, so an allowed request can occur as a card becomes visible, when a view refreshes, or when a changed cover property is rendered.

There are no analytics, telemetry, advertising, accounts, payment flows, or background metadata requests. The absence of `fetch` or another explicit networking API does not prove offline behavior: an image element itself can initiate a request.

## Persistence, import, and revocation

The permission is stored as a small versioned boolean in Obsidian's vault-specific App-local storage. Missing, malformed, or unavailable storage means blocked. Enabling requires a successful permission write before images can load. Permission is never copied into `data.json`, semantic Sync state, Workspace profiles, portable packages, portfolio transfers, recovery exports, or Undo snapshots. Syncing a cover URL or importing a display profile cannot grant permission in a vault on a device that has not opted in.

**Block external images** immediately disables new external loads and removes external `src` values from current KBCC cover elements in this vault on this device before attempting persistence. **Clear device-local data** also revokes permission and removes current external covers in the same scope. Neither action changes another vault's or device's permission. Removing a source can cancel pending image activity, but cannot undo a request already sent, erase the host's logs, clear browser cookies/cache, or guarantee recall of an in-flight browser request.

If saving a block or privacy reset fails, external covers stay blocked for the current session. A previous permission value might still exist on disk: the user must check again after restarting. The UI reports this limit. A successful privacy reset suppresses re-enabling and local tracking until restart. Ordinary display reset, Undo, import, and recovery do not alter image permission.

## Compatibility and sharing

| Artifact | Source-build version | Display behavior |
| --- | --- | --- |
| Plugin store / base data | 16 / 16 | Profiles live in base settings and participate in semantic Sync; older builds protect newer data read-only |
| Workspace configuration | 3 | Active-Library display profiles and required stable Library descriptors in a portable package |
| Portable package | 6 | Carries Workspace 3; versions 1–6 remain readable |
| Same-vault recovery | 12 | Restores display profiles, including archived Libraries and retained settings snapshots |
| Existing device history | 4 | Existing bounded Undo journal; external permission is a separate version-1 App-local value |

Workspace display profiles contain property names and display choices, not cover URLs, image bytes, or property values. Workspace export omits archived/missing Library profiles. A Library-only import leaves destination display preferences unchanged. Older Workspace versions 1–2 and recovery versions 1–11 preserve destination display preferences for Library IDs that remain available. Current recovery restores its own profile map. No format transfers external permission.

Other export privacy boundaries still apply: Workspace can contain configured vault-relative folders; literal saved queries can be sensitive; private recovery contains exact note bindings. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md) and [Local data](LOCAL_DATA.md).

## Review and validation still required

Before release, publish this proposal for review and obtain an independent assessment of the image request path, default blocking, permission isolation, malformed URLs, storage failures, redirects/cookies, and revocation behavior. Reviewers should verify claims against the final implementation, not infer them from this document or a network-API string check.

Use synthetic covers and notes for desktop Chromium/WebKit checks and real Obsidian integration. Physical iPhone/iPad keyboard, safe-area, image-loading, VoiceOver, and permission behavior, plus a controlled two-device Sync/import test, require their own recorded evidence. This proposal does not claim those passes. Keep public fixtures, screenshots, and reviews free of real note titles, cover URLs with credentials or tracking tokens, recovery files, or patient information.
