# Troubleshooting

Start with a complete vault backup and a current private recovery export for each knowledge base. When reporting a problem, use synthetic note names and remove vault paths, note content, credentials, patient information, copyrighted text, and <code>data.json</code>.

## Plugin does not appear

- Confirm Obsidian is 1.13.0 or newer.
- For a manual install, verify that <code>main.js</code>, <code>manifest.json</code>, and <code>styles.css</code> are directly inside <code>.obsidian/plugins/ent-vault-command-center/</code>.
- Confirm all three files came from the same release.
- Reload Obsidian and enable **Knowledge Base Command Center** under Community plugins.

## BRAT does not update

Run **BRAT: Check for updates to all beta plugins and UPDATE** and verify that the matching GitHub release contains all three required assets.

Before removing and re-adding the BRAT entry, export current organization and back up the vault.

## A note is missing from the Index

1. Confirm the intended knowledge base is active.
2. Review its configured indexed folder.
3. Open **Manage Index… → Hidden** and restore the record if present.
4. In a Generic base, check **Available** for an eligible note outside automatic scope.
5. Check whether the subject is primarily classified in a Library rather than the Index.
6. Run **Diagnostics** for stale or missing plugin references.

Restoring membership does not move or rewrite the Markdown file.

## A subject appears in the wrong Index or Library

Update every device to version 0.10.0 or newer and let Sync settle. Open the row's **…** menu and choose **Move to another section…**.

In a Library, use **Add → Add existing note** or its contextual classification action. Classification changes only the active knowledge base. It does not move the file or remove Collections, pins, or Next state.

Protected ENT records can move only to destinations compatible with their source-derived clinical kind.

## A portable subject says “No note”

This is a path-free placeholder, not necessarily a missing file.

- **Create empty note** creates a new local note where the profile permits.
- **Create from template** copies a local template.
- **Link existing note** resolves the portable identity to a chosen note.
- **Keep placeholder** preserves imported organization without creating a file.

If the subject was previously linked, check whether the note has not yet synced to this device. The plugin conservatively retains bindings for temporarily missing Markdown files.

## Edit a Library on iPhone or iPad

Use **… → Manage libraries** to edit the Library definition. Open that Library, choose **Arrange**, and use the heading, subheading, or record **…** menus.

Deleting a heading leaves its records under the explicit Unplaced section. It does not delete notes. Permanent deletion is available only after a custom Library is archived and requires choosing a destination for any remaining subjects.

## Visual movement on iPhone

Choose **Arrange**, tap the row's **…** button, then use Move under, Move to group, Indent, Outdent, Move up/down, or Make top-level. Desktop drag-and-drop is optional and is not expected on touch devices.

If controls clip or the software keyboard covers content, record the iPhone model, iOS version, Obsidian version, portrait/landscape orientation, Dynamic Type setting, and a sanitized screenshot. Check the current [physical-device evidence](release-evidence/0.10.0-iphone.md) before assuming the complete matrix passed.

## Broad search stops after 300 visible results

This is intentional. The interface reports the full count but retains at most the strongest 300 rows. Narrow the query or add an advanced filter to reach later matches.

Browse views also page record rows and structural sections in groups of 300. Use **Show more** to advance.

## Mobile JSON import

Place the JSON file anywhere inside the vault, then open **Export / import center… → Import** and select it through the in-vault picker.

The file must be 10 MB or smaller and pass bounded-list and aggregate-reference validation. Same-vault recovery starts unselected and needs a separate exact-path confirmation.

## Settings are read-only

The plugin detected unrecognized, damaged, or newer plugin data and intentionally refused to overwrite it.

1. Do not downgrade or repeatedly change settings.
2. Preserve the raw <code>data.json</code>.
3. Back up the complete vault.
4. Record the plugin and Obsidian versions plus the exact sanitized message.
5. Update every device to the same current plugin version.
6. Report the issue without attaching private plugin data publicly.

