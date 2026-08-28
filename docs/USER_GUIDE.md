# User guide

This guide explains the Command Center's main surfaces and how their organization relates to the Markdown files in an Obsidian vault.

## Navigation

The header contains:

- the active knowledge-base switcher;
- the Knowledge Index, Inbox, Collections, smart-queue, and active Library tabs;
- global search;
- Add, Arrange, saved-view, and overflow actions where relevant.

Switching knowledge bases changes every open Command Center view because the active base is plugin-wide. Archived bases do not appear in navigation or search until restored.

## Knowledge Index

The Index of a new Generic base starts with no folder-authoritative membership. A note joins when you explicitly add that note or when you explicitly link a folder whose rule supplies eligible descendants. The default new-note folder controls storage only and never enrolls a note by itself.

The initial hierarchy uses:

- the configured group property or direct subfolders for top-level groups; and
- the configured parent property for parent/child relationships.

Choose **Arrange** to create a separate visual hierarchy. On desktop, drag records where a valid drop target is offered. On touch devices, use each row's **…** menu to:

- Move under;
- Move to group;
- Indent or Outdent;
- Move up or down;
- Make top-level; or
- Reset placement.

A subheading's own **…** menu moves the subheading itself, with the same two
actions on desktop and touch:

- **Move under…** lists every place the subheading can go, each shown with its
  full path, plus the heading itself for the top level; and
- **Outdent one level** lifts it beside its current parent.

A move carries the subheading's records and everything nested inside it. A
destination is offered only when it is neither the subheading nor something
already inside it, and only when the moved branch still fits the five-level
limit — so a tall branch is refused a destination that a single subheading is
offered.

Visual arrangement stays in plugin data. It does not change note paths or frontmatter.

### Index membership

Use **Add → Add existing note to Index** or the current-note action in a Generic base to persist direct membership for that exact note. Direct membership does not depend on the note's current folder. A folder supplies dynamic membership only through an explicit linked-folder rule; notes merely stored in the default new-note, Inbox, template, attachment, export, or Library creation folder do not join the Index for that reason. When an Inbox note is also supplied directly or by a linked rule, that explicit Index choice takes precedence over storage and the note appears in the Index, unless it has a deliberate Library classification.

Removing or hiding a record affects only the active knowledge base. For a note supplied by a linked folder, hiding records an Index exclusion instead of touching the file. Unlinking the folder removes only that source rule; a separately added direct member remains indexed. Generic membership, grouping, nesting, Library classification, Collections, pins, and queues never move, rename, delete, or rewrite Markdown.

Generic bases migrated from pre-v15 data temporarily keep the old `primaryFolder` as a reviewable **legacy linked-folder source** so the pre-upgrade result set does not disappear. The Command Center and Settings keep a warning visible until you choose **Review…** or run **Review legacy index source…** from the Command palette. The review lists only real Markdown notes currently available on this device whose membership depends on that source alone. It initially selects all notes for preservation when they fit within the direct-membership limit; use the filter, **Clear all notes**, or individual checkboxes as needed. Before **Apply review & unlink** becomes available, confirm that Obsidian Sync has finished and the folder's Markdown contents are complete on this device. A missing non-root source blocks Apply, and zero local candidates is never treated as proof that every synced copy is empty. Apply makes selected notes direct members and removes the folder rule in one Undo-protected transaction. An unusually large source that cannot fit is left unselected and explains its capacity instead of truncating the choice. **Keep linked** records an intentional dynamic-folder choice and remains safe when a folder is temporarily unavailable. **Not now** changes nothing, and the warning remains. None of these actions edits, moves, renames, or deletes Markdown.

Index rows show **Direct**, **Linked folder**, **Imported placeholder**, or **Protected source** so membership authority is visible. Compact panes use shorter equivalents while keeping the full explanation available to assistive technology. Choose **Why this appears** from a record menu or inspector to see every authority that applies at once, including the exact linked sources, exclusion, primary Library, Collections, pin and Next state. Its Markdown path is labelled separately as storage location and never presented as a membership rule.

The ENT preset protects canonical source classification and folder scope. It still permits personal visual organization where the profile allows it.

## Global Note Organizer

The Global Note Organizer coordinates existing-note organization across the whole KBCC installation. Open it with **Organize** in the Command Center, **Organize vault notes across knowledge bases…** in the Command palette, or **Organize current note across knowledge bases…** for the active Markdown note. Here **knowledge base** and **Base** mean a KBCC knowledge base; the Organizer does not read or edit native Obsidian `.base` definitions.

### Choose notes

