# Knowledge Base Command Center

A configurable Obsidian workspace for visually indexing, arranging, finding, and creating Markdown notes. It works with any folder-based knowledge base and includes an optional ENT clinical preset.

The internal plugin ID remains `ent-vault-command-center` so existing installations keep their settings, collections, pins, and visual hierarchy after upgrading.

## What it provides

- A searchable index of every Markdown note below a folder you choose.
- Manual index membership for eligible notes anywhere else in the vault.
- Configurable workspace, index, item, group, and Inbox names.
- Configurable frontmatter properties for ID, group, and parent relationships.
- Visual parent/child nesting, ordering, and cross-group movement without moving or rewriting notes.
- A dedicated Index Manager for bulk membership, visual group organization, and integrity diagnostics.
- Personal collections with headings, subheadings, multi-membership, drag-and-drop, and touch-friendly menu controls.
- Smart queues for Inbox notes, a personal Next list, pins, ungrouped notes, and recent changes.
- Empty-note creation or per-note template selection with a safe destination preview; notes created through the primary Create action are indexed even when saved elsewhere.
- Organization undo/redo, named snapshots, and same-vault JSON recovery.
- A component-aware Export / import center for portable workspace settings, a path-free index blueprint, collections, study state, and saved views.
- Desktop, iPhone, and iPad support; no desktop-only APIs are used.

Knowledge Base Command Center 0.7.3 and later requires Obsidian 1.13.0 or newer so its settings are searchable through Obsidian's current declarative settings interface.

## First-run setup

The setup wizard opens the first time the command center is shown. Configure:

- command center name and description;
- index, item, group, and Inbox labels;
- indexed folder, Inbox folder, default note folder, and templates folder;
- optional ID, group, and parent frontmatter property names; and
- whether new notes start empty or from a chosen default template.

All values can be changed later in **Settings → Community plugins → Knowledge Base Command Center**. Folder, property, and default-template settings include searchable pickers. Configuration changes affect only the plugin view. Existing notes are not moved.

## Creating notes

Use **Add → Create note** or the command **Create note from template or empty note…**. For every note you can choose:

- its title;
- any vault-relative destination folder;
- an empty note or a Markdown template;
- the template to copy; and
- whether to add it to a collection after creation.

The plugin never overwrites an existing file. Missing destination folders are created safely. Templates may use `{{title}}`, `{{date}}`, and `{{time}}`; all other text and template syntax is copied unchanged.

## Visual index and collections

The main index starts from your configured parent property and subfolder groups. Use **Add → Add existing note to Index** to include a note from elsewhere in the vault. Hidden notes can be restored through the same picker.

Press **Arrange** to create a separate visual hierarchy. Drag on desktop, or use each row’s **…** menu on touch devices, to move between groups, create a new group, move under, indent, outdent, reorder, make top-level, or reset placement. **Hide from index** and **Remove from index** affect only plugin membership; they never delete the Markdown file.

Visual arrangement is stored in plugin data. It never changes a note path or frontmatter. A note can also belong to multiple personal collection headings or subheadings without being duplicated or moved.

On a narrow phone screen, index subjects remain compact single-line rows with 44-point controls. Selecting a record opens a focused detail view with its title and **Back to main page** control kept visible. The detail content scrolls independently above Obsidian's mobile navigation; **Back to main page** or Escape returns to the same compact row and list position. Desktop keeps the side-by-side index and inspector.

### Index Manager

Open **Manage Index…** from the command palette, the index header, or the command center menu. It provides:

- **Indexed**: search and select indexed notes, assign a visual group in bulk, or remove generic manual memberships.
- **Available**: add eligible existing notes to the generic index without moving their files.
- **Hidden**: restore notes hidden from the generic index.
- **Groups**: create, reorder, rename, merge, or remove empty visual groups.
- **Diagnostics**: inspect missing references, duplicate memberships, broken visual parents, and orphaned group state, then apply a safe plugin-state repair.

The manager never moves, deletes, or rewrites Markdown notes. Membership, visual groups, and hierarchy are stored in plugin data.

## Generic and ENT profiles

**Generic knowledge base** is the default for new installations. It exposes the index, Inbox, collections, and generic queues.

**ENT clinical preset** preserves the original protected workflow for Dr. Ali’s study vault: canonical curriculum topics, Topic Inbox promotion, clinical queues, procedure/medication/syndrome libraries, safety indicators, source-aware review fields, and optional advanced canonical actions. Existing data from versions 0.1–0.4 migrates automatically to this preset and remains unverified unless a human explicitly reviews it.

ENT visual groups follow canonical domains by default. An optional **Visual cross-domain movement** setting enables personal visual grouping and group reordering while continuing to protect note folders, IDs, domains, and clinical frontmatter.

## Export, import, and portable index blueprints

