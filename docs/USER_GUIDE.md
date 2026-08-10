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
| **Diagnostics** | Inspect missing references, duplicate membership, broken visual parents, and orphaned group state, then apply safe plugin-state repair. |

Index Manager changes plugin state only. It does not move, delete, or rewrite Markdown notes.

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

Deleting a heading does not delete its records or notes. The records remain Unplaced until deliberately moved. Desktop supports drag-and-drop; touch devices use labelled heading, subheading, and row menus.

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

## Collections

Collections are personal reusable lists across the Index and Libraries. A record can belong to several Collection headings or subheadings without duplication or file movement.

Use a record's menu or inspector to add it to a Collection. In Arrange mode, Collection headings and subheadings can be created, renamed, reordered, or removed. Removing Collection membership does not change the record's primary Index/Library classification.

## Smart queues

Depending on the profile and current organization, smart queues can surface:

- Inbox records;
- a personal Next list;
- pinned records;
- ungrouped records; and
- recently changed records.

Queues are views over existing records and plugin state. They do not create duplicate notes.

## Create notes

Use **Add → Create note** or **Create note from template or empty note…**. The form supports:

- a title;
- a vault-relative destination;
- empty content or a chosen local template;
- an optional default template; and
- optional Collection membership.

Templates may use <code>{{title}}</code>, <code>{{date}}</code>, and <code>{{time}}</code>. Other template syntax is copied unchanged. The path preview shows the destination before creation. Missing destination folders are created safely, and existing files are never overwritten.

Notes created through the primary action join the active Index or Library as requested, even when their destination is outside the automatically indexed folder and the profile permits manual membership.

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

## Record details

Selecting a record opens its inspector with identity, path/status information, note or study actions, and resolved related knowledge.

Desktop keeps the Index and inspector side by side. On a narrow phone screen, selecting a row opens a focused detail route. **Back to main page** or Escape returns to the same compact row and list position.

## Saved views, snapshots, and history

A saved view retains the current section and literal search query. Queries can contain a path if one was typed, so review saved views before including them in a portable export.

Undo/Redo covers personal organization and guarded import changes. Named organization snapshots are base-local and restore plugin state, not Markdown note bodies.

For durable recovery, use a same-vault recovery export in addition to a complete vault backup. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md).

## Settings

Configurable Generic-base settings include:

- Command Center name and subtitle;
- Index, item, group, and Inbox labels;
- indexed, Inbox, default note, and templates folders;
- ID, group, and parent metadata mappings;
- default starting content and template;
- default section and recent-change limit;
- hover previews and note-opening behavior; and
- active knowledge-base and Library management.

The ENT preset also exposes safety-badge display and optional advanced canonical actions. Visual cross-domain movement is off by default and affects only plugin organization when enabled.

## Commands

- Open workspace
- New knowledge base…
- Switch knowledge base…
- Manage knowledge bases…
- Manage libraries…
- Open export / import center
- Manage index…
- Add or create…
- Create note from template or empty note…
- Add current note to a collection
- Undo / redo personal organization

The ENT preset adds proposal-promotion and advanced canonical-placement commands where applicable.

## Safety boundary

Ordinary Index, Library, Collection, queue, search, and visual-arrangement actions do not edit source notes. Explicit note creation writes a new file after confirmation.

The ENT preset has two separately disclosed exceptions: proposal promotion and advanced canonical placement can move a selected note and update its structural frontmatter and top-level heading. They refuse <code>ai_lock: true</code>, preview the destination, and attempt rollback on failure. Review the destination and back up the vault before using them.