An older device can describe the version-14 store with schema-13 knowledge-base data as a migration failure. That is expected downgrade protection. Update every synced device to the same current 0.12.x release before editing again.

## Export/import center is in salvage mode

Import and same-vault recovery export are disabled because the running build cannot faithfully interpret the preserved <code>data.json</code>.

Other sections may be available as a one-time salvage export. Newly generated portable identities cannot be persisted in this mode and may differ on a later export. Preserve the raw file until compatibility is restored.

## First upgrade differs across devices

Install the same current 0.12.x build everywhere and stop organizing until Sync settles. Identical pristine upgrades can converge; two independently edited upgrades remain protected rather than being guessed together.

If a recovery was exported before identity convergence, export it again afterward. A file carrying a losing provisional identity is intentionally rejected.

See [Getting started: Upgrade from the old single-base format](GETTING_STARTED.md#upgrade-from-the-old-single-base-format).

## Same-base changes were lost after Sync

Current semantic metadata can identify divergent same-base edits that have no proven causal relationship. Before deterministic whole-base selection, the plugin attempts to preserve every possible losing complete envelope in a private conflict rescue. There is still no field-level merge, and a failed rescue forces protected read-only mode rather than guessing.

Open **Sync & recovery center** to review the locally recorded conflict warning and rescue count. This is historical evidence only: it does not inspect Sync or prove that another device has settled. Avoid editing the same base on several devices at once, let the provider finish before switching devices, and keep current private recovery exports. Changes to different knowledge bases can reconcile independently.

## A conflict-rescue JSON appeared

The plugin preserved meaningful organization before adopting another authoritative store or entering protected read-only mode.

The file is under <code>Knowledge Base Command Center Exports/</code> and can contain exact vault-relative paths and complete plugin organization, but not Markdown note bodies. Keep it private. Do not import it casually or attach it to a public issue.

Back up the vault and request support with sanitized version, timing, and Sync details.

## Import was rejected

Common intentional rejection reasons include:

- unsupported or newer portable format;
- file over 10 MB or bounded-list limits;
- malformed stable identities, titles, or hierarchy;
- wrong source vault, base, or preset for recovery;
- cross-preset recovery;
- recovery from a losing provisional identity;
- insufficient legacy unique-path matches; or
- inability to guarantee an Undo snapshot before mutation.

Do not edit IDs or identity fields by hand to bypass these checks. Use a current Portable set for deliberate cross-vault transfer and private recovery only in its intended source vault.

## Uninstall or reset

Before disabling the plugin, run **Knowledge Base Command Center: Clear device-local data…** from the Command Palette (or choose the same action in **Sync & recovery center**) and confirm. Then remove the plugin through Community Plugins or delete its manual plugin folder.

Removing the folder removes <code>data.json</code> and the synced settings and organization stored there. It does not reliably remove device-only routes, collapsed sections, Undo/Redo history, or local Sync/Recovery facts because Obsidian keeps those two plugin-owned App-local values outside the folder. The clear action removes only those local values; it does not change <code>data.json</code>, Markdown notes, attachments, or recovery exports. Local tracking stays suppressed until Obsidian restarts, so disable or uninstall in that same session. If the plugin was already removed without clearing them, reinstall and enable the same or a newer release, run the clear action, then remove it again.

Before uninstalling, export current private recovery for every available base, temporarily restore any archived base that needs recovery, and back up the complete vault including <code>.obsidian</code>.

## Ask for help

Read [Support](../SUPPORT.md), search existing issues, then use the sanitized Bug report form. Include:

- plugin version;
- Obsidian version and platform;
- installation method;
- active knowledge-base profile;
- affected section or workflow;
- reproducible steps in a scratch vault where practical; and
- sanitized console text.

For a vulnerability, follow [Security](../SECURITY.md) and do not post exploit details or private vault data in a public issue.
