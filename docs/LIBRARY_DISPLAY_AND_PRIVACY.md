# Library display and privacy

Version **0.23.1 supports local-vault covers only**, retaining the boundary introduced in 0.23.0. Online cover loading and its opt-in controls are not included. The earlier network-capable proposal remains deferred and unapproved; removing it from this release is not a completed privacy review.

## Library settings

Open **Library settings…** from a Library toolbar or **Manage libraries → Settings…**. General contains Rename, singular label, icon, Archive, Restore, and permanent deletion for archived custom Libraries with guarded record reassignment. Built-in Libraries preserve their source classification and cannot be permanently deleted. A knowledge-base name such as ENT is managed separately through **Manage knowledge bases… → Rename**; renaming does not change its fixed Generic or ENT preset.

Display configures each Library independently:

| Choice | Options / default |
| --- | --- |
| Layout | List (default), Cards |
| Image property | Plain frontmatter property name; default <code>cover</code> |
| Card size | Small, Medium (default), Large |
| Image proportions | Portrait (default), Square, Landscape |
| Image fit | Show whole image (default), Crop to fill |
| Visible properties | Up to six property names; default <code>author, reading_status</code>; empty means titles only |

Property names are limited to 128 characters and exclude unsafe prototype keys and control characters. Values render as bounded plain text. Settings follow the stable Library ID, so renaming and archiving retain them; permanent deletion removes its display profile. Save and reset use guarded transactions and Undo. Reset display restores these defaults.

Version 0.23.1 pins the explicit Save display action outside the scrolling form and labels unsaved, saving, and saved states. Changes do not autosave or alter note properties. Failed saves retain the draft; closing without saving discards it.

Cards preserve headings, nested subheadings, ordering, Unplaced records, and note actions. Arrange uses the list presentation. This is a KBCC Library display, not an Obsidian <code>.base</code> query or a change to note storage.

## Local book covers

Place an image you own or may use in the vault, then set a property on its Markdown note:

~~~yaml
cover: "[[Covers/My book.jpg]]"
author: "Example Author"
reading_status: "Reading"
~~~

Choose Cards and image property <code>cover</code>. Existing vault paths, wikilinks, and embedded wikilinks resolve relative to the note through Obsidian. Supported local extensions are AVIF, BMP, GIF, JPEG/JPG, PNG, and WebP. The target must resolve to a current vault file; the browser receives an Obsidian-generated resource URL. Cover references are limited to 2,048 characters.

In 0.23.1, the exact property name takes priority. Only if it is absent may a unique case-insensitive name match; multiple matches require an exact selection. Only cover lookup gets this fallback—other visible metadata fields keep exact matching. One-item text lists and simple local Markdown image/link wrappers are accepted. Markdown destinations are decoded before the local-only checks; URL schemes, absolute paths, unsafe markup, and unsupported file types remain blocked.

HTTP/HTTPS URLs, protocol-relative URLs, local SVG, arbitrary HTML, operating-system absolute paths, and supplied <code>file:</code>, <code>data:</code>, <code>javascript:</code>, or app resource URLs are rejected. An existing online URL can remain in the note property, but KBCC will not load it. Save an image into the vault yourself and change the property to its vault link if you want a cover.

There is no cover discovery service, remote search, automatic download, or note-body scan. KBCC reads the configured properties from cached frontmatter and displays the selected existing image. Missing, invalid, blocked, or failed covers show compact placeholders; a **No note** subject has no note properties to read. Local covers work offline. Changing display preferences does not write note properties, move files, or create image files.

Cover diagnostics explain missing/empty or ambiguous properties, wrong value types, unavailable notes/metadata/images, unsupported files, remote links, and load failures. The messages and accessibility descriptions do not include the property value, image URL, private path, or a caught error message.

Card dimensions, lazy loading, and image fitting do not cap decoded-image memory. Large or animated local images can still affect performance; use reasonably sized cover files and verify on your devices.

## Legacy private-test state

A private pre-release build offered external images and could leave <code>ent-vault-command-center.library-images.v1</code> in vault-specific App-local storage. Like 0.23.0, version 0.23.1 does not use that value to authorize image loads, does not offer an enable action, and does not copy it into plugin data, Sync state, exports, recovery or Undo. A previously allowed value cannot enable remote covers.

**Clear device-local data** includes cleanup of this inert legacy key along with the other plugin-owned App-local values. Removing it does not clear browser cookies/cache or undo requests previously sent by a private test build. See [Local data](LOCAL_DATA.md).

## Compatibility and sharing

| Artifact | Version | Display behavior |
| --- | --- | --- |
| Plugin store / base data | 16 / 16 | Profiles live in base settings and participate in semantic Sync; older builds protect newer data read-only |
| Workspace configuration | 3 | Library display profiles and required stable Library descriptors in a portable package |
| Portable package | 6 | Carries Workspace 3; versions 1–6 remain readable |
| Same-vault recovery | 12 | Restores display profiles, including archived Libraries and retained settings snapshots |
| Device history | 4 | Existing bounded Undo journal; the obsolete external-image key is separate and inert |

Workspace profiles contain property names and display choices, not cover URLs, image bytes or property values. Workspace export omits archived/missing Library profiles. A Library-only import leaves destination display preferences unchanged. Older Workspace versions 1–2 and recovery versions 1–11 preserve destination display preferences for surviving Library IDs. Current recovery restores its own profile map. No format grants online-image permission.

Other export privacy boundaries still apply: Workspace can contain configured vault-relative folders, literal saved queries can be sensitive, and private recovery contains exact note bindings. Update every importing or syncing device before using new formats. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md).

## Deferred online-cover proposal

The earlier proposal allowed browser-loaded HTTPS covers after a separate opt-in scoped to one vault on one device. It described request IP/URL exposure, cookies/cache/redirects, referrer suppression without anonymity, persistence failures and revocation limits. It was explored in a private build and draft review, but **independent public privacy review was not completed**. That feature is excluded from both 0.23.0 and 0.23.1.

Any future proposal must obtain independent review of the final image-loading implementation and publish the review before release, as required by [Contributing](../CONTRIBUTING.md#non-negotiable-boundaries). Default-denial tests or acceptance of unverified physical-device scope cannot waive that requirement.

## Device evidence

Physical iPhone/iPad keyboard, safe-area, image-loading, VoiceOver, image-memory and controlled two-device Sync/import checks remain separately recorded in the [0.23.1 evidence record](release-evidence/0.23.1-iphone.md). After the remaining gap was disclosed, the maintainer explicitly approved publication of this tested update with that physical scope unverified. This is fresh authorization for 0.23.1, not a device Pass or reuse of the historical [0.23.0 record](release-evidence/0.23.0-iphone.md). Use synthetic notes and owned images for future checks, and never publish private vault content or recovery files.