Open **Export / import center…** from the command palette, the Index Manager, or the command center menu. Choose any combination of the following sections:

| Section | What it contains |
| --- | --- |
| **Workspace settings** | Workspace names and labels, configured folders and template location, metadata mappings, behavior, and visual group order. |
| **Index blueprint** | Stable subject identities, titles, groups, nested parent relationships, record kinds, and visual order. The blueprint contains no source note paths. |
| **Collections** | Collection and subheading structure with membership stored by portable subject identity, not source note path. |
| **Study state** | Pins and the personal Next list stored by portable subject identity. |
| **Saved views** | Named command center sections and literal search queries; a query can contain a path if you typed one. |
| **Same-vault recovery** | A restoration snapshot of local plugin organization, including exact vault-relative note paths. |

The default **Portable set** selects workspace settings, index blueprint, collections, study state, and saved views. **Everything** also selects same-vault recovery. Because recovery exposes exact vault-relative paths, the Export button stays disabled until you separately confirm that private recovery export. Selecting Collections or Study state automatically selects the index catalog they need. Every export summary shows what will be included before the JSON is created. Markdown note bodies and attachments are never included in any section. The complete Portable set is not necessarily path-free: workspace settings contain the folder and template paths you configured, and saved-query text is exported literally. Deselect either section when you do not want to share it.

The index blueprint itself is path-free. It can recreate subject names, groups, nesting, and order in another vault without disclosing the original Markdown filenames or folders. Only a valid, canonical-format ENT curriculum ID from the fixed clinical mapping is retained; generic or customized ID-property values are omitted because they may contain a path or private identifier. Import never creates notes automatically. A subject with no linked Markdown file appears as a **No note** placeholder in its imported position. In a generic workspace, choose **Create empty note**, **Create from template**, **Link existing note**, or **Keep placeholder**. For a clinical topic, the ENT preset substitutes the safety-gated **Create unverified proposal** action for direct topic creation and then opens that linked proposal in the Inbox. Other clinical record kinds offer Link or Keep only. Creating or linking a note preserves the imported hierarchy and personal organization. A linked subject can later **Change linked note** or **Unlink note** back to a placeholder; choosing a note already owned by another portable subject requires confirmation before the two portable identities are merged.

Before importing, choose which available sections to apply and select one behavior:

- **Merge with this vault** adds or updates the selected organization while retaining unrelated local organization.
- **Replace selected sections** resets only the selected plugin sections. Notes absent from a replacement index may be hidden from that index, but the operation never deletes, moves, overwrites, or rewrites Markdown notes.

Same-vault recovery starts unselected when a file is opened. It must be selected and confirmed explicitly, is restored by itself, and is never described or executed as a merge. Undo restores the pre-recovery plugin state.

Workspace folder paths are validated against the destination vault. If an exported default template is unavailable, restricted, or outside the configured templates folder, the imported default safely falls back to an empty note. Older standalone workspace exports and organization backups remain importable through the same center.

On iPhone and iPad, Export saves JSON under `Knowledge Base Command Center Exports/` inside the vault so it can sync or be shared through the Files app. Import uses an in-vault JSON picker, displays the selected vault path during review and confirmation, and applies the same 10 MB, per-list, and aggregate-reference limits as desktop. Export also enforces 10 MB and validates the exact JSON before saving it, so the plugin never creates a portable package that it will refuse to re-import. Desktop uses the operating system download and file picker.

> [!warning] Same-vault recovery privacy
> Same-vault recovery is not a path-free portable blueprint. It contains exact vault-relative note paths, including folder and file names, for collections, pins, queues, and visual organization. Treat that JSON as private, do not share it publicly, and import it only into the vault it came from.

## Search

Plain text uses Unicode-aware fuzzy matching across titles, aliases, paths, configured IDs, and groups, including diacritic folding. Advanced filters are: `domain:`, `priority:`, `kind:`, `type:`, `status:`, `review:`, `source:`, `safety:`, `dose:`, and `image:`. Saved views retain the current section and query.

## Commands

- Open workspace
- Open export / import center
- Manage index…
- Add or create…
- Create note from template or empty note…
- Add current note to a collection
- Undo / redo personal organization

The ENT profile additionally exposes proposal promotion and advanced canonical placement commands where applicable.

## Install

### Community Plugins

The plugin is being submitted to the Obsidian Community Plugins directory. After it is listed, search for **Knowledge Base Command Center** under **Settings → Community plugins → Browse**.

Community Plugin updates are delivered through Obsidian after approval. Obsidian keeps the stable internal ID `ent-vault-command-center`, so upgrading preserves the same plugin data file.

### BRAT