The **Notes** step mirrors the vault's folder hierarchy and selects only eligible Markdown files. You can select individual notes or a folder, up to 5,000 selected Markdown notes in one review. A folder selection is expanded immediately into the current descendant-note paths and is therefore a one-time snapshot:

- it does not create or modify an Index linked-folder rule;
- future notes placed in that folder are not included automatically;
- removing or moving a selected file before Apply makes the prepared review stale; and
- selecting a folder never authorizes moving, renaming, deleting, creating, or rewriting any descendant.

The same snapshot behavior is used by Obsidian's public File Explorer context menus. Right-click one Markdown note for **Organize in KBCC…** and **Show KBCC memberships**; right-click a supported multi-selection or folder for the corresponding current-note-count action. The editor context menu offers the single-note actions for its Markdown file.

The **Organize** header button is also a progressive drop target for compatible Obsidian drag sources that expose bounded `text/plain` or `text/uri-list` vault paths. Every candidate must resolve to a current eligible Markdown note. Operating-system files, absolute paths, unsafe URLs, missing paths, restricted paths, and non-Markdown files do not enter the review. A vault-qualified `obsidian://open` URI is rejected even when it names the current vault because the drop surface cannot authenticate that vault name; use an unqualified vault-relative path instead. Because drag payloads differ by platform and theme, the File Explorer context menu and the Organizer's own vault tree are the supported fallback.

### Choose destinations and overrides

The **Destinations** step starts with shared destinations. Add each KBCC knowledge base that should change; the same note can target several bases in one review. For each target base, choose independently:

| Area | Choices | Result |
| --- | --- | --- |
| **Primary placement** | Keep current, place in an Index heading, place in a Library heading/subheading or Unplaced, or remove the primary placement | Maintains at most one primary Index or Library placement in that base. |
| **Collections** | Keep current, add selected targets, or replace with the selected targets | Collection memberships remain independent of the primary placement and can be additive. Replacing with no targets removes Collections only in that target base. |

Notes use the shared destinations by default. Under **Per-note behavior**, choose **Skip this note** to leave one selected note unchanged, or **Custom destinations** to give it a different set of bases and placements. A knowledge base omitted from a note's effective destinations is not changed; existing Index, Library, and Collection memberships in that other base remain in place. One review may contain at most 20,000 effective note/base directives after shared destinations and overrides are resolved; split a larger job into separately reviewed batches.

The ENT clinical preset keeps its destination-aware safeguards. Notes in restricted or immutable clinical scope are ineligible; a protected source kind can enter only a compatible protected Library; an Index placement must be source-eligible; and, while visual cross-domain movement is disabled, the note keeps its canonical source-derived Index group. An incompatible clinical choice is rejected during preparation rather than partially applied.

### Review, Apply, and Undo

Choose **Prepare review** to build exact before/after rows for every effective note/base destination. The review reports changed, unchanged, and skipped rows and states: **0 files moved · 0 files renamed · 0 Markdown files rewritten · 0 folder links changed**. Preparing a review does not change organization.

**Apply organization** accepts only that opaque prepared result. Immediately before and during the transaction, the plugin revalidates the exact Markdown file objects and their modification facts, every affected destination and heading, the knowledge-base state, and the observed Sync generation. If a file, destination, or synced plugin state changed, Apply fails closed before a partial organization result. Choose **Refresh review**, inspect the new before/after rows, and Apply again only when they are correct.

Each affected knowledge base receives its ordinary restart-durable per-base Undo entry. Before the primary plugin-store mutation, a multi-base Organizer Apply stages the exact required-Undo snapshot for every affected base as one protected batch. If those aggregate snapshots cannot fit within the shared 4 MiB device-local history budget, the whole Apply is refused without a partial organization change. Split the affected bases across batches; because each Undo entry is an exact whole-base snapshot, selecting fewer notes while targeting the same bases may not reduce this journal size. The newest multi-base Organizer batch also has two session-only commands:

- **Note organizer: Undo last multi-base change** reverses all affected bases together; and
- **Note organizer: Redo last multi-base change** reapplies that same batch.

Those coordinated commands remain available only in the plugin session that applied the batch and only while their exact newest-Undo guards still match. After restart—or after another incompatible organization change—use each base's durable **Undo personal organization change** action separately. Undo changes KBCC plugin data only and never reverses a Markdown file operation because the Organizer performs none.

### Active-note indicator

Every open Markdown editor gets an interactive KBCC organization indicator. Activate it—or run **Show current note’s knowledge-base memberships**—to open a read-only all-base summary, then choose **Organize…** if a change is needed.

The indicator conveys state through icon, accessible label, tooltip, class, and an optional multi-base count; color is supplementary:

- organized in the current base, including a distinct Collections-only label: success/green;
- organized in other bases but not the current one: accent;
- not organized anywhere: neutral/muted, which is a normal state; and
- broken persisted organization, such as a conflicting primary placement, duplicate or missing portable identity, unavailable Library, or simultaneous direct-and-hidden state: danger/red.

Red never means merely “not indexed.” Review the issue detail before changing organization.

A separate **Return to KBCC** action appears directly beside the organization indicator. When the current note path has a matching route captured as KBCC opened it, the action restores that originating knowledge base, tab or Library, selected record, search, compact-detail state, and list/detail scroll positions. That path-bound destination survives Obsidian restarts and follows note or folder renames. Without a matching route—or when the saved base or Library is stale—the action opens a clean KBCC Home instead; it never borrows a different note's route. Deleting a matching note or folder prunes its saved routes before a later file at the same path can use them.

Return history is bounded to 24 vault-scoped note routes and 256 KiB in a separate device-local App value. It keeps one route per note path, so opening the same note from a second KBCC page replaces the older origin for every editor showing that path. It can contain vault identity, note and selected-record paths, base/tab, the literal search text entered in KBCC, compact-detail state, bounded browse limits, and scroll positions. Saved browse-row and structural-section limits are each capped at 10,000; if a page had been expanded beyond that cap, Return restores the bounded available position rather than recreating an unbounded DOM. KBCC does not read or copy note bodies into this history, but user-entered search text can itself be sensitive. The history is not synced and **Clear device-local data** removes it.

The Organizer's bulk scope is existing Markdown notes. It does not create notes in bulk; use **Create note from template or empty note…** separately when a new file is required.

## Index Manager

Open **Manage Index…** from the Command palette, Index header, or overflow menu.

| Tab | Purpose |
| --- | --- |
| **Indexed** | Search current members, assign a visual group in bulk where permitted, or remove active-base membership. |
| **Available** | Add direct membership to eligible existing notes that are not already direct members. This includes notes currently supplied only by a linked folder, so you can make one durable before unlinking that folder. |
| **Hidden** | Restore records removed from the active base, including protected ENT subjects. |
| **Why included** | Audit direct memberships, imported placeholders, protected-source members, hidden overrides, every exact linked folder and its availability, and location-only storage/creation folders. An inherited linked folder can open its review from here. |
| **Index headings** | Create, reorder, rename, merge, or remove visual groups safely. |
| **Diagnostics** | Inspect missing references, duplicate membership, broken visual parents, and orphaned group state, apply the established safe reference cleanup, or open the broader Taxonomy Health Center. |

Index Manager changes plugin state only. It does not move, delete, or rewrite Markdown notes.

### Taxonomy Health Center

Open **Taxonomy health center** from the Command palette or **Manage Index… → Diagnostics**. It checks the active knowledge base for:

- duplicate display names, case/hyphen variants, and a small audited set of visually confusable Latin/Greek/Cyrillic characters;
- missing, self-referential, ambiguous, or cyclic visual, portable, and configured parent relationships;
- empty or unreachable Index, Collection, and Library headings or subheadings;
- configured folders or templates that are not currently available;
- multiple portable identities bound to one note; and
- unresolved portable placeholders whose title or configured ID may match a local note.

The report never rewrites Markdown or links identities automatically. Ambiguous findings are report-only. A deterministic invalid visual or portable parent can be cleared only after reviewing an exact preview; that repair changes plugin-owned organization in one transaction and can be reversed with **Undo**. Empty headings are preserved because they may be intentional scaffolding. Historical load-repair counts are not persisted in the current data format, so the center does not invent them.

## Libraries

A Library is a top-level primary category inside one knowledge base. Choose **Manage libraries** from settings or the Command Center menu to:

- create a custom Library;
- set plural and singular labels;
- choose an icon;
- reorder active Libraries;
- rename, archive, or restore a Library; and
- permanently delete an archived custom Library after choosing where its subjects should go.

Each knowledge base can retain at most 50 active and archived Libraries.

### Organize a Library

Open the Library and choose **New heading** or **Arrange**. Library structure can contain:

- headings;
- nested subheadings;
- placed records; and
- an explicit Unplaced section.

Any heading or subheading below the depth cap offers **Add subheading**. One branch can hold up to five levels, counting the top heading as level 1. Pickers show a nested destination with its full path, such as **Heading / Sub / Sub-sub**.

Deleting a heading does not delete its records or notes. The records remain Unplaced until deliberately moved. Removing a nested subheading moves its records and child subheadings up under its parent. Desktop supports drag-and-drop; touch devices use labelled heading, subheading, and row menus, and **Move under…** and **Outdent one level** on a subheading menu rearrange the nesting itself without dragging.

