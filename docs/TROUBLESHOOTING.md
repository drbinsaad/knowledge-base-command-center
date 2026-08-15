# Troubleshooting

Start with a complete vault backup and a current private recovery export for each knowledge base. When reporting a problem, use synthetic note names and remove vault paths, note content, credentials, patient information, copyrighted text, and <code>data.json</code>.

## Plugin does not appear

- Confirm Obsidian is 1.13.0 or newer.
- For a manual install, verify that <code>main.js</code>, <code>manifest.json</code>, and <code>styles.css</code> are directly inside <code>.obsidian/plugins/ent-vault-command-center/</code>.
- Confirm all three files came from the same release.
- Reload Obsidian and enable **Knowledge Base Command Center** under Community plugins.

## BRAT does not update

Run **BRAT: Check for updates to all beta plugins and UPDATE** and verify that the matching GitHub release contains all three required assets.

## The What’s New window did not appear

The window appears automatically once per device when an existing installation first opens a newer release that carries curated notes (every release since 0.12.0 does). It intentionally does not interrupt a fresh install, an incompatible/read-only startup, a downgrade, or a repeat reload. Run **Open what’s new** from the Command Palette to open the current release summary manually. Its GitHub link makes no request until you activate it.

Before removing and re-adding the BRAT entry, export current organization and back up the vault.

## A note is missing from the Index

1. Confirm the intended knowledge base is active.
2. If the record is visible elsewhere, choose **Why this appears**. Otherwise open **Manage Index… → Why included**. Confirm whether authority is direct membership, an exact linked folder, a protected source, or an imported placeholder; the displayed Markdown path is storage location only.
3. In a Generic base, confirm the note was explicitly added or is below a folder you explicitly linked. The default new-note folder is storage only.
4. Open **Manage Index… → Hidden** and restore the record if present. A hidden note stays excluded even while a linked-folder rule matches it.
5. Check **Available** for an eligible note that has no direct membership, then use **Add existing note to Index** for durable one-note membership. A note supplied only by a linked folder also appears here so you can preserve it directly before unlinking the folder.
6. Check whether the subject is primarily classified in a Library rather than the Index.
7. Run **Diagnostics** for stale or missing plugin references.

Adding, restoring, hiding, or unlinking membership does not move or rewrite the Markdown file. Generic organization lives in plugin data. A pre-v15 Generic base may show its former `primaryFolder` as a removable legacy linked-folder source so its pre-upgrade notes do not disappear.

## A note appears automatically after upgrading

If an ordinary note such as `README.md` appears in a Generic Index merely because it is stored below an old knowledge-base folder, check the warning at the top of the Command Center or in Settings. A pre-v15 upgrade temporarily preserves the old folder-authoritative behavior as a **legacy linked-folder source**; this is plugin membership, not an Obsidian file move and not an Obsidian `.base` rule.

Before changing it, open the note's **Why this appears** action or **Manage Index… → Why included**. If the explanation names the inherited linked folder, that rule—not the note's location by itself—is the active authority. A direct membership listed at the same time will survive unlinking; an exclusion can hide the note without touching the file.

Choose **Review…** or run **Review legacy index source…**. First let Obsidian Sync finish and verify that the linked folder's Markdown contents are complete on this device, then check the confirmation in the review. Apply remains blocked if a non-root source folder is unavailable, and an empty local list does not prove another synced device has no notes. Select only the notes that should remain durable direct members, then choose **Apply review & unlink**. Unselected notes leave the plugin Index, future notes placed in that folder no longer join automatically, and every Markdown file remains where it is unchanged. The conversion and unlink are saved together as one Undo action. Choose **Keep linked** only when you intentionally want that folder's current and future Markdown descendants to join automatically; **Not now** leaves the source and warning unchanged.

## A subject appears in the wrong Index or Library

Update every device to version 0.10.0 or newer and let Sync settle. Open the row's **…** menu and choose **Move to another section…**.

In a Library, use **Add → Add existing note** or its contextual classification action. Classification changes only the active knowledge base. It does not move the file or remove Collections, pins, or Next state.

Protected ENT records can move only to destinations compatible with their source-derived clinical kind.

## The Organizer shows a README or every note in a folder

