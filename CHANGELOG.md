# Changelog

## 0.14.1

### Fixed

- A note created through the new Inbox-default form could disappear from the plugin entirely — present in the vault but shown in no tab and found by no search — whenever it ended up outside the folder configured as the Inbox (for example when that setting names a different folder than expected, is empty, or the destination folder was edited in the form). Inbox membership is derived purely from the note living inside the configured Inbox folder, and a note outside it, outside the indexed folder, and not manually indexed belongs to nothing. The form now refuses to create an Inbox-destination note whose folder is not inside the configured Inbox folder and explains exactly what to change; the form's context line names the real folder; and if drift the form cannot see still lands the file elsewhere (a mid-form synced settings change, or a case-insensitive filesystem merging differently-cased folders), the note is added to the Index with an explanatory notice instead of vanishing.
- If you already created a note that vanished this way, the file is intact in your vault: either move it into the folder your Inbox setting names, or use **Add existing note** to index it.
- A follow-up audit of every create-and-file flow closed the same trap everywhere it existed, not just in the new form. The Inbox tab's own empty-state **Create note** button now opens the guarded form instead of the legacy one that bypassed the folder check. In the clinical profile, the plain **Create note from template or empty note** command previously seeded the ENT default note folder `01 Inbox` — which no clinical view ever shows (the clinical Inbox is a subfolder of it) — so every note created that way was invisible from the start; it now starts in the real clinical Inbox and refuses folders no clinical view would show. If filing fails *after* the file exists — the chosen collection or library vanished through Sync while the form was open, or the knowledge base switched mid-save — the note is registered in the Index (generic profile) or its exact path is named in the message, so a created note can never again silently belong to nothing.
- Adding or moving a note into a collection whose heading was deleted in the meantime no longer reports success while doing nothing — and a move whose target vanished keeps the note where it was instead of removing it from its source. Settings now refuses an empty Inbox folder, which would have made Inbox capture impossible.

## 0.14.0

### Added

- Creating a note now opens one unified form that files into the **Inbox by default** — type a title, press Create, done. A new **Destination** row at the top of the form shows where the note will go, and **Change…** re-targets the same form at the **Index** (choose a visual group), a **Collection** heading or subheading (chosen by full path, with a prompt to create the first heading when none exist), or any **Library** (choosing its heading or subheading first, exactly as before). Switching the destination re-seeds the folder, content mode, and template with that destination's own defaults, and every field stays editable for a one-note exception. Collections join note creation for the first time — previously a note could only be added to a Collection after it existed.
- If a synced change removes the chosen Collection or Library while the form is open, the note is still created and a notice explains it was left unfiled, rather than placing it under the wrong heading or failing after the file already exists.

### Changed

- **Quick entry: Create note…**, **Add → Create note**, **Create note from template or empty note…**, and the `obsidian://kbcc-create-note` URL all open the unified form directly in the generic profile; none of them ask for a destination up front anymore. The ENT clinical profile is unchanged: its protected proposal workflow and native-library restrictions are untouched.
- The separate **Create in Inbox** entry was removed from the Add menu because Create note now defaults to the Inbox. The empty-Index call to action still creates directly into the Index, where filing into the Inbox would look like nothing happened.

### Fixed

- Pasting very long text into a settings field or importing a workspace configuration containing one could persist a value the loader refuses, making the entire multi-base store open read-only on the next launch — on every synced device. Every writer now clamps user-editable text to the same 10,000-character bound the loader enforces, applied once more immediately before each save so no entry path can slip past it.
- Restored the plugin's older-web-view compatibility a second time. The bundle called the platform's `structuredClone` in 84 places; that API needs Chrome 98 / iOS 15.4, above the floor release 0.13.1 deliberately restored, and one call ran while the plugin class was still being constructed — so on an older Android web view the plugin failed to load at all. All call sites now use an in-house ES2018 clone helper, and the community verification script fails the build if `structuredClone` reappears in either the source or the bundle, closing the enforcement gap that let a DOM-declared global bypass the pinned compiler baseline.
- Every ordering that reaches persisted bytes or decides a cross-device tiebreak now compares strings by code units instead of locale collation. Two devices with different system locales could order the same tied library names, group titles, or provisional vault identities differently, which changed semantic fingerprints, reset sync ancestry, or made each device prefer its own copy indefinitely. Display-only sorts keep natural locale collation.
- A rejected write during the one-time startup migration or repair no longer aborts plugin loading. Previously the plugin was left enabled but with no view, no commands, and no settings tab — so the recovery guidance in its own warning was unreachable. It now degrades to the designed read-only state with the warning visible and the Sync & Recovery Center available.
- After a synced change was merged, the automatic view refresh ran while the reload guard was still armed, so the refresh's own bookkeeping saves were rejected and the open Command Center kept showing the pre-merge tree with an alarming notice. The guard now lowers once the merge is committed, immediately before the refresh, and re-arms for any change that arrives mid-refresh.
- The Manage index Diagnostics tab recomputes after membership and group changes made inside the modal instead of serving the list and count captured when the tab was first opened.
- Editing an extension topic's placement can no longer select one of its own descendants as parent, which would have created a hierarchy cycle that detached the branch from every root. The picker filters descendants out and validation refuses them at any depth.
- Folder fields now refuse the characters note titles already fold away (`\ : * ? " < > | # ^ [ ]`, trailing periods or spaces, and Windows-reserved names), which previously broke the wikilinks Obsidian builds from the full path.
- Portable exports order subjects with a consistent comparator; a subject with no parent previously compared inconsistently against its neighbors, so the exported order could depend on input order and JavaScript engine.
- Removed the unreachable legacy workspace import/export path inside Manage index (about 150 lines); the Export/Import center owns that flow and validates strictly more.
- The documentation no longer tells mixed-device fleets to install "0.12.x", which can no longer edit the current store format; upgrade guidance is now version-neutral, the troubleshooting cross-link points at the section that actually exists, and the What's new window description matches the real trigger rule.

