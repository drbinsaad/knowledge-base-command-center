# Changelog

## Unreleased

### Fixed

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
