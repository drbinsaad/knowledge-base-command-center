# Changelog

## 0.8.1

### Added

- Added independent portable-export and import choices for Procedures, Medications, and Syndromes. Each selected library transfers only path-free names, group labels, record kinds, and stable identities; no Markdown paths, note bodies, doses, or attachments are included.
- Added automatic Procedures, Medications, and Syndromes tabs in generic destination bases whenever those portable libraries are present. Missing notes remain actionable placeholders that can create or link a local note without changing the destination preset.

### Fixed

- Kept a created or linked generic library note bound to its imported procedure, medication, or syndrome identity after cache rebuild, reload, restart, and Sync instead of reverting to a false placeholder or disappearing.
- Kept library-only groups out of the topic index and made Replace operate only on the selected portable catalogs, preserving unrelated local topic and library identities.
- Added portable-package format version 2 with explicit catalog provenance. Older plugin builds reject the new format safely; the current importer still reads version 1 and treats its non-topic records as dependencies rather than complete catalogs.
- Prevented collection- or study-only imports from replacing unrelated local libraries, made selected empty catalogs replaceable, and isolated conflicting group renames from unselected catalogs.
- Preserved the imported group and library role when a generic placeholder is linked to a local Markdown note, including after registry synchronization and re-export.
- Kept iPhone search results visible above the software keyboard by switching focused mobile search to compact chrome, resetting retained result scroll positions, and exposing a live result count plus a 44-point clear control.

## 0.8.0

### Added

- Added multiple independent knowledge bases inside one plugin installation. ENT, research, another specialty, and other subjects can each keep separate index scope, labels, headings, memberships, collections, templates, study state, snapshots, and Undo history while referencing the same vault notes safely.
- Added a header switcher, searchable settings control, management screen, and commands to create, switch, rename, duplicate, archive, and restore knowledge bases. The active base is shared by every open Command Center view.
- Added base-local subject display labels and index-heading aliases. Renaming in the index never renames a Markdown file, heading, or frontmatter title.
- Added restorable removal of individual subjects or complete non-empty index headings in both generic and protected ENT presets. Removal changes only active-base membership and visual organization; Markdown notes and other bases remain untouched.
- Added permanent deletion for archived knowledge bases with exact-name confirmation, a recovery-export recommendation, and an archived-only API. It removes plugin organization only, never Markdown notes, and frees one of the 50 base slots.

### Changed

- Wrapped existing v1–v10 plugin data into a single-base v11 store on first load, preserving the previous organization exactly. Archived bases remain recoverable and at least one available base is always retained.
- Made file and folder rename reconciliation update every active and archived base, while direct saves remain bound to their call-time base and synchronized base/reload operations cannot cross-contaminate sibling bases.
- Coalesced external `data.json` reloads from Obsidian Sync or other programs with queued local writes. An overlapping local action is rejected with a retry message instead of replaying an opaque stale base over newly synced collections or settings.
- Reworked mobile index-heading controls into one labelled 44-point Actions menu and made base-management actions, validation, long names, safe-area layout, and reversible archive messaging touch-friendly.
- Standardized visible counts as index entries and clarified that plugin knowledge bases are independent index profiles, not Obsidian `.base` files or saved Workspace layouts.
- Kept portable export/import scoped to the active base. Switch bases to export each one separately; Markdown note bodies and attachments remain excluded.
- Kept each base's preset immutable after creation, protected the ENT canonical index scope, and made new generic bases suggest a distinct folder with an explicit overlap warning.
- Hard-locked newly generated v7 exact-path recovery files to the vault, knowledge-base ID/name, and Generic/ENT preset that created them. Same-preset cross-base recovery requires a distinct source/destination override plus the destructive confirmation; cross-preset recovery is always rejected. Version 1–6 files remain base/preset-unverified, and identity-less v1–v5 files also undergo the conservative at-least-half unique-path preflight. The path-free Index blueprint remains the supported cross-vault or cross-preset transfer.
- Replaced deterministic legacy-migration vault IDs with random persisted provisional IDs. Obsidian Sync can converge only pristine single-base copies that carry the same legacy fingerprint, including a late third device or an interim deterministic-ID copy; any real edit closes that exception. Recovery exported before first-upgrade identity convergence must be exported again after Sync settles.
- Invalidated open export/import dialogs when the active base data is reloaded by Sync, preventing a reviewed package from being applied to a newer same-base state.
- Kept permanent deletion durable across Obsidian Sync with bounded, validated base-ID tombstones. Deleted IDs are never reused or silently evicted, stale devices cannot resurrect deleted bases, and a merge that would leave no available base is rejected without discarding local data.
- Updated installation guidance now that Knowledge Base Command Center is available directly from the Obsidian Community Plugins directory; BRAT remains supported for beta and release testing.