## 0.13.3

Maintenance release. Nothing changes in how the plugin behaves; every message, command, and stored format is exactly as in 0.13.2.

### Changed

- Consolidated error-message handling. The same expression that turns a failure into readable text was written out in about fifty places, so improving one message meant editing all of them. It now lives in one helper. Every message you can see is byte-for-byte unchanged, including the five places that show a specific sentence rather than the raw failure text — that was verified by comparing every text literal in the source before and after.
- Documented moving a subheading itself on touch devices in the user guide, the troubleshooting notes, and the manual iPhone checklist. The feature shipped in 0.13.2, but the documentation still described moving records only, which is what made it look absent on iPhone in the first place.
- Updated the author contact on the project page.

## 0.13.2

### Fixed

- Restored the ability to rearrange nested subheadings on iPhone, iPad, and other touch devices. Nesting arrived in 0.13.0, but touch devices use labelled row action menus instead of drag-and-drop, and the subheading menu only ever offered moves between siblings — so a subheading could be created inside another one but never moved into or out of one without a desktop. Both the Collection and Library subheading menus now offer **Move under…**, which lists every valid destination by its full path together with an explicit top-level entry, and **Outdent one level** for the common case. Both actions also appear on desktop, where a precise menu move is often easier than a drag.
- A subheading move carries its notes and every nested subheading with it, in order. A destination is offered only when it is neither the subheading itself nor anything already inside it, and only when the moved branch still fits the five-level limit — so a tall branch is correctly refused a destination that a single subheading is offered. If a synced change replaces the layout while the destination list is open, the move is refused rather than applied to the wrong place, and if nothing qualifies the plugin explains why instead of showing an empty list.

## 0.13.1

### Fixed

- Restored compatibility with older mobile web views. The plugin declares a 2018 JavaScript baseline, but the bundler rewrites newer *syntax* only and never newer *library methods*, so four newer methods were reaching devices unpolyfilled. The most serious, `Array.prototype.at`, is used while classifying note paths and requires iOS Safari 15.4 or Chrome 92; below that it raised a type error instead of loading the knowledge base. The remaining three (`Object.fromEntries` twice in settings and sync merging, and `String.prototype.trimEnd` in Quick append parsing) require iOS 12.2 or Chrome 73. All five call sites now use equivalents inside the declared baseline, with identical behaviour for every input.
- Made the declared JavaScript baseline enforceable. The compiler configuration named no explicit type packages, so an installed dependency silently raised the effective language level and even declared one of those newer methods without providing it at run time. The baseline is now pinned, and a build fails if any newer method is reintroduced.

### Changed

- Updated build and development tooling: the bundler, the Obsidian API type definitions, the test runner, Node type definitions, and TypeScript. None of these change plugin behaviour; the compiler upgrade also retired two deprecated configuration options.

## 0.13.0

### Added

- Subheadings can now contain further subheadings, up to five levels including the heading, in both Collections and Libraries. **Add subheading** appears on any heading or subheading below that depth, pickers and Quick Entry label every destination by its full path (`Board review / Airway / Emergencies`), and removing a nested subheading promotes both its notes and its child subheadings to the parent rather than discarding them.
- Added a starter template pack under `templates/` covering study topics, source notes, projects, meeting or case logs, and a question inbox, each using the creation-time YAML-safe tokens, plus a guide explaining which token resolves where.
- Added a dedicated Apple Shortcuts guide documenting all ten fixed action-only URLs, why every query parameter is rejected, and how to build a Shortcut for the Home Screen, share sheet, or Back Tap.

### Changed