Until Community approval, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable BRAT from Community Plugins.
2. Open **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/drbinsaad/knowledge-base-command-center`.
4. Choose **Latest version** when prompted.

You can also open the [direct BRAT install link](obsidian://brat?plugin=https://github.com/drbinsaad/knowledge-base-command-center). BRAT reads the matching GitHub release assets and can install future tagged releases through **BRAT: Check for updates to all beta plugins and UPDATE**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/drbinsaad/knowledge-base-command-center/releases).
2. Create `<your-vault>/.obsidian/plugins/ent-vault-command-center/`.
3. Copy those three files into that folder.
4. Reload Obsidian, then enable **Knowledge Base Command Center** under **Settings → Community plugins**.

For iPhone or iPad, install and enable the plugin in a desktop-synced vault first, ensure the `.obsidian/plugins/ent-vault-command-center/` folder syncs to the device, then enable it in the mobile vault.

For manual updates, download all three files from the same newer release and replace the existing copies while Obsidian is closed or the plugin is disabled. Do not mix asset versions.

### Uninstall

Before uninstalling, open **Export / import center…** and export **Same-vault recovery** if you may want the personal hierarchy later. Store that private JSON securely. Disable the plugin, then remove it through Community Plugins (or remove `.obsidian/plugins/ent-vault-command-center/` for a manual install). Removing the plugin folder also removes `data.json`, including settings, collections, pins, visual hierarchy, snapshots, and undo history. Markdown notes are not removed.

### Troubleshooting

- **The plugin does not appear:** confirm `main.js`, `manifest.json`, and `styles.css` are directly inside `.obsidian/plugins/ent-vault-command-center/`, then reload Obsidian.
- **BRAT does not update:** run BRAT's update command and confirm the GitHub release contains all three matching assets. Remove and re-add the beta plugin only after exporting organization data.
- **A note is missing from the index:** check the indexed folder, hidden notes in **Manage index…**, and any manual membership. Diagnostics reports stale references without deleting note files.
- **Visual movement on iPhone:** enable **Arrange**, tap the row's **…** button, and choose Move under, Move to group, Indent, Outdent, Move up/down, or Make top-level. Desktop drag-and-drop is optional.
- **Mobile JSON import:** copy the JSON file anywhere inside the vault, open **Export / import center…**, then choose it from the in-vault picker.
- **Settings are read-only:** the plugin detected unrecognized or newer `data.json` content and intentionally refused to overwrite it. Preserve the file and report the version and error message without attaching private note content.
- **Transfer center is in salvage mode:** Import and same-vault Recovery export are disabled because the current build cannot faithfully interpret the preserved `data.json`. Other sections can be exported as a one-time salvage; newly generated index identities cannot be persisted and may differ on a later export. Keep the raw `data.json` until compatibility is restored.

### Development installation

```bash
npm ci
npm run check
```

The production release assets are `main.js`, `manifest.json`, and `styles.css`.

### Build a local installable release

```bash
npm ci
npm run release:bundle
```

This creates a three-file install ZIP and SHA-256 checksum under `dist/`. The release task runs unit tests, performs a production build, then verifies release metadata, mobile compatibility, exact archive contents, and absence of local absolute workspace paths. It never includes `data.json` or note content.

## Data safety

- Index and collection actions never move or rewrite source notes.
- Hiding or removing an index membership never deletes the underlying Markdown note.
- Visual hierarchy and personal organization live in `data.json`.
- No export option contains Markdown note bodies or attachments.
- Portable index, collection, and study components use stable subject identities instead of source note paths.
- Workspace settings can contain configured vault-relative folder and template locations.
- Same-vault recovery contains exact vault-relative note paths and should be treated as private restoration data.
- Merge and replace imports change only selected plugin-owned state; neither operation deletes, moves, or rewrites Markdown notes.
- Plugin data from a newer schema opens read-only to prevent downgrade data loss.
- The ENT preset respects `ai_lock: true` and never assigns clinical review approval.

## Privacy and permissions

- The plugin has no analytics, telemetry, advertising, accounts, payments, or network requests.
- It enumerates Markdown file paths and reads Markdown metadata inside the current vault to build the index, offer existing-note and template pickers, and repair missing plugin references.
- Copy buttons write only the plugin-generated command, wikilink, or vault-relative path shown by that action to the clipboard after you click; the plugin never reads clipboard contents.
- It stores settings and personal organization in Obsidian's plugin data file.
- It writes only when you explicitly create a note, organize plugin state, promote an ENT proposal, or edit canonical placement through the protected advanced workflow.
- It never reads or writes files outside the vault on its own. On desktop, JSON export and import use your operating system's own download and file-picker dialogs, so those files go exactly where you choose. On iPhone and iPad, exported JSON stays inside the vault unless you explicitly share it.

## Contributing and license

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Knowledge Base Command Center is released under the [MIT License](LICENSE).