The **Notes** step is a vault browser, so it can show eligible existing Markdown files that are not organized anywhere. Merely appearing in this picker does not add a note to an Index, Library, or Collection. The active-note indicator says **KBCC: Not organized** for an ordinary unorganized note; this neutral state is not an error.

Selecting a folder deliberately selects a one-time snapshot of all its current eligible Markdown descendants, which can include `README.md`. Before **Choose destinations**, clear the folder selection, remove the individual README from **Selected notes**, or use **Skip this note** under per-note behavior. The snapshot never creates a linked-folder rule, so a Markdown file created in that folder later will not be included automatically.

If the README already appears in an Index without a reviewed Organizer Apply, use **Why this appears** or **Manage Index… → Why included**. A direct membership, an explicit or inherited legacy linked-folder source, a protected ENT source, or a portable identity—not the Organizer's vault browser—is providing that membership. Follow [A note appears automatically after upgrading](#a-note-appears-automatically-after-upgrading) when the authority is an inherited legacy linked folder.

## Note Organizer Apply says the review is stale

Apply rechecks the exact selected file identities and modification facts, every target KBCC knowledge base and destination, and the locally observed Sync generation. A note rename, deletion, replacement, or edit; a changed heading, Library, Collection, or base; or newly observed synced plugin data can invalidate the prepared review. This is intentional: no subset is applied.

Let Sync finish, confirm the selected notes still exist, choose **Refresh review**, and inspect the new before/after rows. If an ENT destination is rejected, use a source-eligible Index group or a Library compatible with the note's protected clinical kind. Restricted clinical, template, configuration, or immutable source paths cannot be forced through the Organizer.

## Dragging a note onto Organize does nothing

Organizer drop support is a progressive enhancement. It accepts only bounded text path payloads from compatible Obsidian drag sources; operating-system file objects, absolute paths, unsafe URLs, missing or restricted notes, and non-Markdown files are refused. Platforms, themes, and other plugins can expose a different drag payload.

Use the dependable fallback: select or right-click the note, multi-selection, or folder in Obsidian's File Explorer and choose **Organize in KBCC…**, or choose **Organize** and select notes in the vault tree. Dropping never imports an external file and never moves a vault file.

## The active-note indicator is red

Red is reserved for broken persisted organization, such as a duplicate or missing portable identity, unavailable Library, conflicting primary placements, or simultaneous direct-and-hidden Index state. It never means merely “not in the current Index.” Activate the indicator or run **Show current note’s knowledge-base memberships** and read the issue under each affected knowledge base before changing anything.

The indicator also uses an icon, accessible label, tooltip, and optional count, so color is not the only status signal. A normal unorganized note is neutral/muted; organization only in another base uses the accent state; current-base primary or Collections-only organization uses the success state.

## Multi-base Organizer Undo disappeared after restart

**Note organizer: Undo last multi-base change** and **Note organizer: Redo last multi-base change** coordinate the newest exact Organizer batch only during the plugin session that applied it. They also fail closed after a conflicting newer organization change, because the affected bases no longer have the expected newest Undo state.

Every affected knowledge base still received a durable per-base Undo entry. After restart, switch to each changed base and use **Undo personal organization change** separately. Undo changes plugin data only; no Markdown file operation needs to be reversed because the Organizer did not perform one.

## A portable subject says “No note”

There are two intentional cases: an imported subject can be path-free because it has never been linked on this device, or a previously linked Markdown file can be temporarily missing. In the second case, the plugin retains the prior path binding and keeps the subject in the placeholder queue. Let Sync finish; if a file returns at that same path, the binding resolves automatically. You can also deliberately link another eligible note. Do not treat the placeholder as proof that the file was deleted on every device.

- **Create empty note** creates a new local note where the profile permits.
- **Create from template** copies a local template.
- **Link existing note** resolves the portable identity to a chosen note.
- **Keep placeholder** preserves imported organization without creating a file.

For several unresolved subjects, open Smart queues → **Imported placeholders needing notes** or run **Open imported placeholder queue**. Candidate discovery checks every eligible Markdown note in the vault, including unindexed notes and notes outside the active base's folder rules, for an exact normalized title or configured-ID match. Its total is the number of unresolved subjects with at least one candidate, not the number of matching notes. Candidates are suggestions for review only: the plugin does not auto-link one; choose the subject, inspect any existing portable owner, and explicitly create or link. **Resolve next imported placeholder…** starts with the next item.