- Editing an indexed note no longer re-enumerates the vault. A vault or metadata event now rebuilds only the affected note's record and splices it into the cached ordering, instead of discarding the whole projection and re-scanning every Markdown file. Renames continue to take the full path deliberately, because a rename reprojects every stored path.
- Searching in **Manage index** builds only the active tab's list and reuses it between keystrokes, so typing no longer enumerates the vault once per character, and hidden tabs never pay for a list they do not display.
- Bulk **Remove from index**, **Restore to index**, and Library adoption resolve records and portable subjects through per-base maps instead of scanning every record for every selected note.
- Startup deep-copies the knowledge-base store once instead of three times before the plugin finishes loading.
- Collections and Libraries now render through one recursive structure renderer instead of two parallel implementations that had drifted apart; the Libraries tab regains the repair guidance its missing-count indicator had lost.
- Advanced knowledge-base data to version 14 and the multi-base store to version 15 so that nested layouts cannot be silently flattened by an older build; older versions display existing data read-only instead of writing a truncated copy back through Sync.
- Advanced portable packages to format version 5 and same-vault recovery packages to version 10. Older packages still import unchanged, and layouts nested deeper than five levels keep their notes by merging them into the nearest allowed level rather than dropping them.
- The external-Sync reload handler was restructured behind a typed per-capture outcome record. Behaviour is unchanged and verified as such; the goal is that a future branch cannot forget to record a rescue payload without failing to compile.

### Fixed

- Made canonicalization agree across the plugin. Sync winner selection, migration equality, and portfolio guard tokens previously used three separate implementations that disagreed about a literal `__proto__` key, so the same store could be canonicalized differently depending on which one asked.
- Made Unicode validation agree between Quick append and portable export. Text ending in an unpaired surrogate was accepted when written and rejected later during transfer validation; it is now rejected at entry.
- Enforced the ten-megabyte import ceiling on the two remaining desktop import paths, workspace configuration import and organization backup import, which read and parsed a chosen file without checking its size.
- Stopped the Taxonomy Health Center from repeating its stale-knowledge-base notice, and made every manager dialog share one staleness guard rather than six variants with different checks.
- Made guarded dialog timers resolve the window that created them, so a dialog in a pop-out window is no longer cancelled through the focused window.
- Removed unused exported functions and redirected tests that exercised wrappers the plugin never calls onto the code paths it actually runs.

## 0.12.1

### Fixed

- Prevented a permanent freeze when switching or creating a knowledge base while the Command Center was open. A view refresh could wait on the very transaction that started it, and because the stalled operation held an App-wide barrier, disabling and re-enabling the plugin did not recover it. Refreshes that run inside a base or organization transaction now save through that transaction instead of queueing behind it.
- Stopped Sync from silently discarding work when a knowledge base deleted on one device had been restored and edited on another. A base whose edits are newer than the deletion is now preserved in a private conflict rescue before the deletion is adopted; unedited copies still disappear quietly.
- Added an automatic same-device backup of plugin data. Obsidian rewrites `data.json` in place, so an interrupted write could leave no readable copy of any knowledge base. Every save now refreshes a parseable twin first, startup restores from it when `data.json` cannot be parsed, and the unreadable file is kept beside it for inspection.
- Preserved an already-merged synced update that was followed by an identity-less payload from an older build. That combination entered protected read-only mode without keeping the merged organization, which was then lost at the next restart.
- Stopped note titles containing `$&`, `` $` ``, `$'`, or `$$` from corrupting generated frontmatter through the YAML-safe creation-time template tokens. A title could previously inject a premature `---` line and break the note's properties.
- Stopped an empty configured topic-proposal folder from reclassifying every resolved note as a proposal during startup repair, which dropped manual index entries and rehomed subjects. An empty setting once again means the proposal folder is simply unset.
- Restored drag-and-drop arranging in Library tabs on desktop. Drop targets read their payload during `dragover`, where browsers deliberately withhold it, so drops were never accepted.
- Kept saved manual ordering intact when a group name is entered or stored with different capitalization. The move could previously replace an entire group's arrangement with the single moved record and leave the destination collapsed.
- Stopped a parent topic whose `curriculum_id` is stored in lower or mixed case from being reported as a permanent placement conflict in **Needs my decision**.
- Refreshed the record inspector after a vault or Sync change that arrives while the search box is focused, instead of leaving a deleted or renamed note's details on screen.
- Kept device-local Undo/Redo history, routes, and collapse state when a portable package legitimately contains collection headings whose stable IDs use an underscore or non-Latin characters.
- Made Index health resolve parent links exactly as the hierarchy does, so an accent, tatweel, or Unicode-normalization difference is reported instead of silently flattening the tree while the report claims there is nothing to fix.
- Migrated group aliases, ordering, collapse state, and manual arrangements when a folder outside the primary folder is renamed.
- Neutralized Windows-reserved device names that carry an extension, such as `con.jpg`, when attaching files. Such an attachment could not be created on Windows and made a vault carrying it unsyncable to Windows devices.
- Made the one-time envelope identity fingerprint independent of the device's language collation. Two devices with different system languages could otherwise compute different fingerprints for identical data and permanently reject a legitimate same-vault Sync; fingerprints written by earlier builds are still accepted.
- Allowed a manually repaired `data.json` to load into protected read-only mode instead of preventing the plugin from being enabled at all, which had blocked even read-only export of the surviving data.
- Cancelled the pending refresh timer on the window that created it, so unloading the plugin while a pop-out window has focus no longer leaves orphaned **Open Library** commands in the palette.
- Allocated portable subject identities once and saved them before a portfolio export, so re-importing a portfolio matches existing subjects instead of duplicating every linked subject.
- Stopped **Attach file** from rewriting every line ending in a note that mixes line-ending styles, and from refusing notes that quote a fenced code block inside an indented block.
- Kept the Quick append category editor open, with the typed draft intact, when a duplicate category name is rejected.
- Preserved the caret position while typing in the Taxonomy Health Center filter.
- Added the same stale-data guard the other manager dialogs use to **Manage knowledge bases**, so a rename or archive cannot act on a list that Sync replaced while the dialog was open.
- Made the bulk selection button in **Manage index** do what its label says, and cleared a stale selection when the search query changes.
- Stamped export and backup filenames with the local date instead of the UTC date.
- Set automatic text direction on every Settings text field so right-to-left names, including Arabic, are typed and displayed correctly.
- Buffered the **Recent changes limit** slider so dragging it saves once at rest instead of rewriting the entire plugin store on every step.
- Removed `versions.json` entries for versions 0.1.0 through 0.7.0, which have no published release. Obsidian 1.5 to 1.9 installations resolved those entries and failed with an opaque download error instead of a clear compatibility message.

