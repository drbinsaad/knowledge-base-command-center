# Getting started

Knowledge Base Command Center is an Obsidian plugin for building independent visual indexes over folder-based Markdown knowledge bases. This guide covers installation, first-run setup, note creation, device updates, and safe migration from earlier plugin versions.

## Requirements

- Obsidian 1.13.0 or newer.
- A vault with one or more folders of Markdown notes.
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
- the indexed folder, Inbox folder, default note folder, and templates folder;
- optional ID, group, and parent frontmatter property names; and
- whether new notes start empty or from a chosen default template.

Most choices can be changed later in **Settings → Community plugins → Knowledge Base Command Center**. Settings change the plugin view; they do not move existing notes.

### Choose a profile

**Generic knowledge base** is the default. Use it for research, projects, courses, reading, or another folder-based knowledge system. Its folder scope, labels, metadata mappings, and Libraries are configurable.

**ENT clinical preset** preserves the original protected study workflow. Its canonical indexed folder and source-derived clinical classifications are guarded so organization cannot silently rewrite clinical structure. It remains a study workflow, not a medical record or autonomous clinical decision-support system.

The profile is fixed after a knowledge base is created. Create or duplicate another base to use a different profile.

## Understand the structure

- A **knowledge base** is an independent Command Center profile with its own scope, Libraries, labels, collections, templates, queues, history, and settings.
- The **Knowledge Index** is its default primary section.
- A **Library** is another primary category inside that base, with headings and nested subheadings. One branch can hold up to five levels, counting the heading as level 1.
- A **Collection** is a reusable personal list that can contain records from the Index or any Library.

A single Markdown note can be organized in several knowledge bases. Within one knowledge base, a subject has one primary Index/Library classification but can belong to several Collections.

## Create or add notes

Use **Add → Create note** or **Create note from template or empty note…**. For each note, choose:

- the title;
- a vault-relative destination folder;
- empty content or a local Markdown template;
- the template to copy; and
- an optional Collection.

Templates can use <code>{{title}}</code>, <code>{{date}}</code>, and <code>{{time}}</code>. Other template text is copied unchanged. The plugin previews the destination, creates missing folders safely, and refuses to overwrite an existing file.

In a Generic base, **Add → Add existing note to Index** can include an eligible note from elsewhere in the vault without moving it. In a Library, Add actions can classify an existing note, the current note, or a newly created note in that Library.

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

When upgrading a synced vault on several devices:

1. Install the same current release line everywhere. For this release, every device that can edit the synced plugin data must run 0.12.x before organization work resumes.
2. Let the plugin file and <code>data.json</code> finish syncing before organizing, importing, or exporting recovery.
3. Confirm the same knowledge bases and counts on each device.
4. Export new recovery files after identity convergence.

Identical pristine upgrades can converge through Sync. If exactly one same-origin copy was edited before convergence, that edited copy wins because the other has no unique work. Two independently edited copies are not guessed together; the plugin preserves data and enters a protected read-only state.

An older device that encounters the version-15 store and schema-14 knowledge-base data preserves it read-only. It may describe the event as a migration failure because it cannot faithfully save the newer settings and causal Sync metadata. That is downgrade protection, not proof of corruption. Update every synced device before editing; do not keep working with an older build.

Recovery exported before first-upgrade identity convergence may carry the losing provisional identity and is intentionally rejected afterward. Export it again once Sync has settled.

## A newly enabled device with delayed Sync

If <code>data.json</code> has not arrived yet, the plugin creates only a provisional fresh-device identity and does not immediately write an authoritative empty store during startup. Harmless first-open view state cannot override an established synced store.

If meaningful organization or settings are changed before the established store arrives, the plugin writes a private <code>Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-*.json</code> rescue before adopting the established store. The rescue contains plugin organization and exact vault-relative paths, but no Markdown note bodies. Preserve it privately for recovery or support.

## Updating on iPhone and iPad

Let vault content and configuration Sync finish first. Avoid changing the same knowledge base on another device during the update.

- **Community Plugins:** use **Settings → Community plugins → Check for updates**, install the update, and reload if prompted.
- **BRAT:** run **BRAT: Check for updates to all beta plugins and UPDATE**, then reload.
- **Manual:** disable the plugin on mobile, replace all three release files on desktop, wait for the hidden <code>.obsidian</code> folder to sync, then re-enable it on mobile.

After updating, confirm the plugin is enabled before opening its workspace. For a first multi-device upgrade, follow the earlier Sync precautions.

An existing installation shows **What’s new in Knowledge Base Command Center 0.12.0** once on this device after the update. Its complete-release-notes action is a normal link to the exact 0.12.0 GitHub release and contacts GitHub only after you activate it; the plugin performs no background version check or network request. Fresh installs establish the local version marker without showing update news. Use **Open what’s new** in the Command Palette whenever you want to reopen the window.

Current physical-iPhone evidence is recorded separately in [0.10.0 iPhone evidence](release-evidence/0.10.0-iphone.md).

## Uninstall

Export current organization and back up the vault first. Run **Knowledge Base Command Center: Clear device-local data…** from the Command Palette (also available in **Sync & recovery center**) and confirm. Then disable and remove the plugin through Community Plugins, or remove its manual plugin folder.

Removing the plugin folder removes its <code>data.json</code>, including synced knowledge-base definitions, settings, Libraries, Collections, pins, visual hierarchy, and named snapshots. It does not by itself reliably remove device-only routes, collapsed sections, Undo/Redo history, local Sync/Recovery facts, or update-announcement history because Obsidian stores those App-local values outside the plugin folder. The clear command removes those two plugin-owned local values without changing <code>data.json</code>, Markdown notes, attachments, or recovery export files, and local tracking stays suppressed until Obsidian restarts. Disable or uninstall in that same session. If the plugin was already removed without clearing them, reinstall and enable the same or a newer release, run the command, then remove it again.

## Next

- Learn the main workflows in the [User guide](USER_GUIDE.md).
- Read [Portability and recovery](PORTABILITY_AND_RECOVERY.md) before exporting, importing, or restoring.
- Use [Troubleshooting](TROUBLESHOOTING.md) for missing records, mobile behavior, Sync, or compatibility mode.