## Index row text, status, or actions overlap

Update to 0.17.0 or newer. The desktop and compact row grids now reserve separate areas for title/metadata, membership badges, and the action button; a placeholder has one **No note** status instead of competing duplicate labels. If overlap remains, record the Obsidian leaf width, zoom/text scaling, theme and snippets, left-to-right or right-to-left direction, and a sanitized screenshot. Temporarily disable snippets and switch to the default theme to distinguish a plugin regression from an overriding style.

## Edit a Library on iPhone or iPad

Use **… → Manage libraries** to edit the Library definition. Open that Library, choose **Arrange**, and use the heading, subheading, or record **…** menus. **Add subheading** appears on any heading or subheading below the five-level depth cap.

Deleting a heading leaves its records under the explicit Unplaced section. It does not delete notes. Removing a nested subheading instead moves its records and child subheadings up under its parent. Permanent deletion is available only after a custom Library is archived and requires choosing a destination for any remaining subjects.

## Visual movement on iPhone

Choose **Arrange**, tap the row's **…** button, then use Move under, Move to group, Indent, Outdent, Move up/down, or Make top-level. Desktop drag-and-drop is optional and is not expected on touch devices.

To move a subheading itself rather than a record, tap that subheading's **…** button and use **Move under…** or **Outdent one level**. The move takes the subheading's records and everything nested inside it. If a destination you expect is missing, it is either inside the subheading you are moving or it would push the branch past the five-level limit; the plugin says so rather than showing an empty list.

If controls clip or the software keyboard covers content, record the iPhone model, iOS version, Obsidian version, portrait/landscape orientation, Dynamic Type setting, and a sanitized screenshot. The [0.18.0 physical-device record](release-evidence/0.18.0-iphone.md) is waived and unverified; its supplemental Mac emulation is not a physical-iPhone Pass, so do not assume the complete matrix passed.

## Broad search stops after 300 visible results

This is intentional. The interface reports the full count but retains at most the strongest 300 rows. Narrow the query or add an advanced filter to reach later matches.

Browse views also page record rows and structural sections in groups of 300. Use **Show more** to advance.

## Mobile JSON import

Place the JSON file anywhere inside the vault, then open **Export / import center… → Import** and select it through the in-vault picker.

The file must be 10 MB or smaller and pass bounded-list and aggregate-reference validation. Same-vault recovery starts unselected and needs a separate exact-path confirmation.

For a portable import, review **Predicted outcome** before applying. It reports additions, existing identity matches, incoming subjects still awaiting notes, the whole resulting placeholder queue, and how many unresolved placeholders have at least one exact eligible vault-wide candidate; it never links a candidate. If 100 or more selected incoming subjects are predicted to remain unresolved, check the additional large-import acknowledgement. After a successful import, choose **Open placeholder queue**, **Undo import**, or Close on the completion screen.

If Workspace settings are selected with Index, a Library, Collections, or Study state, and those settings would change fields used to project records, the plugin deliberately rejects the combined operation. Import **Workspace settings** alone first, let Command Center refresh the vault, then reopen the import center and apply the subject-catalog sections. The same guard applies in multi-base portfolio review. No two-step import is required when those projection fields are unchanged or the portfolio destination is a new empty base.

## Nested subheadings do not appear on another device