## 0.12.0

### Added

- Added a one-time, device-local **What’s new** window after an existing installation upgrades to 0.12.0. It summarizes the release with an explicit, safe link to the exact GitHub release page; the plugin makes no request to GitHub, never shows the window on a truly fresh install, and also provides **Open what’s new** for deliberate reopening.
- Expanded the stable **Knowledge hierarchy** view for Obsidian `.base` files into a configurable Generic view. Title, ID, fallback group, status, priority, page size, and group counts can be set through native Bases view options; native Base grouping, formulas, limits, and user sort remain authoritative.
- Added bounded multi-base portfolio export/import for up to 50 available knowledge bases. Each bundle contains a strict manifest and independent existing-format portable packages per base, with source-to-destination mapping, per-base Merge/Replace, and per-source component and Library selection.
- Added an exact dry-run portfolio plan used verbatim by apply, with categorized base, heading, subject, Library, conflict, folder/template fallback, and explicit will-not-change previews. Replace requires typed confirmation and writes a same-vault recovery for every affected destination before mutation.
- Added a path-safe **Sync & recovery center** command and an entry under **Manage index → Diagnostics**. It reports the active base, semantic revision and shortened head, local save/reload history, bounded conflict-rescue counts and ages, confirmed recovery age, protection reason, device-local profile context, and active-base concurrent-edit evidence using local public APIs only.
- Added Quick append for the active or a chosen Markdown note. Users can file repeated follow-up items beneath configurable Questions, Lectures to watch, Sources, Thoughts, To read, Other, or custom category headings without duplicating the managed section.
- Added base-specific category management with stable marker IDs, rename/reorder/archive/restore, bullet or checkbox style, and optional dates, plus focused commands and fixed action-only Apple Shortcut URLs for current-note and note-picker entry.
- Added six fixed action-only Apple Shortcut URLs for the focused Quick Entry flows and <code>obsidian://kbcc-attach-current</code> for the locally active eligible Markdown note. All use the same guarded blank handlers as their commands and reject every query parameter before opening a hub, picker, or form.
- Added optional note-creation profiles for active and archived Libraries. Each profile inherits the knowledge base defaults field by field or overrides its destination folder, Empty/Template mode, and template; the resolved Create note form remains editable per note.
- Added explicit creation-time YAML-safe template tokens for Library context: `{{yaml:title}}`, `{{yaml:id}}`, `{{yaml:category}}`, `{{yaml:parent}}`, `{{yaml:library}}`, and `{{yaml:type}}`. Missing values become a quoted empty scalar, while legacy `{{title}}`, `{{date}}`, and `{{time}}` behavior remains unchanged.
- Added an explicit **Attach file to current note…** command with per-knowledge-base storage policies: follow Obsidian, fixed vault folder, note-local folder, or ask each time. Generated links can be inserted at the editor cursor, a configured marker or heading, or the end of the note.
- Added guarded binary import through Obsidian's vault APIs, including a 100-megabyte per-file ceiling, collision-safe filenames, immutable-source and <code>ai_lock</code> protection, replaced-note detection, and clear partial-success reporting when the file was copied but its link could not be inserted.
- Added a Taxonomy Health Center for duplicate and visually confusable names, case/hyphen variants, parent or cycle problems, empty or unreachable structure, unavailable configured folders/templates, duplicate note bindings, and unresolved placeholders that may match local notes. Findings are read-only by default; the two deterministic parent-edge repairs require an explicit preview and are saved as one Undo-protected plugin-state transaction.
- Added one stable **Open Library** command per active Library for user-assigned hotkeys, the mobile toolbar, and Obsidian Quick Action. Commands are refreshed after Library or base changes and revalidate the active base before opening.