## 0.7.12

### Added

- Added one **Export / import center** for component-aware transfers. Users can select workspace settings, an index blueprint, collections, study state, saved views, same-vault recovery, or a preset; Collections and Study state automatically include their portable subject catalog.
- Added a path-free portable index blueprint with stable subject identities, titles, groups, nested hierarchy, record kinds, and visual order. Portable collections, pins, and the Next list reference those identities instead of exposing source Markdown paths.
- Added unresolved **No note** placeholders when an imported subject has no local Markdown file. Generic workspaces can create an empty note, create from a local template, link an existing note, or keep the placeholder while retaining its imported placement. The clinical preset offers a safety-gated unverified proposal instead of direct topic creation and visibly routes the result to the Inbox.
- Added conflict-aware **Change linked note** and **Unlink note** controls to row menus and the mobile inspector. Already-bound notes remain selectable, but merging two portable identities requires confirmation; unlinking restores the placeholder without changing either Markdown note.
- Added per-import section selection, a summary of the selected data, and explicit **Merge with this vault** or **Replace selected sections** behavior. Both modes change plugin-owned organization only and never delete, move, overwrite, or rewrite Markdown notes.
- Added iPhone and iPad portable-package export to `Knowledge Base Command Center Exports/` plus in-vault JSON import; desktop keeps download and file-picker behavior. All imports enforce the 10 MB limit, bounded list/reference counts, and validation of supported versions, hierarchy integrity, identifiers, folders, and template availability.

### Changed

- Kept older workspace JSON and organization backups importable through the new center, and advanced plugin data to schema version 10 for stable portable identities and local note bindings.
- Distinguished the default cross-vault **Portable set** from **Everything**, which also includes same-vault recovery. The interface and documentation now warn that recovery JSON contains exact vault-relative note paths, require a separate export confirmation, and display the selected import filename or vault path during review.
- Made recovery an explicit, confirmed, standalone restore; portable sections remain selected by default while recovery starts off. Undo now covers portable bindings and named snapshots when those components change.
- Kept the index blueprint path-free by omitting generic user-configurable ID-property values while retaining only valid, canonical-format ENT curriculum IDs from the fixed clinical mapping. Workspace paths and literal saved-query text remain separately selectable and disclosed.
- Reworked registry synchronization and import matching to stay linear on large indexes, preserve unselected local references, reject ambiguous matches, and require confirmation before portable identities are merged.
- Kept note bodies and attachments out of every export option. A missing, restricted, or out-of-folder destination template now falls back to Empty note without changing any Markdown file.
- Enforced the same 10 MB ceiling on export and import and validate the exact serialized package before saving it, so the plugin never hands out an export its own importer rejects.

## 0.7.11

### Fixed

- Kept selected mobile index subjects in a single compact 48-point row instead of allowing curriculum icons, status badges, and the actions menu to auto-place into a tall multi-row card.

## 0.7.10

### Fixed

- Replaced the ambiguous mobile × control with a labelled 44-point **Back to main page** button, giving the focused record view an obvious and accessible return path to the command center.

## 0.7.9

### Improved

- Replaced the inline phone inspector with a focused record-detail view, so selecting a note no longer leaves its identity and primary actions below the command-center header.
- Kept the selected note title and a 44-point Close control visible while the details scroll independently, with enough safe-area clearance for Obsidian's floating mobile navigation.
- Preserved the index scroll position and restored focus to the selected row after Close or Escape; Tab and Shift+Tab remain contained in the mobile detail view.
- Kept the existing desktop split view unchanged.

## 0.7.8

### Improved

- Reworked the iPhone Create note sheet so its form scrolls independently and the primary action remains above the software keyboard.
- Hid the inactive template section for empty notes, removed the redundant mobile Cancel button, and added accessible control labels plus Return-to-create behavior for the title field.

## 0.7.7

### Fixed

- Replaced the two overlapping iPhone notifications after workspace or organization export with one concise confirmation that keeps the Index Manager controls visible.

## 0.7.6

### Improved