Update the plugin on that device. Nested Collection and Library subheadings need the current release everywhere; an older build cannot faithfully interpret the newer synced store, so it preserves the data read-only instead of guessing. After updating, let Sync settle and reopen the Command Center. See [Settings are read-only](#settings-are-read-only).

## Settings are read-only

The plugin detected unrecognized, damaged, or newer plugin data and intentionally refused to overwrite it.

1. Do not downgrade or repeatedly change settings.
2. Preserve the raw <code>data.json</code>.
3. Back up the complete vault.
4. Record the plugin and Obsidian versions plus the exact sanitized message.
5. Update every device to the same current plugin version.
6. Report the issue without attaching private plugin data publicly.

An older device can describe the version-15 store with schema-15 knowledge-base data as a migration failure. That is expected downgrade protection. Update every synced device to the same current release before editing again.

## Export/import center is in salvage mode

Import and same-vault recovery export are disabled because the running build cannot faithfully interpret the preserved <code>data.json</code>.

Other sections may be available as a one-time salvage export. Newly generated portable identities cannot be persisted in this mode and may differ on a later export. Preserve the raw file until compatibility is restored.

## First upgrade differs across devices

Install the same current release everywhere and stop organizing until Sync settles. Identical pristine upgrades can converge; two independently edited upgrades remain protected rather than being guessed together.

If a recovery was exported before identity convergence, export it again afterward. A file carrying a losing provisional identity is intentionally rejected.

See [Getting started: Upgrade and Sync compatibility](GETTING_STARTED.md#upgrade-and-sync-compatibility).

## Same-base changes were lost after Sync

Current semantic metadata can identify divergent same-base edits that have no proven causal relationship. Before deterministic whole-base selection, the plugin attempts to preserve every possible losing complete envelope in a private conflict rescue. There is still no field-level merge, and a failed rescue forces protected read-only mode rather than guessing.

Open **Sync & recovery center** to review the locally recorded conflict warning and rescue count. This is historical evidence only: it does not inspect Sync or prove that another device has settled. Avoid editing the same base on several devices at once, let the provider finish before switching devices, and keep current private recovery exports. Changes to different knowledge bases can reconcile independently.

## A conflict-rescue JSON appeared

The plugin preserved meaningful organization before adopting another authoritative store or entering protected read-only mode.

The file is under the configured Exports folder (<code>Knowledge Base Command Center Exports/</code> by default; Settings → Exports folder) and can contain exact vault-relative paths and complete plugin organization, but not Markdown note bodies. Keep it private. Do not import it casually or attach it to a public issue.

Back up the vault and request support with sanitized version, timing, and Sync details.

## A save says the automatic backup could not be refreshed

Read the notice carefully because it distinguishes the commit boundary:

- **The primary store was not written** means the prerequisite <code>data.json.bak</code> refresh or its Sync fence failed. The plugin attempted no primary or compensating write. Fix storage access, let Sync settle, then retry the original operation.
- **The primary store was saved** means the organization edit committed, but the best-effort post-commit backup advance failed. Do not repeat the edit. The backup may be one commit behind; fix storage access before the next change and export a fresh private recovery.

In both cases, a failed in-memory candidate is never backup authority. Do not replace a readable primary file with <code>data.json.bak</code> while the plugin is running.

## Import was rejected

Common intentional rejection reasons include:

- unsupported or newer portable format;
- file over 10 MB or bounded-list limits;
- malformed stable identities, titles, or hierarchy;
- wrong source vault, base, or preset for recovery;
- cross-preset recovery;
- recovery from a losing provisional identity;
- insufficient legacy unique-path matches;
- a combined Workspace-settings and subject-catalog import whose Workspace fields would change record projection; or
- inability to guarantee an Undo snapshot before mutation.

Do not edit IDs or identity fields by hand to bypass these checks. Use a current Portable set for deliberate cross-vault transfer and private recovery only in its intended source vault.

## Uninstall or reset

Before disabling the plugin, run **Knowledge Base Command Center: Clear device-local data…** from the Command Palette (or choose the same action in **Sync & recovery center**) and confirm. Then remove the plugin through Community Plugins or delete its manual plugin folder.

Removing the folder removes <code>data.json</code> and the synced settings and organization stored there. It does not reliably remove device-only routes, collapsed sections, Undo/Redo history, local Sync/Recovery facts, or update-announcement history because Obsidian keeps those App-local values outside the folder. A third, bounded rename-recovery journal may temporarily contain the vault identity and old/new vault-relative paths until an interrupted organization repair is durably completed. The clear action removes all three plugin-owned App-local values; it does not change <code>data.json</code>, Markdown notes, attachments, or recovery exports. Local tracking stays suppressed until Obsidian restarts, so disable or uninstall in that same session. If the plugin was already removed without clearing them, reinstall and enable the same or a newer release, run the clear action, then remove it again.

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