### Changed

- Advanced the multi-base store to version 14 and separated semantic organization revisions from device-local view state. Selection, active tabs, live collapse state, and Undo/Redo history no longer advance Sync conflict ordering, while existing version 11–13 stores migrate with a zero semantic baseline and newer stores remain read-only in older builds.
- Bound device-local state to the exact vault identity and moved legacy version 11–13 routes, collapse state, and the newest Undo/Redo history into a four-megabyte App-local profile before neutralizing synced data. Legacy unbound profiles are discarded; a valid profile for another identity is retained but never applied unless that exact established vault arrives after a temporarily missing store.
- Advanced standalone Workspace settings exports to version 2 so older builds reject settings they do not understand instead of silently dropping Quick append, attachment, or Library-profile configuration; version 1 remains importable.

### Fixed

- Made the Command Center respond to its actual Obsidian leaf width, including stacked tabs and pop-out windows. Compact mode now begins below 1050 px of leaf width (not window width); compact and narrow leaves use a focused record-details route, scroll-safe header actions, and bounded tabs/search instead of retaining the wide two-column dashboard from the surrounding window.
- Kept Create Note and library-specific creation forms inside the visible iPhone viewport while the software keyboard is open. The modal now reconciles Obsidian's native keyboard inset with the browser visual viewport, keeps the action footer visible, and makes the form body the only scrolling region.
- Resynchronized focused fields throughout the iOS keyboard animation and scrolled the active control into view without retaining listeners or timers after the modal closes.
- Kept custom Bases headings, row metadata, and pagination inside narrow panes, with 44-pixel row and pager targets at compact widths and visible keyboard focus.
- Made the multi-base portfolio modal a labelled keyboard-operable tab interface with a persistent Cancel action, logical focus restoration after source/destination/acknowledgement/preview paging changes, and owner-window iOS keyboard geometry that keeps typed confirmation reachable.
- Gave taxonomy repair previews a single bounded scrolling body with fixed, wrapping 44-point actions; made Quick Entry descriptions scale and wrap with bidirectional text; and gave text prompts persistent visible and programmatic labels.
- Kept initial Sync & Recovery focus on the modal context, then announced each explicit local recheck and restored focus to its action.
- Added a confirmed **Clear device-local data** command and Sync & Recovery action that removes this plugin's route, collapse, Undo/Redo, Quick append Undo, local recovery facts, and update-announcement history without changing Markdown, attachments, exports, or synced organization. Pending view saves and recovery recorders remain suppressed until restart so an uninstall-session reset cannot recreate either local value.
- Kept portfolio preview announcements concise instead of making the full rich preview a live region, kept taxonomy repair preview focus on its title and context, and revalidated an exact taxonomy repair again at the queued mutation boundary.
- Rewrote every compatible older same-vault envelope to the current outer and inner store versions after external Sync delivery, including equal-semantics and incoming-winning merges.
- Buffered attachment folder, marker, and heading text settings before persistence, avoiding a full plugin-data rewrite and Sync revision on every keystroke.
- Required Quick append Undo to target the exact original note object, so a deleted-and-recreated same-path note cannot receive an older note's rollback.
- Rejected workspace imports that would leave Quick append with no active category, and validated imported fixed attachment folders before applying settings.
- Extended Taxonomy Health checks to fixed attachment folders and effective per-Library creation folders and templates.
- Preserved empty Libraries and headings, portable placeholders, and intentionally unplaced subjects across portfolio transfer; added stale base/store/Sync guards, cross-vault Replace acknowledgement, bounded mobile previews, and atomic rollback through the existing store transaction path.
- Preserved Library creation profiles through settings exports, portable workspace dependency descriptors, settings-bearing named snapshots and Undo/Redo entries, Library renames/archives, and vault folder/template renames; permanent Library deletion removes its profile atomically.
- Made workspace imports reset unavailable, restricted, or out-of-folder Library templates to Empty inside the same Undo-protected transaction while still rejecting invalid destination folders; legacy standalone workspace imports report and omit profiles without a matching destination Library ID.
- Kept the Library-profile editor inside the iPhone visual viewport during keyboard animation, with 44-point controls, safe-area padding, explicit effective-value summaries, and stale Sync/base guards.
- Repair duplicate, missing, or unsafe collection, subheading, and saved-view IDs deterministically during ordinary plugin-data loading, so damaged synced data cannot make edits target the wrong item or remove multiple saved views at once.
- Keep collection and Library heading identities globally unique across hierarchy levels during import and recovery, preserving existing local identities and making repeated Merge imports stable across reloads.
- Replaced the four-base cross-base-search cache with a scan-resistant 50,000-record working set, retained unaffected projections across path-scoped vault changes, and restricted each uncached projection to its configured folders plus explicit references. Large multi-base vaults no longer rescan every Markdown path for every inactive base on each keystroke.
- Prevented a newer selection-only or collapse-only save from replacing structural work made on another device. Sync now compares monotonic per-base semantic revisions, overlays this device's view state by stable heading/subheading IDs, and clears stale local history only when remote semantic organization replaces it.
- Detected equal-revision divergent semantic edits explicitly, wrote every possible losing complete envelope to a private in-vault conflict rescue before adoption, and failed closed without selecting a winner when that rescue could not be created.
- Added a fenced view-state save path that waits for base, transaction, Sync, and adapter queues and copies only the explicit device-local whitelist onto the last committed semantic snapshot, preventing navigation saves from carrying unsaved organization changes.

