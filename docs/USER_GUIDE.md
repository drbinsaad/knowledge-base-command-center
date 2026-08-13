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

The Index starts with every Markdown note below the configured indexed folder. A Generic base can also include eligible notes from elsewhere through manual membership.

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

Use **Add → Add existing note to Index** in a Generic base to include an eligible note outside the automatic folder scope. Removing membership or hiding a record affects only the active knowledge base. The Markdown file remains in the vault and can be restored through Index Manager.

The ENT preset protects canonical source classification and folder scope. It still permits personal visual organization where the profile allows it.

## Index Manager

Open **Manage Index…** from the Command palette, Index header, or overflow menu.

| Tab | Purpose |
| --- | --- |
| **Indexed** | Search current members, assign a visual group in bulk where permitted, or remove active-base membership. |
| **Available** | Add eligible existing notes that are not currently in the Generic Index. |
| **Hidden** | Restore records removed from the active base, including protected ENT subjects. |
| **Groups** | Create, reorder, rename, merge, or remove visual groups safely. |
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

- Inbox records;
- a personal Next list;
- pinned records;
- ungrouped records; and
- recently changed records.

Queues are views over existing records and plugin state. They do not create duplicate notes.

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

Notes created through the primary action join the chosen destination — the Inbox by default, or the Index, a Collection, or a Library when selected — even when their folder is outside the automatically indexed folder and the profile permits manual membership. If a synced change removes the chosen Collection or Library while the form is open, the note is still created and the plugin explains that it was left unfiled instead of placing it somewhere wrong.

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

After linking, **Change linked note** and **Unlink note** preserve the portable identity and organization. Choosing a note already owned by another portable subject requires explicit confirmation before identities are merged.

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

Undo/Redo covers personal organization and guarded import changes. Named organization snapshots are base-local and restore plugin state, not Markdown note bodies.

For durable recovery, use a same-vault recovery export in addition to a complete vault backup. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md).

## Multi-base portfolio transfer

Choose **Multi-base portfolio transfer…** to export several available knowledge bases in one file. Each base remains an independent ordinary portable package inside the bundle; same-vault recovery, note bodies, attachments, and exact note paths cannot be included. The bundle is limited to 50 bases and 32 MB plus aggregate subject, structure, and reference budgets.

During import, enable the sources you want, map each one to a new base or one distinct existing base, choose Merge or Replace per existing destination, and select the exact components and Libraries. **Build exact preview** shows base, heading, subject, Library, conflict, unavailable folder/template fallback, and will-not-change categories. Apply commits this exact precomputed plan without rematching. If the store, destination, active-base state, or Sync generation changes, rebuild the preview.

Replace requires the displayed typed phrase. Before changing plugin data, the plugin saves a same-vault recovery package for every replacement destination; failure to write any recovery aborts all mutation. Cross-vault Replace also requires its own acknowledgement. No portfolio operation moves, rewrites, or deletes Markdown notes or attachments.

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

Choose **Clear device-local data…** in this center, or run the command of the same name, when preparing to uninstall or intentionally resetting this device. A confirmation explains that it clears only this plugin's App-local route, disclosure, Undo/Redo, local diagnostic facts, and update-announcement history. It does not write synced <code>data.json</code> or change Markdown, attachments, or recovery exports. Tracking remains suppressed until Obsidian restarts, so disable or uninstall in the same session; restart only when you want local tracking to resume.

## Settings

Configurable Generic-base settings include:

- Command Center name and subtitle;
- Index, item, group, and Inbox labels;
- indexed, Inbox, default note, and templates folders;
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

Ordinary Index, Library, Collection, queue, search, and visual-arrangement actions do not edit source notes. Explicit note creation writes a new file after confirmation.

The ENT preset has two separately disclosed exceptions: proposal promotion and advanced canonical placement can move a selected note and update its structural frontmatter and top-level heading. They refuse <code>ai_lock: true</code>, preview the destination, and attempt rollback on failure. Review the destination and back up the vault before using them.