The **…** menu for each custom-Library heading or nested subheading also offers **Create note here…**. It opens the established Library creation form with the full destination breadcrumb fixed and visible, applies the Library's creation profile, and expands every owning ancestor after successful placement. The plugin validates the exact base, Library, heading path, writable state, destination path, and collision state both when the menu is used and again immediately before Markdown creation. A stale condition detected before creation writes no file. If the destination changes or placement fails while creation is already in flight, KBCC moves only the exact file it created to Obsidian's recoverable trash after proving its content is still unchanged. If that proof fails, KBCC preserves the file, reports its exact path, and directs you to **Add existing note**. Protected built-in sections omit the action.

### Classify records

From a Library, Add actions can:

- create a note in that Library;
- classify an existing note;
- classify the currently open note; or
- place an existing portable placeholder.

Outside a Library tab, **Add → Add to library…** lists every active destination and can create a new Library.

A subject has one primary Index/Library section per knowledge base. Moving a record to another section changes only that base's classification. It does not move, rename, or rewrite the Markdown file and does not remove Collections, pins, or Next status.

The ENT preset supplies Procedures, Medications, and Syndromes as protected semantic Libraries. A source-derived clinical record cannot be silently reclassified as another protected clinical kind. Custom Libraries remain visual containers.

Built-in ENT Libraries may be archived and restored but cannot be permanently deleted. Removing a record from a Library leaves it explicitly unassigned; it does not silently add the record to the Knowledge Index. Move it to the Index or another Library deliberately.

### Library creation profiles

Open **Settings → Libraries → Library creation profiles** to configure creation defaults for active or archived Libraries. Each Library can independently override:

- destination folder;
- starting content: Empty note or Copy a template; and
- template path.

Every field left on **Inherit** follows the active knowledge base's default. There are only two levels—knowledge-base defaults and one optional Library override. There is no content-type × Library matrix. The effective folder and content choice appear in the profile manager, and the Create note form remains editable for a one-note exception.

Profiles use stable Library IDs, so a rename or reorder keeps the profile. Archiving keeps it for later restoration. Permanently deleting a custom Library deletes its profile in the same Undo-protected transaction. Folder and template-file renames inside the vault update current settings and history entries that carry settings, including settings-bearing named snapshots and Undo/Redo entries. Profiles never move or rewrite notes, frontmatter, or attachments.

In the ENT preset, custom Libraries use these creation profiles. Protected source-derived Procedures, Medications, and Syndromes continue to follow their clinical classification safeguards rather than becoming a property-driven note generator.

## Collections

Collections are personal reusable lists across the Index and Libraries. A record can belong to several Collection headings or subheadings without duplication or file movement.

Use a record's menu or inspector to add it to a Collection. In Arrange mode, Collection headings and subheadings can be created, renamed, reordered, or removed, and any heading or subheading below the five-level cap offers **Add subheading**. Removing a nested subheading moves its memberships and child subheadings up under its parent. Removing Collection membership does not change the record's primary Index/Library classification.

## Smart queues

Depending on the profile and current organization, smart queues can surface:

- imported placeholders needing notes, with exact local title or configured-ID candidate counts;
- Inbox records;
- a personal Next list;
- pinned records;
- ungrouped records; and
- recently changed records.

Queues are views over existing records and plugin state. They do not create duplicate notes. The placeholder queue is always first: choose a subject to open its deliberate create/link choices, or run **Resolve next imported placeholder…** to begin with the next item. Exact candidates are hints, not automatic links, and any existing portable owners are disclosed before a deliberate merge.

## Create notes

Use **Add → Create note** or **Create note from template or empty note…**. In the generic profile the form opens aimed at your **Inbox** by default — type a title, press Create, and the note lands in the configured Inbox folder without joining the Index. A **Destination** row at the top shows the current target, and **Change…** re-targets the same form at:

- the **Index**, after choosing a visual group;
- a **Collection** heading or subheading, picked by its full path; or
- any **Library**, after choosing its heading or subheading.

Switching the destination re-seeds the folder, content mode, and template with that destination's own defaults — the same values its dedicated flow always used — and everything stays editable for a one-note exception. The form supports:

- a title;
- a vault-relative destination;
- empty content or a chosen local template;
- an optional default template; and
- optional Collection membership.

Templates may use <code>{{title}}</code>, <code>{{date}}</code>, and <code>{{time}}</code>. Other template syntax is copied unchanged. The path preview shows the destination before creation. Missing destination folders are created safely, and existing files are never overwritten.

When creation has an explicit Library context, templates may also use these quoted-scalar tokens:

| Token | Creation-time value |
| --- | --- |
| <code>{{yaml:title}}</code> | The note title as one quoted YAML scalar. Prefer this over plain <code>{{title}}</code> inside frontmatter. |
| <code>{{yaml:id}}</code> | Stable/configured subject ID when the placeholder already has one; otherwise <code>""</code>. |
| <code>{{yaml:category}}</code> | Title of the deepest selected Library subheading or heading, then the record group/Library fallback. |
| <code>{{yaml:parent}}</code> | Existing portable/configured parent title when known; otherwise <code>""</code>. |
| <code>{{yaml:library}}</code> | Current Library name. |
| <code>{{yaml:type}}</code> | Current Library's singular item label. |

The <code>yaml:</code> prefix is deliberate. Values are emitted as YAML-compatible double-quoted scalars, including escaping quotes, line breaks, and control characters. A template can safely write <code>category: {{yaml:category}}</code>. Tokens resolve only during explicit note creation; they are not reevaluated when a note opens, a Library is renamed, or organization changes. Plain <code>{{id}}</code>, <code>{{category}}</code>, and other third-party template syntax remain untouched. Legacy title/date/time behavior is unchanged.

Notes created through the primary action join only the destination explicitly chosen by that flow — the Inbox by default, or the Index, a Collection, or a Library when selected. Choosing or editing the file's folder does not create Index membership. When the Index is the destination, the plugin records direct membership even if the file is stored elsewhere. If a synced change removes the chosen Collection or Library while the form is open, the note is still created and the plugin explains that it was left unfiled instead of placing it somewhere wrong.

## Quick entry and shortcuts

Open Quick entry from the lightning-bolt desktop ribbon action or the Command Center header. On mobile, Obsidian places ribbon actions in its **Open** menu. The hub shows the active knowledge base and offers:

- switch knowledge base;
- create a portable **No note** subject;
- create an Index group, Collection heading, or Library heading;
- create a nested Index subject, or a Collection or Library subheading under any heading or subheading below the five-level cap;
- create a note that files into the Inbox by default, with a Destination row that can re-target the Index, a Collection, or a Library before creation;
- add the note that was active when Quick entry opened; and
- choose and add another existing Markdown note;
- append a categorized follow-up item to the current note; and
- choose another Markdown note and append a categorized follow-up item.

Placeholder and visual-structure changes are transactional, stay in plugin data, and participate in Undo. Creating a note remains the only ordinary Quick entry action that writes a Markdown file. The ENT preset continues to route topic creation through the unverified proposal workflow and does not expose manual protected-Library classification.

Creating or adding a note to a Library always asks for a heading or subheading first, and the picker shows each nested subheading with its full path, such as **Heading / Sub / Sub-sub**. If the Library is empty, Quick Entry asks you to create its first heading before the note form or file picker opens.

### Assign keyboard shortcuts

Open **Settings → Hotkeys**, search for `Quick entry`, and assign any preferred combination. No default hotkey is installed, which avoids conflicts with other plugins and user shortcuts.

Available focused commands are:

- Quick entry…
- Quick entry: Create subject without a note…
- Quick entry: Create heading…
- Quick entry: Create subheading…
- Quick entry: Create note…
- Quick entry: Add current note…
- Quick entry: Add existing note…
- Quick append: Add to current note…
- Quick append: Choose a note…
- Quick append: Undo last append

### Add a mobile toolbar button

On iPhone or iPad, open **Settings → Mobile → Manage toolbar options**, scroll to the bottom, choose **Add global command**, then search for and select **Quick entry…**. Any focused Quick Entry or Quick Append command can be selected instead. Each active Library also provides an **Open Library: _Library name_** command, which can be placed on the toolbar or assigned as Obsidian's Quick Action. Command icons are supplied for the mobile toolbar, but the plugin does not force a toolbar layout.

### Use Apple Shortcuts safely

Create an Apple Shortcut with **Open URLs** and use one exact action URL:

~~~text
obsidian://kbcc-quick-entry
obsidian://kbcc-create-subject
obsidian://kbcc-create-heading
obsidian://kbcc-create-subheading
obsidian://kbcc-create-note
obsidian://kbcc-add-current-note
obsidian://kbcc-add-existing-note
obsidian://kbcc-quick-append-current
obsidian://kbcc-quick-append-existing
obsidian://kbcc-attach-current
~~~

The first URL opens only the hub. The next six invoke the matching focused Quick Entry command: create a subject, heading, subheading, or note; classify the locally active note; or choose an existing note. The two Quick append URLs open a blank form for the locally active note or open the note picker first. The final URL opens Attach file only when the locally active Markdown note is eligible; otherwise it gives a generic notice without disclosing the note or protection reason.