### Performance

- Replaced the custom Bases view's synchronous whole-result metadata projection and sort with generation-safe 250-entry grouping slices and bounded 25–300-row pages. A 10,000-entry result keeps only the configured page in the DOM while **Previous** and **Next** replace that page.

### Security

- Kept portfolios free of note bodies, attachments, exact note bindings, and private recovery; rejected malicious IDs, paths, mismatched manifests, oversized packages, and aggregate budget overruns through the existing strict portable parser.
- Kept Sync and Recovery diagnostics device-local and telemetry-free. The center does not probe Obsidian Sync or the network, read export JSON or Markdown bodies, or display vault/base identifiers, custom configuration names, export filenames, or full paths; artifact inspection is capped at 2,000 direct export-folder entries.
- Made Quick append atomic and fail-closed: it checks <code>ai_lock</code> inside the write transaction, preserves all text outside the strict managed block, enforces bounded input and entry counts, and keeps only compact in-memory fingerprints for a five-minute exact undo. Note bodies and appended text are never stored in plugin data.
- Shared one strict fail-closed <code>ai_lock</code> parser between Quick append and attachment writes. Duplicate, escaped, nested, merged, or malformed declarations are refused before a binary or Markdown write; only an absent key or one explicit false/null declaration is writable.

### Verification

Automated release checks passed on this candidate: 670 runtime tests, 10 release tests, TypeScript, ESLint, JSON validation, production build, Community static verification, and dependency audits with zero findings, plus an independent review that reproduced and confirmed the store version 14 Sync fixes against the previously published defects. The physical-iPhone checklist for 0.12.0 — including item 41 for the post-update What's new window — was explicitly waived by the maintainer for this release and was not executed on a physical device. This release does not claim that the manual device matrix passed; the full matrix is inherited by the next release that changes mobile behavior.

## 0.11.1 (unpublished; folded into 0.12.0)

This candidate was never tagged or released. Its completed iPhone, stacked-pane, and configurable Bases work is included in 0.12.0.

## 0.11.0

### Added

