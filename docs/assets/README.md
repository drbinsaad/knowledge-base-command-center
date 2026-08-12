# Documentation asset provenance

These assets have different evidentiary roles. Captions and reuse must preserve that distinction.

| File | Type and provenance | What it can show | What it must not imply |
| --- | --- | --- | --- |
| <code>hero.png</code> | AI-generated abstract concept artwork, 2172 × 724 pixels. It was created with OpenAI image generation on 2026-08-10 from a project-authored, text-free knowledge-card prompt and no reference image. It is not a screenshot of Obsidian or Knowledge Base Command Center. | The general idea of interconnected, organized knowledge cards. | Actual product layout, a shipped feature, real user data, or usability evidence. |
| <code>workspace-desktop.png</code> | Real, sanitized desktop capture of the current version-0.10.0 interface, cropped to the plugin workspace, 1320 × 650 pixels. | The optional ENT preset's Medications Library, tab navigation, grouped placeholder records, search field, and desktop density. | A Generic-profile default, resolved medication notes, clinical approval, or comprehensive desktop testing. |
| <code>search-mobile.png</code> | Real, sanitized iPhone portrait capture of the current version-0.10.0 interface, 1206 × 2622 pixels. | One portrait search state with the software keyboard visible, a live result count, compact rows, No note badges, and row action menus. | A completed physical-iPhone release checklist or verification of landscape, broad-query paging, destructive fresh-device recovery, the full touch import/export matrix, every Dynamic Type setting, or Android behavior. |

The two screenshots contain no visible patient identifiers, private note bodies, credentials, local filesystem paths, or recovery data. Clinical terms visible in the captures are interface records, not patient information or medical advice.

These documentation assets are distributed with the repository under the
[MIT License](../../LICENSE). Obsidian names, interface elements, and trademarks
visible in real product captures remain the property of their respective
owners; this project is not endorsed by Obsidian.

## Required captions

When reused in project documentation:

- describe <code>hero.png</code> as abstract AI-generated artwork;
- describe both screenshots as real, sanitized version-0.10.0 captures;
- identify the desktop image as the optional ENT preset rather than a Generic default;
- link mobile claims to [the 0.10.0 iPhone evidence note](../release-evidence/0.10.0-iphone.md); and
- never convert the existence of a screenshot into a checklist pass or broader test claim.

## Suggested alt text

- <code>hero.png</code>: “Abstract illustration of interconnected knowledge cards.”
- <code>workspace-desktop.png</code>: “Knowledge Base Command Center desktop view showing the Medications Library.”
- <code>search-mobile.png</code>: “Knowledge Base Command Center search results above the iPhone keyboard.”

Do not replace the screenshots with generated mockups while continuing to label them as real captures.

---

# Capture guide for the project page

The project [README](../../README.md) reserves a screenshot gallery that is currently **commented out**, so the page renders cleanly while the images do not exist yet. This section is the shot list: capture these eight images, drop them in this folder under the exact filenames below, then uncomment the matching lines in the README.

Every one of these requires the plugin running inside Obsidian. They cannot be generated, mocked up, or produced by any tool in this repository. If a shot cannot be captured, leave its README line commented out rather than substituting an approximation.

## Shot list

| # | Filename | Surface | Recommended viewport | Must be visible |
| --- | --- | --- | --- | --- |
| a | `command-center-desktop.png` | The main Command Center view | Desktop, plugin leaf at least 1280 px wide (well above the 1050 px compact threshold) so the two-column layout is used | A populated Knowledge Index with real grouped records — not an empty state; the knowledge-base switcher in the header; the tab row (Index, Inbox, Collections, a smart queue, at least one Library); the search field; the Add / Arrange / overflow actions; the record inspector open in the right column on a selected record |
| b | `collections-nested.png` | The Collections tab | Desktop, ≥ 1100 px wide leaf | The Collections tab active; one heading containing a subheading containing a further subheading — three visible levels — each with its indentation and at least one record; expanded, not collapsed. Optionally include a fourth level to show depth, but three is the minimum the caption claims |
| c | `libraries.png` | An active Library tab | Desktop, ≥ 1100 px wide leaf | A custom (not ENT-protected) Library with its icon in the tab row; at least two headings with placed records; the Unplaced section if the Library has one; the Library's own Add action |
| d | `quick-entry.png` | The Quick entry hub | Desktop, default modal width | The hub modal open over the workspace; the active knowledge-base name; the full list of hub choices (switch base, create subject/heading/subheading/note, add current, add existing, the two Quick append entries) |
| e | `manage-index.png` | Index Manager | Desktop, ≥ 1100 px wide | The Index Manager modal with its tab row (Indexed, Available, Hidden, Groups, Diagnostics); the **Indexed** tab selected with a non-empty membership list and its search field |
| f | `sync-recovery.png` | Sync & recovery center | Desktop, default modal width | The center open with populated local facts: active base and profile, semantic revision and shortened head, last successful save, last external reload, conflict-rescue count, recovery age, protection status. Confirm before publishing that no full path, export filename, or full fingerprint is rendered |
| g | `mobile-iphone.png` | Compact layout on iPhone | iPhone portrait, native resolution (a real device — the compact route keys off actual leaf width) | The compact single-column record list with 44-point row targets; the header with the base switcher and search; a row's **…** action menu open, or the focused record-detail route with its **Back to main page** control |
| h | `create-note.png` | The Create note form | Desktop, default modal width | The title field filled; the resolved destination folder; the starting-content choice (Empty / Copy a template) with **Copy a template** selected and a template chosen; the live destination path preview showing the exact file that would be created |

## Before you capture

1. **Use a demonstration knowledge base**, not a personal one. Every visible title, folder, and path ends up in a public repository.
2. **Use the Generic profile** unless the caption explicitly says otherwise. `workspace-desktop.png` above is an ENT-preset capture and is captioned as such; new gallery shots should show what a new user actually sees.
3. **Check the whole frame for private data** — note titles, folder names, vault name in the window title, other plugins' panes, the file explorer, OS notifications, and account names.
4. **Match the current release.** Capture on the build being documented and record which version it was, so the provenance table below stays truthful.
5. **Use a neutral theme** — default light or default dark, consistently across the set. Mixing themes across a gallery looks like a bug.
6. **Prefer PNG.** Keep each file under roughly 400 KB where possible; crop to the plugin surface rather than the whole desktop.

## How to add a screenshot

1. Capture the shot and crop it to the surface named in the table.
2. Save it into this folder (`docs/assets/`) under the **exact filename** from the shot list. The README's commented markup already points at these paths.
3. Open the root [`README.md`](../../README.md), find the *Screenshots* section, and uncomment the matching `<img>` line by removing the `<!--` and `-->` around it.
4. Delete that row from the "not captured yet" table in the README, so the page never lists a shot that is already visible.
5. Add a row to the provenance table at the top of this file recording the file, its true nature (real capture), the version captured, its pixel dimensions, and what it must not be taken to prove.
6. Confirm the README renders with no broken images before committing.

The order matters: an `<img>` tag pointing at a file that does not exist renders as a broken image on GitHub, which is worse than no image at all. Never uncomment a line before its PNG is in place.

## What these screenshots may not be used to claim

A screenshot shows that a surface rendered once, on one device, in one state. It is not test evidence. In particular, `mobile-iphone.png` does not establish that the physical-iPhone release checklist passed — that claim requires the [manual iPhone release checklist](../manual-iphone-release-checklist.md) and a recorded evidence note, not an image.