All ten routes use the same guarded blank flows as their commands. They cannot prefill a title, path, content, category, clinical field, or file. Current-note routes resolve the note only from Obsidian's local active workspace and never accept a note path in the URL. Each protocol accepts only Obsidian's intrinsic action value. Any additional query key—including `title`, `path`, `content`, or an unknown key—fails closed before a hub, picker, or form opens.

## Quick append

Use Quick append when a topic note needs a short follow-up item without opening its full editor workflow. Choose a category and enter one item. The defaults are:

- **Questions** and **Lectures to watch** as checkboxes;
- **Sources** and **Thoughts** as bullets;
- **To read** as a checkbox; and
- **Other** as a bullet.

The first item creates one managed **Follow-up notes** block at the end of the note. A later item in the same category is appended below the existing category heading. Another category receives its own heading inside the same block. Open **Settings → Knowledge Base Command Center → Quick append → Categories** to rename, reorder, add, archive, or restore categories and to choose bullet/checkbox and optional-date behavior.

Quick append refuses locked notes, ambiguous managed markers, malformed frontmatter, oversized notes, and stale undo. Its five-minute undo stores only positions and integrity fingerprints in memory; it never stores the note body in plugin data. Ordinary attachments remain controlled by Obsidian.

## Portable placeholders

A portable Index or Library blueprint can describe a subject without exposing its original Markdown path. If no local note is linked after import, the subject appears as **No note**.

In a Generic base, a placeholder can:

- create an empty note;
- create from a local template;
- link an existing note; or
- remain unresolved.

While the linked Markdown note is present, **Change linked note** and **Unlink note** preserve the portable identity and organization. If that file later disappears locally, the subject becomes an unresolved placeholder but retains its prior path binding. It stays in the queue, a file that later arrives at the same path resolves it automatically, and you may deliberately link another eligible note instead. Choosing a note already owned by another portable subject requires explicit confirmation before identities are merged.

Open Smart queues → **Imported placeholders needing notes** or run **Open imported placeholder queue** for the complete active-base list. It separates Index, Library, and unplaced blueprint subjects. Candidate discovery scans every eligible Markdown note in the vault, including unindexed notes and notes outside the active base's storage or linked-folder rules, for an exact normalized title or configured-ID match. The count is unresolved subjects with at least one match, not the number of matching notes, and nothing is selected automatically. **Resolve next imported placeholder…** opens the next unresolved subject's existing guarded create/link actions.

Before a single-base portable import, **Predicted outcome** simulates the production import against an isolated copy. It shows incoming additions, existing identity matches, selected subjects still awaiting a note, the whole post-import placeholder count by placement, and how many unresolved placeholders have at least one exact eligible vault-wide candidate. Nothing is linked during preview. A predicted import that leaves 100 or more selected subjects unresolved requires an extra acknowledgement; after import, use **Open placeholder queue**, **Undo import**, or Close from the completion screen.

If **Workspace settings** are selected together with Index, any Library, Collections, or Study state and those settings would change a record-projection field, preview and Apply stop before mutation. Import Workspace settings alone, let Command Center refresh the vault, then reopen the center and import the subject-catalog sections. This rule applies to single-base and multi-base portfolio imports; the combined path remains available when the selected Workspace settings leave projection fields unchanged or the portfolio destination is a new empty base.

For a protected clinical topic, the ENT preset substitutes **Create unverified proposal** for direct canonical creation and routes it to the Inbox. Other protected clinical kinds offer Link or Keep only.

## Search

A non-empty query searches every available, non-archived knowledge base. Results from the active base appear first; remaining bases are ordered by workspace name. Each result set is then grouped by primary Index/Library section.

Activating a result from another base switches the active base. A note-backed result selects and opens the record. A placeholder opens its create/link actions.

### Text normalization

Search and fuzzy pickers are locale-invariant and Unicode-aware. Matching folds:

- compatibility forms and diacritics;
- straight and curly apostrophes and wrapper quotes;
- Arabic tatweel, alef wasla, and lam-alef presentation forms;
- common Arabic/Persian ya and kaf variants;
- <code>ة</code> and commonly typed <code>ه</code> for lookup; and
- Arabic/Persian digits to ASCII digits.

### Advanced filters

The available filters are:

- <code>domain:</code>
- <code>priority:</code>
- <code>kind:</code>
- <code>type:</code>
- <code>status:</code>
- <code>review:</code>
- <code>source:</code>
- <code>safety:</code>
- <code>dose:</code>
- <code>image:</code>

Unknown <code>word:</code> filters fail closed instead of becoming unexpectedly broad text searches.