- Added Quick entry from a dedicated desktop ribbon action (shown in Obsidian's **Open** menu on mobile) and the Command Center header, plus seven icon-bearing commands that users can assign under Hotkeys or add to Obsidian's mobile toolbar. No default key combinations are installed.
- Added focused Quick entry flows to switch knowledge bases, create transactional No note subjects, create Index/Collection/Library headings and subheadings, choose note groups and templates, and add the current or an existing Markdown note. Library capture now requires an explicit heading or subheading and can create the first heading when the Library is empty.
- Bound every delayed Quick Entry menu and picker to the knowledge-base ID and data epoch that opened it, while preserving the base picker as an explicit guarded switch.
- Added the action-only <code>obsidian://kbcc-quick-entry</code> route for Apple Shortcuts. It opens only the hub; any query parameter fails closed and cannot prefill or submit a title, path, content value, or other data.
- Added project artwork, real desktop and iPhone screenshots, focused getting
  started, user, portability/recovery, and troubleshooting guides, and an
  explicit 0.10.0 physical-iPhone evidence record.
- Added support and conduct policies, structured feature-request intake,
  pull-request privacy/mobile checklists, and Dependabot configuration.

### Changed

- Reworked the public README around installation, the product model, common
  workflows, privacy boundaries, known limitations, and recovery.
- Added complete package metadata for the project homepage, author, topics, and
  supported development runtime.

## 0.10.0

### Added

- Added user-defined Libraries to every knowledge base. Create any top-level category, choose its name, singular item label, and icon, then organize its subjects with the same editable headings, nested subheadings, ordering, and unplaced state used by the built-in clinical libraries.
- Added a searchable **Manage libraries** surface in plugin settings and the command center. Libraries can be renamed, reordered, archived, restored, and—after archival—permanently removed with an explicit destination for every remaining subject. These actions change plugin organization only and never delete, move, rename, or rewrite Markdown notes.
- Added direct Create, Add existing note, Add current note, search-result classification, and Move to another section actions for arbitrary libraries. A subject has one primary Index/Library section per knowledge base; Collections remain the reusable cross-library lists.
- Added portable-package format version 4 with stable library definitions, arbitrary selected library IDs, exact nested layouts, empty libraries, and intentionally unplaced subjects. Selective Merge or Replace applies only to the chosen Index and Libraries, while imports from versions 1–3 remain supported.
- Added dynamic-library coverage for desktop drag-and-drop, touch menus, iPhone compact rows and focused search, Undo/Redo, Sync reloads, saved views, same-vault recovery, and cross-vault placeholder creation/linking.

### Changed

- Replaced the fixed Procedures/Medications/Syndromes navigation model with stable dynamic Library tabs. The ENT preset still supplies and protects those three built-in semantic libraries, while Generic and ENT bases can add independent custom libraries without changing their preset.
- Advanced plugin data to schema version 12 and the multi-base store to version 13. Older builds recognize the newer store and open it read-only rather than overwriting custom-library data.
- Made portable export summaries and component selection use each library's configured label instead of hard-coded clinical categories.

### Fixed

- Prevented a newly enabled device whose plugin data has not synced yet from publishing an authoritative empty store. Fresh-device state stays provisional, harmless first-open saves yield to an established synced store in either Sync direction, meaningful offline work receives a private in-vault conflict rescue, and temporarily missing Markdown files retain their bindings.
- Serialized adapter reads and writes across old and replacement plugin instances during reload so the replacement cannot read stale data or let an older in-flight write land last.
- Allowed first-upgrade identities with the same legacy origin to converge when exactly one copy was edited, while continuing to reject two independently edited copies; repeated duplicate-name merges no longer nest generated `(synced N)` suffixes.
- Bounded ordinary browse rendering to 300 record rows and 300 structural sections per page, retained prior results while a replacement search runs, added an explicit retryable error state, preserved focused mobile queries across safe same-base reloads, and cached a bounded set of inactive-base search projections between keystrokes.
- Made search and every fuzzy picker fold clinical apostrophes, wrapper quotes, Arabic alef wasla, lam-alef presentation forms, diacritics, and existing Arabic/Persian keyboard variants consistently.
- Recovered portable subjects whose group was missing into a deterministic Ungrouped section, repaired invalid/cyclic parent links without dropping bindings, enforced hierarchy depth independent of input order, bounded imported history by UTF-8 bytes, and rejected malformed or visually spoofed portable titles.
- Validated retained v1/v2 migration backups, limited each to 2 MiB and at most one of each per store, and stopped new or duplicated knowledge bases from copying historical recovery payloads.
- Prevented title-only portable matching from conflating distinct resolved same-title notes; weak title matching remains available for unresolved placeholders.
- Routed Index Manager Add/Restore through the guarded membership API, kept Library-assigned records out of misleading Available/Hidden lists, and preserved group collapse state through rename and merge.
- Made direct settings controls restore their prior in-memory value and report a clear notice when Sync or an adapter rejects the save.
- Raised mobile tabs, chips, paging, and retry controls to 44-point targets, replaced the smallest fixed-pixel labels with scalable units, and made subject alignment direction-aware.
- Made local release ZIP creation use PATH-resolved tools with a PowerShell fallback on Windows and verify archive entries directly in Node.
- Preserved custom library identity and hierarchy across export/import even when another library has the same visible name, and kept an explicitly selected empty library authoritative during Replace.
- Prevented deleting a non-empty library without first choosing Index, another active Library, or Unassigned as the subject destination.
- Kept archived or deleted library tabs out of active navigation and redirected stale active/default tabs safely to the Knowledge Index.
- Made repeated registry synchronization and export idempotent, including same-title Index and Library groups, and preserved unselected empty Index or Library heading identities during selective Replace.
- Captured incoming Sync data before any in-flight local save can overwrite it; overlapping local organization edits now roll back clearly and the authoritative merged envelope is written back safely.
- Included navigation-only Library dependencies in mandatory import Undo snapshots, sanitized unavailable imported Library tabs and saved views, and kept legacy v1–v3 navigation dependencies compatible without inventing unknown identities.
- Made Library names and heading/group matching locale-invariant across devices, including Turkish and Azeri host locales.

## 0.9.0 (unpublished; folded into 0.10.0)

This development version was not tagged or released. Its completed catalog-management work is included in 0.10.0.

### Added

- Added full Procedures, Medications, and Syndromes catalog management to generic knowledge bases: create headings and nested subheadings, rename/delete/reorder them, and place or reorder records with desktop drag-and-drop or touch-friendly row menus.
- Added direct **Create**, **Add existing note**, and **Add current note** flows for each library. A note can also move between the Knowledge Index and any library without moving, renaming, or rewriting its Markdown file.
- Added editable adoption of the ENT preset's existing clinical libraries. Entering Arrange creates stable path-free identities and visual headings in one Undo-safe transaction while keeping clinical source classification protected.
- Added path-free nested library layouts to portable-package format version 3 and same-vault recovery format version 8. Imported catalogs preserve headings, subheadings, record order, intentionally unplaced records, and empty structure without exposing note paths or bodies.

### Changed

- Made catalog classification, display names, layouts, and Undo history independent for every knowledge base, so the same Markdown note can remain a topic in one base and a medication, procedure, or syndrome in another.
- Kept empty configured library tabs visible and made catalog actions contextual to the active tab on desktop, iPhone, and iPad.
- Advanced plugin data to schema version 11 and the multi-base store to version 12. Older builds recognize the newer store and open it read-only instead of overwriting it.

### Fixed

- Prevented a note added to Medications, Procedures, or Syndromes from remaining in the active base's Knowledge Index unless it is intentionally moved back there.
- Made deletion of a non-empty library heading durable: its records remain explicitly unplaced, and reopening Arrange does not recreate the deleted heading.
- Prevented local and native clinical records from exposing imported-placeholder unlink controls that could leave a duplicate placeholder beside the original note.
- Preserved catalog kind and placement across portable merges, identity merges, Sync reloads, file/folder renames, Undo/Redo, and same-title groups used by different libraries.
- Prevented selected-section imports from reclassifying unselected dependencies or bypassing the ENT preset's fixed clinical source classification.
- Kept large-catalog projection and placement lookup bounded with indexed subject-to-heading maps instead of repeated full-layout scans.

## 0.8.3

### Added

- Added grouped cross-base search across every available, non-archived knowledge base. The active base appears first, other bases are ordered by workspace name, and each base is subdivided by library section; activating a result switches to its base, then selects the note-backed record or opens a placeholder's create/link actions.
- Added a required manual physical-iPhone release checklist plus explicit mobile-update, per-base backup/restore, privacy, advanced ENT file-change, and known-limitations documentation.
- Added dependency-free fake-DOM integration tests for iPhone keyboard viewport sizing, search scroll reset, mobile drag-control suppression, and the 300-row search render cap; real-device iPhone behavior still requires the release checklist.

### Changed

- Rebuilt cross-base search as a cancellable, time-sliced scan with an exact-count bounded collector: only the 300 strongest matches are retained and sorted, results are regrouped in active-first visual order, and every base's full match count remains visible.
- Built cross-base search from one shared Markdown/frontmatter snapshot while retaining only the active base's full record cache; file events cancel stale searches and invalidate only affected record caches, including clinical proposals outside their configured Inbox, while active-base link lookup remains correct.
- Replaced repeated array membership and position scans in Index Manager, organization diagnostics, and repair paths with stable set-based lookups for large indexes.
- Extended Community-policy verification to inspect the built `main.js` bundle as well as TypeScript source, added Obsidian network-API and external-module checks, and made the review sequence build before that bundle check.
- Corrected the path-enumeration disclosure to distinguish whole-vault Markdown paths, the all-entry pass used to derive folder-picker choices, and the all-file pass used to list in-vault JSON packages.

### Fixed

- Disabled and guarded organization-snapshot saving in compatibility read-only mode before changing in-memory state, preventing a false success notice when `data.json` cannot be written.
- Cleaned up only newly created, still-empty destination folders after failed note creation, mobile export, proposal promotion, or canonical placement; pre-existing and non-empty folders remain untouched.
- Hardened ENT proposal-promotion and canonical-placement rollback to track the exact file object moved by the operation, so a destination created concurrently by Sync is never selected or overwritten; rollback failures now surface an explicit recovery error.
- Made search normalization locale-invariant, removed Arabic tatweel, unified Arabic/Persian ya and kaf variants, treated `ة`/`ه` as equivalent lookup forms, and normalized Arabic/Persian digits; this also prevents Turkish/Azeri host locale from changing indexed keys.
- Kept focused search responsive at iPhone-class mobile landscape widths through 1024 CSS pixels and compensated for iOS visual-viewport panning when the software keyboard moves below the command-center shell; the physical-device release gate remains required.

## 0.8.2

Version 0.8.1 was not published as a tag or GitHub release. Its completed work was folded into 0.8.2 and is included below.

### Added

- Added independent portable-export and import choices for Procedures, Medications, and Syndromes. Each selected library transfers only path-free names, group labels, record kinds, and stable identities; no Markdown paths, note bodies, doses, or attachments are included.
- Added automatic Procedures, Medications, and Syndromes tabs in generic destination bases whenever those portable libraries are present. Missing notes remain actionable placeholders that can create or link a local note without changing the destination preset.

### Fixed

- Made non-empty search queries cover every record in the active knowledge base instead of only the last selected tab. Results are grouped by library and rank title, alias, ID, and path matches ahead of broad group or domain matches.
- Kept focused iPhone search results inside the keyboard-reduced visual viewport, retained a nonzero results pane, disabled WebKit scroll anchoring for that route, and reset all result scroll owners again after layout settles.
- Restored the selected tab to view after leaving focused mobile search, so a previously selected off-screen library tab is visible again.
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
