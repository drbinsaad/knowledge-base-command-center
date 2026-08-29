# Getting started

Knowledge Base Command Center is an Obsidian plugin for building independent visual indexes over Markdown notes without making their storage folders authoritative. This guide covers installation, first-run setup, note creation, device updates, and safe migration from earlier plugin versions.

## Requirements

- Obsidian 1.13.0 or newer.
- A vault with one or more Markdown notes.
- A complete vault backup before importing recovery data or upgrading the old single-base format across several synced devices.

The visible product name is **Knowledge Base Command Center**. Its stable plugin ID remains <code>ent-vault-command-center</code> so existing installations retain the same plugin folder and <code>data.json</code>.

## Install

### Community Plugins

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **Knowledge Base Command Center**.
3. Choose **Install**, then **Enable**.
4. Open the Command Center from the desktop ribbon or Command palette. On mobile, use Obsidian's **Open** menu.

The current Community listing is at [community.obsidian.md/plugins/ent-vault-command-center](https://community.obsidian.md/plugins/ent-vault-command-center).

### BRAT

For beta or release-candidate testing:

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter <code>https://github.com/drbinsaad/knowledge-base-command-center</code>.
4. Choose **Latest version**.

The [direct BRAT install link](obsidian://brat?plugin=https://github.com/drbinsaad/knowledge-base-command-center) opens Obsidian when the protocol is available.

### Manual installation

1. Download <code>main.js</code>, <code>manifest.json</code>, and <code>styles.css</code> from one matching [GitHub release](https://github.com/drbinsaad/knowledge-base-command-center/releases).
2. Create <code>&lt;your-vault&gt;/.obsidian/plugins/ent-vault-command-center/</code>.
3. Place the three files directly in that folder.
4. Reload Obsidian and enable the plugin under Community plugins.

Do not mix assets from different releases.

## First-run setup

The setup wizard asks for:

- the Command Center name and description;
- Index, item, group, and Inbox labels;
- the Inbox folder, default new-note storage folder, templates folder, and export folder;
- optional ID, group, and parent frontmatter property names; and
- whether new notes start empty or from a chosen default template.

Most choices can be changed later in **Settings → Community plugins → Knowledge Base Command Center**. Settings change the plugin view; they do not move existing notes.

The settings page keeps **Index membership**, **Note storage and creation**, and **Portable blueprint and link progress** in separate groups. A linked folder is membership authority; an Inbox, default creation, template, attachment, export, or Library creation folder is a location/workflow choice only.

### Choose a profile

**Generic knowledge base** is the default. Use it for research, projects, courses, reading, or another Markdown knowledge system. Its direct note memberships, optional linked-folder rules, labels, metadata mappings, and Libraries are configurable. The default new-note folder controls only where creation starts; it never adds existing or future notes to the Index.

**ENT clinical preset** preserves the original protected study workflow. Its canonical indexed folder and source-derived clinical classifications are guarded so organization cannot silently rewrite clinical structure. It remains a study workflow, not a medical record or autonomous clinical decision-support system.

The profile is fixed after a knowledge base is created. Create or duplicate another base to use a different profile.

## Understand the structure

- A **knowledge base** is an independent Command Center profile with its own scope, Libraries, labels, collections, templates, queues, history, and settings.
- The **Knowledge Index** is its default primary section.
- A **Library** is another primary category inside that base, with headings and nested subheadings. One branch can hold up to five levels, counting the heading as level 1.
- A **Collection** is a reusable personal list that can contain records from the Index or any Library.

A single Markdown note can be organized in several knowledge bases. Within one knowledge base, a subject has one primary Index/Library classification but can belong to several Collections.

Generic Index membership has two explicit sources:

- **Direct membership:** **Add existing note to Index**, **Add current note**, or an explicit Index creation flow records the exact note in plugin data. Moving that note to another eligible vault folder does not cancel the membership.
- **Linked-folder membership:** a folder contributes eligible descendants only after it is deliberately linked. Unlinking it removes the rule, not the files; direct memberships remain direct.

The Inbox, default new-note, template, export, attachment, and per-Library creation folders do not become Index sources. If a note inside the Inbox is also added directly or matched by an explicit linked-folder rule, that explicit Index choice wins over its storage location unless you deliberately classify the note in a Library. Generic organization changes plugin data only and never edits note bodies, frontmatter, filenames, or folder locations. Creating a new note is a separate explicit file-writing action.

When a note's presence is surprising, open its row or inspector and choose **Why this appears**. The explanation lists every active membership authority and then shows the Markdown path separately as storage location. For a whole-base audit, open **Manage Index… → Why included** to compare direct memberships, linked folders, protected sources, imported placeholders, exclusions, and location-only folders before changing a rule.

## Create or add notes

Use **Add → Create note** or **Create note from template or empty note…**. For each note, choose:

- the title;
- a vault-relative destination folder;
- empty content or a local Markdown template;
- the template to copy; and
- an optional Collection.

Templates can use <code>{{title}}</code>, <code>{{date}}</code>, and <code>{{time}}</code>. Other template text is copied unchanged. The plugin previews the destination, creates missing folders safely, and refuses to overwrite an existing file.

In a Generic base, **Add → Add existing note to Index** records durable direct membership without moving or rewriting the note, regardless of its folder. In a Library, Add actions can classify an existing note, the current note, or a newly created note in that Library; classification is likewise plugin-owned organization.

Creating a note in the default new-note folder does not enroll it in the Index unless the creation flow explicitly targets the Index or another selected organization destination. Storage and membership are separate choices.

An imported path-free subject can remain as **No note** until you create or link a note deliberately. Open Smart queues → **Imported placeholders needing notes**, run **Open imported placeholder queue**, or run **Resolve next imported placeholder…**. Exact normalized title and configured-ID candidates are review hints only; the plugin never chooses or links one automatically.

## Organize existing notes in bulk

Choose **Organize** in the Command Center or run **Organize vault notes across knowledge bases…**. In this workflow, **Base** means a KBCC knowledge base, not an Obsidian `.base` file.

1. In **Notes**, select one or many existing Markdown notes. Selecting a folder takes a one-time snapshot of its current eligible Markdown descendants. It does not link that folder, and notes created there later do not join automatically.
2. In **Destinations**, choose one or more KBCC knowledge bases. Shared choices can keep, set, or clear the primary Index/Library placement and keep, add, or replace Collection memberships. Use **Skip this note** or **Custom destinations** for a per-note exception.
3. In **Review**, inspect the exact before/after primary and Collection state. The zero-impact line confirms that no Markdown file or linked-folder rule will change, then **Apply organization** commits the reviewed plugin-data transaction.

A note has at most one primary Index or Library placement inside each knowledge base and can also belong to several Collections. Knowledge bases not selected as destinations are untouched, so their existing memberships stay in place. Selecting the same note for several bases organizes it independently in each one.

You can start the same review from the editor or File Explorer context menu for a single note, an Obsidian multi-selection, or a folder snapshot. On compatible desktop drags, dropping safe existing-note path text on **Organize** preselects those notes. Drop support is optional; if a theme, platform, or drag source does not provide a safe text path, use the context menu or the Organizer's vault tree.

The active Markdown editor also shows an accessible organization indicator. Activate it to see that note's primary placement, Collections, provenance, and issues across every KBCC knowledge base. The icon, accessible label, tooltip, and count carry the meaning; green means organized in the current base, the accent state means organized only elsewhere, muted means ordinarily unorganized, and red is reserved for broken persisted organization.

Apply rechecks the selected file identities, KBCC destinations, and Sync generation. If a note or destination changed after review, Apply aborts without a partial result; refresh the review and inspect it again. Every affected knowledge base gets its normal durable per-base Undo entry. During the same plugin session, run **Note organizer: Undo last multi-base change** or **Note organizer: Redo last multi-base change** to reverse the latest Organizer batch across all affected bases together.

The Organizer bulk-organizes existing notes only. It does not bulk-create Markdown files. Use the Create note flow separately for each file you want to create. In the ENT clinical preset, destination eligibility, protected Library source kinds, and canonical Index grouping remain enforced; incompatible placements are rejected before Apply.

## Set up Quick entry

Quick entry opens one focused hub for the active knowledge base. It can switch bases, create a No note subject, create Index/Collection/Library headings or subheadings, create an empty or template-based note, and add the current or an existing note.

- **Desktop ribbon:** choose the lightning-bolt **Open quick entry** action. On mobile, Obsidian places ribbon actions in the **Open** menu.
- **Inside the Command Center:** choose **Quick entry** in the header.
- **Keyboard:** open **Settings → Hotkeys**, search for `Quick entry`, and assign only the combinations you want. The plugin installs no default hotkeys.
- **iPhone or iPad toolbar:** open **Settings → Mobile → Manage toolbar options**, scroll to the bottom, choose **Add global command**, then search for and select **Quick entry…**, a focused Quick Entry or Quick Append command, or an **Open Library: _Library name_** command. An Open Library command can also be assigned as Obsidian's Quick Action.
- **Apple Shortcuts:** use **Open URLs** with one exact action-only URL:
  - `obsidian://kbcc-quick-entry` — hub;
  - `obsidian://kbcc-create-subject` — No note subject;
  - `obsidian://kbcc-create-heading` — heading;
  - `obsidian://kbcc-create-subheading` — subheading;
  - `obsidian://kbcc-create-note` — blank Create note flow;
  - `obsidian://kbcc-add-current-note` — classify the locally active note;
  - `obsidian://kbcc-add-existing-note` — choose a local note;
  - `obsidian://kbcc-quick-append-current` — append to the locally active note;
  - `obsidian://kbcc-quick-append-existing` — choose a note for Quick append; or
  - `obsidian://kbcc-attach-current` — attach a file to the locally active eligible Markdown note.

When a Library is the destination, Quick Entry asks for its heading or subheading before continuing, showing each nested subheading with its full path, such as **Heading / Sub / Sub-sub**. If that Library has no headings yet, it asks you to create the first heading and then continues with the selected action.

Every URL is action-only. Do not add query fields. A URL with `?title=`, `?path=`, `?content=`, or any other parameter is rejected and does not open a hub, picker, or form. Current-note actions get the active note only from Obsidian's local workspace, and every flow still requires local, visible user input before it changes anything.

## Add another knowledge base

Use the switcher beside **Knowledge operations**, the Command Center menu, or:

- **New knowledge base…**
- **Switch knowledge base…**
- **Manage knowledge bases…**

Each base has independent Index membership, Libraries, labels, visual arrangement, Collections, Inbox, templates, pins, queues, snapshots, and Undo history. The active base is plugin-wide, so every open Command Center view switches together.

A base can be renamed, duplicated, archived, and restored. At least one available base must remain. The installation retains at most 50 available and archived bases.

Permanent deletion is available only for an archived base and requires typed confirmation. It removes that base's plugin-owned organization, never its Markdown notes. Before deletion, restore the base, switch to it, export a private same-vault recovery, then archive it again.

## Upgrade and Sync compatibility

Version 0.10 and later wrap earlier single-base organization into one knowledge base without intentionally resetting it. The first upgraded copy receives a random full vault identity plus a non-secret fingerprint of its legacy organization.

When a Generic base stored in pre-v15 plugin data is upgraded, its former `primaryFolder` temporarily becomes one deterministic **legacy linked-folder source**. This prevents notes from disappearing during upgrade. A persistent warning and the **Review legacy index source…** command list the real notes currently available on this device and supplied only by that source. Before unlinking, let Obsidian Sync finish and confirm in the review that the folder's Markdown contents are complete; Apply is blocked when a non-root source folder is unavailable, and zero local notes is not treated as proof that other synced devices are empty. Keep selected notes as durable direct members and unlink the folder in one Undo-protected action, intentionally **Keep linked**, or choose **Not now**. Until you resolve the warning, current and future Markdown below that legacy source can still enter automatically. No review choice deletes, moves, renames, or rewrites Markdown.

When upgrading a synced vault on several devices:

1. Install the same current release line everywhere. Every device that can edit the synced plugin data must run the same release as the newest device before organization work resumes.
2. With Obsidian Sync, open **Settings → Sync → Vault configuration sync** separately on every device and enable **Active community plugin list** and **Installed community plugin list**. Obsidian documents these as opt-in, device-specific settings; see [Sync settings and selective syncing](https://help.obsidian.md/sync/settings). If the device uses an override configuration profile such as <code>.obsidian-mobile</code>, enable them for that active profile.
3. Let the plugin files and <code>data.json</code> finish syncing, wait for Obsidian's green Sync check, then reload or restart Obsidian before organizing, importing, or exporting recovery. Community-plugin configuration typically requires a reload.
4. Confirm the same knowledge bases, counts, and linked-note states on each device.
5. Export new recovery files after identity convergence.

KBCC stores Markdown bindings as paths relative to the vault root. Different absolute locations such as <code>/Users/alice/Vault</code> and <code>/Users/bob/Vault</code> are expected and do not break a link when both devices opened the same vault root. The synced organization itself lives in the active configuration profile under <code>plugins/ent-vault-command-center/data.json</code>; syncing only the Markdown notes is not enough.

Identical pristine upgrades can converge through Sync. If exactly one same-origin copy was edited before convergence, that edited copy wins because the other has no unique work. Two independently edited copies are not guessed together; the plugin preserves data and enters a protected read-only state.

An older device that encounters the version-15 store and schema-15 knowledge-base data preserves it read-only. It may describe the event as a migration failure because it cannot faithfully save the newer settings, membership provenance, and causal Sync metadata. That is downgrade protection, not proof of corruption. Update every synced device before editing; do not keep working with an older build.

Recovery exported before first-upgrade identity convergence may carry the losing provisional identity and is intentionally rejected afterward. Export it again once Sync has settled.

## A newly enabled device with delayed Sync

If <code>data.json</code> has not arrived yet, the plugin creates only a provisional fresh-device identity and does not immediately write an authoritative empty store during startup. Harmless first-open view state cannot override an established synced store.

If meaningful organization or settings are changed before the established store arrives, the plugin writes a private <code>knowledge-base-command-center-conflict-*.json</code> rescue into the configured Exports folder (<code>Knowledge Base Command Center Exports/</code> by default) before adopting the established store. The rescue contains plugin organization and exact vault-relative paths, but no Markdown note bodies. Preserve it privately for recovery or support.

## Updating on iPhone and iPad

Let vault content and configuration Sync finish first. Avoid changing the same knowledge base on another device during the update.

- **Community Plugins:** use **Settings → Community plugins → Check for updates**, install the update, and reload if prompted.
- **BRAT:** run **BRAT: Check for updates to all beta plugins and UPDATE**, then reload.
- **Manual:** disable the plugin on mobile, replace all three release files on desktop, wait for the hidden <code>.obsidian</code> folder to sync, then re-enable it on mobile.

After updating, confirm the plugin is enabled before opening its workspace. For a first multi-device upgrade, follow the earlier Sync precautions.

An existing installation shows **What’s new in Knowledge Base Command Center _version_** once on this device after the update, where _version_ is the newly installed release. Its complete-release-notes action is a normal link to that exact GitHub release and contacts GitHub only after you activate it; the plugin performs no background version check or network request. Fresh installs establish the local version marker without showing update news. Use **Open what’s new** in the Command Palette whenever you want to reopen the window.

The sanitized [0.10.0 iPhone evidence](release-evidence/0.10.0-iphone.md) remains the latest completed physical-device record. The [0.17.0](release-evidence/0.17.0-iphone.md), [0.18.0](release-evidence/0.18.0-iphone.md), and [0.19.0](release-evidence/0.19.0-iphone.md) evidence records and the [current manual checklist](manual-iphone-release-checklist.md) record their physical-iPhone matrices as maintainer-waived and unverified, not Passed. The 0.19.0 record identifies supplemental Mac Obsidian mobile-emulation coverage separately and does not treat it as iPhone evidence.

## Uninstall

Export current organization and back up the vault first. Run **Knowledge Base Command Center: Clear device-local data…** from the Command Palette (also available in **Sync & recovery center**) and confirm. Then disable and remove the plugin through Community Plugins, or remove its manual plugin folder.

Removing the plugin folder removes its <code>data.json</code>, including synced knowledge-base definitions, settings, Libraries, Collections, pins, visual hierarchy, and named snapshots. It does not by itself reliably remove device-only routes, collapsed sections, Undo/Redo history, local Sync/Recovery facts, or update-announcement history because Obsidian stores those App-local values outside the plugin folder. A third, bounded rename-recovery journal may temporarily contain the vault identity and old/new vault-relative paths until an interrupted organization repair is durably completed. A fourth, bounded return-navigation history can contain the vault identity, up to 24 opened-note paths, their originating base and tab, a selected-record path, literal search text entered in KBCC, compact-detail state, and scroll positions. KBCC does not read or copy note bodies into this history, but user-entered search text can itself be sensitive; the history is not synced. The clear command removes all four plugin-owned App-local values without changing <code>data.json</code>, Markdown notes, attachments, or recovery export files, and local tracking stays suppressed until Obsidian restarts. Disable or uninstall in that same session. If the plugin was already removed without clearing them, reinstall and enable the same or a newer release, run the command, then remove it again.

## Next

- Learn the main workflows in the [User guide](USER_GUIDE.md).
- Read [Portability and recovery](PORTABILITY_AND_RECOVERY.md) before exporting, importing, or restoring.
- Use [Troubleshooting](TROUBLESHOOTING.md) for missing records, mobile behavior, Sync, or compatibility mode.