- Kept Add, Manage, Arrange, and the overflow menu visible together on narrow iPhone screens; Undo and Redo remain available in the overflow menu.
- Made the main and Index Manager tab bars touch-scrollable, keyboard-described, and automatically reveal the active tab.
- Replaced the generic empty-index dead end with a direct path to available existing notes, including the available count and an explicit no-file-movement guarantee.
- Compressed idle bulk controls in the Index Manager, placed mobile workspace import and export side by side, and preserved enough list height for useful results.
- Prevented Index Manager tabs from being flex-compressed out of view and accounted for iOS dynamic viewport and bottom navigation space.
- Added a mobile layout regression check covering primary actions, actionable empty states, tab overflow, viewport sizing, and compact bulk controls.

## 0.7.5

### Fixed

- Made bulk “add matching records” actions use the search text currently visible in the input, including during the 120 ms render debounce.
- Re-measured and re-bounded snapshots after file or folder renames mutate stored paths, preventing stale cached sizes from letting organization history exceed its data budget.
- Preserved existing canonical filenames when a placement edit changes only non-path metadata, so newer filename-sanitization rules cannot silently rename a legacy note.
- Disclosed hierarchy depth limiting in both the curriculum view and Index Manager diagnostics without modifying note metadata, and kept this informational condition out of safe-repair actions.
- Awaited pending and in-flight selection persistence when the view closes, cleared detached Index Manager controls, refreshed backlink-dependent UI after any Markdown link change, and surfaced remaining user-action failures as Obsidian notices.
- Stopped `buildCurriculumTree` from exhausting the call stack on a long parent chain. Nesting deeper than `MAX_CURRICULUM_DEPTH` is now re-rooted the same way cycles are broken, and sibling sorting is iterative, so an accidental chain degrades the layout instead of leaving the view blank.
- Indexed configured-parent resolution by group, title, basename, and alias. Building the tree for 10,000 notes that all use the parent property went from about 54.6 s to about 0.12 s.
- Kept every record visible in the Procedures, Medications, and Syndromes sections. Grouping read one map key and wrote another, so all but the last record without a group value were dropped from the list while the count still reported them.
- Treated note titles as literal text when rewriting a promoted or re-placed note's top-level heading. A title containing `$&`, `` $` `` or `$'` previously corrupted the heading.
- Kept the plugin loadable when `data.json` cannot be parsed. It now opens in read-only compatibility mode and never overwrites the damaged file, instead of failing during `onload`.
- Surfaced failures from pin, next-list, undo, redo, drag-and-drop, reorder, and visual-move actions instead of discarding them. In read-only mode these previously did nothing with no explanation.
- Replaced characters that are filesystem-legal but break Obsidian wikilinks (`#`, `^`, `[`, `]`) in generated filenames, and suffixed reserved Windows device names such as `CON`.
- Reported collection counts that match the rows actually rendered, with a separate indicator for references whose notes no longer exist.
- Kept safety-critical, AI-lock, and pin indicators visible on narrow phone screens.

### Performance

- Replaced linear membership scans inside the vault enumeration loop with set lookups. Building records for 10,000 files with 5,000 manual members went from about 1.0 s to about 0.15 s.
- Parsed the search query once per render and memoized each record's normalized search text. Three match passes over 10,000 records went from about 467 ms to about 9 ms, and keystrokes are debounced.
- Replaced copy-on-append accumulation in the backlink index, descendant walk, library grouping, and Bases view; a 10,000-entry group went from about 69 ms to under 1 ms.
- Cached child order on the curriculum tree so drags and menu moves no longer rebuild it, and cached snapshot sizes so bounded history stops re-serializing the whole stack.
- Stopped rewriting the whole plugin data file on every row selection; selection is now debounced and flushed when the view closes.

### Changed

- Removed personal and vault-specific references from shipped code: generated note bodies no longer name an individual reviewer, the default selection no longer targets a specific curriculum ID, and the clinical Base shortcuts appear only when those files exist in the vault.
- Announced expanded and collapsed state on every disclosure control, and let the browser resolve text direction for note titles, identifiers, and paths so right-to-left titles render correctly.
- Kept focus on the checkbox when selecting notes in the Index Manager instead of rebuilding the dialog.
- Warned when the plugin data budget, rather than the count limit, shortened saved snapshot history.
- `npm run lint` now fails on warnings as well as errors.

## 0.7.4