Search reports the full match count but renders at most the strongest 300 rows. Browse views render at most 300 record rows and 300 structural sections at once, with **Show more** for the next page.

## Obsidian Bases view

This plugin also registers **Knowledge hierarchy** as a view for Obsidian `.base` files. This is a read-only presentation of the `.base` query result; it is separate from the independent plugin knowledge bases described elsewhere in this guide. Selecting it does not import a `.base`, change the active Command Center knowledge base, or write note properties.

Use the Bases view-options menu to configure:

- **Title** — defaults to <code>note.title</code>, then the filename;
- **ID** — defaults to <code>note.curriculum_id</code>;
- **Fallback group** — defaults to <code>note.domain</code>, then the immediate folder;
- **Status** — defaults to <code>note.review_status</code>;
- **Priority** — defaults to <code>note.priority</code>;
- **Rows per page** — 100 by default and always bounded between 25 and 300; and
- **Show group counts** — on by default.

The properties may point to supported note, file, or formula values. Native Bases filters, limits, user sorting, and **Group by** remain authoritative. The fallback group is used only when the `.base` view has no native Group by. The view keeps that user order, uses semantic group headings, prepares large fallback groups in short generation-safe slices, and replaces one bounded page at a time with **Previous** and **Next**. Narrow panes place status and priority on a second clipped line while keeping rows and pager buttons at least 44 pixels high. A data refresh or pop-out-window move cancels or transfers delayed work so a stale result cannot replace the current one.

## Record details

Selecting a record opens its inspector with identity, path/status information, note or study actions, and resolved related knowledge.

A wide Obsidian leaf keeps the Index and inspector side by side. Compact or narrow leaves—including desktop stacked tabs, side-by-side splits, pop-out windows, and phones—open the selected record as a focused detail route. **Back to main page** or Escape returns to the same compact row and list position. Expanding the leaf restores the two-column inspector without clearing the current selection or search.

## Saved views, snapshots, and history

A saved view retains the current section and literal search query. Queries can contain a path if one was typed, so review saved views before including them in a portable export.

Undo/Redo covers personal organization and guarded import changes. Required Undo operations first stage an exact causal snapshot in the bounded version-4 device-local pending-Undo journal. A multi-base portfolio import stages the newest required Undo for every affected destination as one bounded causal batch. A Global Note Organizer Apply is the other multi-base author and stages every affected base through that same mechanism. Pressing Undo or Redo separately stages the exact pre-transition history stacks and the inverse snapshot in a pending Undo/Redo transition journal. After a restart, a journal advances history only when the committed semantic revision, head, and payload fingerprint match; a multi-base batch resolves that proof independently for each affected base. Otherwise required Undo is discarded or the user-invoked transition retains its exact pre-transition stacks. If the complete protected operation cannot fit within the shared 4 MiB device-local limit, it is refused before its primary mutation. Named organization snapshots are base-local and restore plugin state, not Markdown note bodies.

For durable recovery, use a same-vault recovery export in addition to a complete vault backup. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md).

## Multi-base portfolio transfer

Choose **Multi-base portfolio transfer…** to export several available knowledge bases in one file. Each base remains an independent ordinary portable package inside the bundle; same-vault recovery, note bodies, attachments, and exact note paths cannot be included. The bundle is limited to 50 bases and 32 MB plus aggregate subject, structure, and reference budgets.

During import, enable the sources you want, map each one to a new base or one distinct existing base, choose Merge or Replace per existing destination, and select the exact components and Libraries. **Build exact preview** shows base, heading, subject, Library, conflict, unavailable folder/template fallback, and will-not-change categories. Apply commits this exact precomputed plan without rematching. If the store, destination, active-base state, or Sync generation changes, rebuild the preview.

Replace requires the displayed typed phrase. Before changing plugin data, the plugin saves a same-vault recovery package for every replacement destination; failure to write any recovery aborts all mutation. The plugin then stages every destination's required Undo snapshot together. If that exact batch cannot fit within the shared 4 MiB device-local history budget, the whole portfolio is rejected before the primary store write. Cross-vault Replace also requires its own acknowledgement. No portfolio operation moves, rewrites, or deletes Markdown notes or attachments.

## Sync and recovery center

Run **Open sync & recovery center** from the Command palette, or open **Manage index → Diagnostics → Sync & recovery center**. The modal remains available in compatibility or sticky read-only mode and reports a fixed, bounded set of local facts:

- the active knowledge-base name and Generic/ENT profile;
- its semantic revision, a shortened semantic-head fingerprint, and whether it matches the last committed local snapshot;
- the last successful local organization save and the last locally observed external <code>data.json</code> reload;
- the number and newest age of direct export-folder files matching the documented <code>knowledge-base-command-center-conflict-*.json</code> pattern;
- the newest recovery export confirmed by an export action on this device or by the documented standalone backup filename pattern;
- the path-safe reason for read-only protection and whether that protection is sticky until restart;
- device-local runtime, default/custom configuration-folder status, and active-base view-profile status; and
- a warning when existing semantic conflict metadata shows that the active base participated in a concurrent edit.

The artifact scan examines at most 2,000 direct children of the export folder and reads only paths and modification times. A capped count is labelled as a lower bound, and the age is labelled as the newest inspected rescue. The plugin does not open JSON packages to guess whether an arbitrary portable package contains recovery.

This is not a Sync-status surface. It makes no network request, calls no private Obsidian Sync API, and cannot tell whether a provider is online, queued, caught up, or safe for a device handoff. It never reads note bodies. Full paths, export filenames, custom configuration names, vault/base identifiers, and full semantic fingerprints are not shown.

Choose **Clear device-local data…** in this center, or run the command of the same name, when preparing to uninstall or intentionally resetting this device. A confirmation explains that it clears this plugin's App-local route, disclosure, Undo/Redo, local diagnostic facts, update-announcement history, any bounded pending rename-recovery journal, and note-bound return destinations. The rename journal may temporarily contain the vault identity and old/new vault-relative paths after an interrupted organization repair. The separate bounded return-navigation history can contain the vault identity, up to 24 opened-note paths, their originating base and tab, a selected-record path, literal search text entered in KBCC, compact-detail state, and scroll positions. KBCC does not read or copy note bodies into return history, but user-entered search text can itself be sensitive; neither local value syncs. The clear action removes all four plugin-owned App-local values; it does not write synced <code>data.json</code> or change Markdown, attachments, or recovery exports. Tracking remains suppressed until Obsidian restarts, so disable or uninstall in the same session; restart only when you want local tracking to resume.

## Settings

Generic-base settings deliberately separate three concepts:

- **Index membership** — direct-note behavior and explicit linked-folder rules that can make a note appear;
- **Note storage and creation** — Inbox, default creation folder, templates, and creation defaults that control location or content but never enroll a note by themselves; and
- **Portable blueprint and link progress** — imported subject identities, unresolved-link progress, and related blueprint behavior.

Other configurable settings include:

- Command Center name and subtitle;
- Index, item, group, and Inbox labels;
- ID, group, and parent metadata mappings;
- default starting content and template;
- optional per-Library folder, starting-content, and template profiles;
- explicit attachment storage and Markdown-link insertion policies;
- default section and recent-change limit;
- hover previews and note-opening behavior; and
- active knowledge-base and Library management.

The ENT preset also exposes safety-badge display and optional advanced canonical actions. Visual cross-domain movement is off by default and affects only plugin organization when enabled.

## Commands

- Open workspace
- Open Library: *Library name* (one dynamically maintained global command for every active Library)
- New knowledge base…
- Switch knowledge base…
- Manage knowledge bases…
- Manage libraries…
- Open sync & recovery center
- Open what’s new
- Open export / import center
- Open multi-base portfolio transfer
- Manage index…
- Organize vault notes across knowledge bases…
- Organize current note across knowledge bases…
- Show current note’s knowledge-base memberships
- Note organizer: Undo last multi-base change
- Note organizer: Redo last multi-base change
- Open imported placeholder queue
- Resolve next imported placeholder…
- Review legacy index source… (shown only while an upgraded Generic folder source still needs a choice)
- Open taxonomy health center
- Add or create…
- Create note from template or empty note…
- Attach file to current note…
- Add current note to a collection
- Quick entry…
- Quick entry: Create subject without a note…
- Quick entry: Create heading…
- Quick entry: Create subheading…
- Quick entry: Create note…
- Quick entry: Add current note…
- Quick entry: Add existing note…
- Quick append: Add to current note…
- Quick append: Choose a note…
- Quick append: Undo last append
- Undo / redo personal organization

The ENT preset adds proposal-promotion and advanced canonical-placement commands where applicable.

## Safety boundary

Ordinary Index, Library, Collection, queue, search, visual-arrangement, and Global Note Organizer actions do not edit source notes. The Organizer changes only reviewed KBCC memberships and placements; it does not create, move, rename, delete, or rewrite Markdown and does not create linked-folder rules. Explicit note creation is a separate workflow that writes one new file after confirmation.

The ENT preset has two separately disclosed exceptions: proposal promotion and advanced canonical placement can move a selected note and update its structural frontmatter and top-level heading. They refuse <code>ai_lock: true</code>, preview the destination, and attempt rollback on failure. Review the destination and back up the vault before using them.