- Prevented versionless modern plugin data from being misclassified as legacy ENT data; recognizable generic settings, collections, pins, and hierarchy now migrate safely, while unrecognized data opens read-only and is never overwritten.
- Preserved every plugin-owned descendant reference across file and folder renames, including memberships, visual parents and order, pins, hidden/manual index entries, snapshots, undo/redo history, selection, and collapsed nodes.
- Replaced quadratic index diagnostics, visual-placement checks, related-note resolution, and backlink scans with cached maps and sets; added 10,000-note performance regressions and deferred diagnostics until its tab is opened.
- Bounded undo and snapshot history by serialized size as well as count, reduced unnecessary record rescans, and restricted metadata-property suggestions to a capped indexed-note sample.
- Added iPhone/iPad-native workspace and organization JSON export/import through the vault, persistent collapse state, 44-point touch controls, safe-area spacing, and menu-based visual hierarchy movement without relying on drag-and-drop.
- Fixed template replacement strings containing `$`, Unicode/diacritic search, control and bidirectional filename characters, case-insensitive protected-folder validation, prototype-key imports, non-Markdown current-file handling, drag cleanup, duplicate DOM IDs, filter-chip focus loss, and generic-profile source-folder assumptions.
- Added an in-memory Obsidian runtime test boundary, destructive-migration regressions, full-repository lint/JSON validation, Community-policy verification, exact Obsidian dependency pinning, and reproducible release-note extraction.
- Pinned every GitHub Action to a full commit SHA, separated read-only build permissions from release permissions, and retained signed build-provenance attestations.
- Documented BRAT installation and updates, mobile portability, manual updates, uninstall data behavior, troubleshooting, exact commands and filters, and the stable legacy plugin ID retained for upgrade continuity.

## 0.7.3

- Adopted Obsidian 1.13's declarative settings API so every setting is available to Settings search on desktop and mobile.
- Added explicit type boundaries for Obsidian metadata and removed deprecated or scanner-unsafe source patterns.
- Normalized the two legacy command identifiers and labels flagged by the Community Plugins review.
- Clarified that whole-vault Markdown enumeration powers the index and that user-triggered copy actions only write plugin-generated text to the clipboard.

## 0.7.2

- Preserved user-arranged workspace leaves when the plugin unloads.
- Removed the redundant plugin-name heading from settings.
- Adopted Obsidian element helpers, explicit configuration-directory validation, and review-compatible asynchronous event handling.
- Added a tag-driven release workflow that publishes only supported assets with GitHub build-provenance attestations.

## 0.7.1

- Added reproducible three-file release packaging with version, mobile-compatibility, privacy, archive-content, and checksum validation.
- Documented the safe standalone-repository boundary so the private ENT vault and copyrighted source history are never published with the plugin.
- Added MIT licensing, public contribution and security guidance, and continuous integration for the standalone repository.
- Hardened moved-file validation and rollback writes to use Obsidian's recommended vault APIs.
- Removed runtime inline styling from curriculum indentation for Community Plugins review compatibility.

## 0.7.0

- Added a dedicated Index Manager for searching, selecting, and bulk-organizing indexed notes.
- Added generic-profile bulk controls for adding existing notes, removing memberships, restoring hidden notes, and assigning visual groups.
- Added visual group creation, renaming, merging, deletion, and ordering without moving Markdown files or rewriting frontmatter.
- Added organization diagnostics for missing note references, duplicate memberships, broken visual parents, orphaned group overrides, and invalid visual parent relationships, plus a safe plugin-state repair action.
- Added portable workspace configuration export/import for labels, folders, metadata mappings, behavior settings, and group order without exporting note contents or note-specific personal organization.
- Added an opt-in ENT setting for visual cross-domain movement while retaining protected canonical clinical metadata and paths; it remains off by default.
- Extended snapshots, organization backups, rename handling, migrations, and automated tests for index group order; plugin data schema is now version 8.

## 0.6.0

- Added manual membership so an existing Markdown note anywhere in the eligible vault can join the generic index without moving files.
- Added safe hide, remove, and restore controls for index membership.
- Added visual movement across groups, including new group creation, desktop drag-and-drop, and touch-friendly menu controls.
- Made notes created through the primary generic Create action join the index even when saved outside the indexed folder.
- Added searchable folder, frontmatter-property, and default-template pickers in Obsidian settings.
- Extended undo/redo, snapshots, JSON backups, rename handling, and migration coverage to the new organization state; plugin data schema is now version 7.

## 0.5.0

- Rebranded the visible plugin as Knowledge Base Command Center while retaining the legacy plugin ID for safe upgrades.
- Added a generic profile for any folder-based knowledge base.
- Added a complete first-run setup wizard and configurable workspace terminology, folders, and metadata properties.
- Added empty or template-based note creation with per-note template and destination choices.
- Added generic index scanning, Inbox handling, queues, inspector actions, and interface labels.
- Preserved the original ENT clinical workflow as an optional preset and automatic migration target for existing users.
- Added migration and generic helper coverage; plugin data schema is now version 6.
