# Portability and recovery

Knowledge Base Command Center separates portable organization from private same-vault restoration. Read this guide before sharing an export, replacing organization, or restoring recovery data.

## Choose the right artifact

| Artifact | Intended use | Path exposure |
| --- | --- | --- |
| **Portable set** | Move selected workspace organization to another vault or knowledge base. | Index and Libraries are path-free. Workspace settings can contain configured vault-relative folders; saved queries are literal. |
| **Multi-base portfolio** | Move selected components from as many as 50 available knowledge bases in one bounded bundle, with an independent ordinary portable package for each base. | The same portable boundaries apply independently to every package; private recovery is forbidden. |
| **Same-vault recovery** | Restore one knowledge base in the vault that created it. | Contains exact vault-relative note paths and private plugin organization. |
| **Complete vault backup** | Recover Markdown notes, attachments, Obsidian configuration, and plugin data. | Contains the vault's actual files and should be protected accordingly. |

No plugin export contains Markdown note bodies or attachments.

## Export components

Open **Export / import center…** from the Command palette, Index Manager, or Command Center menu for a single-base package. Open **Multi-base portfolio transfer…** from the Command palette or Command Center menu for a portfolio.

The single-base center operates on the active knowledge base. A portfolio can include several available bases without switching between them. Archived bases must still be restored temporarily before either kind of export.

| Component | Contents |
| --- | --- |
| **Workspace settings** | Labels, compatible configured folders, base and per-Library creation profiles, template locations, metadata mappings, behavior, and visual group order. The destination base name and preset do not change. |
| **Index blueprint** | Stable subject identities, titles, groups, nested parent relationships, record kinds, collapse state, and visual order. It contains no source note paths. |
| **Each selected Library** | Stable Library identity, configured labels/icon, subject names, editable headings and nested subheadings, unplaced state, visual order, and portable identities. Doses, note bodies, source paths, and attachments are excluded. |
| **Collections** | Collection heading and nested subheading structure with membership stored by portable subject identity. |
| **Study state** | Pins and the personal Next list stored by portable subject identity. |
| **Saved views** | Named sections and literal search queries. A query can contain a path if it was typed. |
| **Same-vault recovery** | Private restoration data for the active base, including exact vault-relative note paths. |

The default **Portable set** selects workspace settings, the Index blueprint, every active Library, Collections, study state, and saved views. Each Library can be deselected independently, including an empty Library whose identity and hierarchy must be preserved.

Archived Libraries are not offered as portable sections. Confirmed private recovery preserves their definitions and state.

Collections and study state carry only the portable identities they reference. They do not silently select or replace a complete Index or complete Library.

**All + private recovery** adds same-vault recovery. Selecting it does not make that recovery portable. The Export button remains disabled until the separate private-path confirmation is accepted, and the summary names every selected Library before JSON is created.

The complete Portable set is not necessarily path-free. Deselect Workspace settings when configured vault-relative folders should not be shared, and deselect Saved views when literal queries may disclose a private term or path.

## Multi-base portfolio transfer

A portfolio is a small manifest plus one independent, current portable-format package for each selected source base. Each embedded package is created, serialized, and parsed by the same strict portable-package implementation used by the single-base center. The manifest does not introduce another organization schema, and an importer rejects a package whose declared components, preset, byte count, or aggregate counts do not match its parsed contents.

Export chooses available knowledge bases and a component set. Libraries means the complete active Library set in each chosen base, including empty Libraries, empty headings, nested subheadings, placeholders, and intentionally unplaced subjects. Archived Libraries stay excluded. Note bodies, attachments, exact note bindings, and same-vault recovery are never allowed in a portfolio.

Import maps each selected source to either a new compatible knowledge base or one distinct existing compatible destination. A new base is initialized with Merge. For an existing destination, choose Merge or Replace independently and then narrow the source's components or individual Libraries if needed. Two sources cannot target the same destination in one plan.

**Build exact preview** computes the sole immutable mutation plan. The apply action commits that already-computed post-state; it does not rerun matching or rebuild the import. The preview reports these categories, including explicit zero-count sections:

- knowledge bases to add or replace;
- headings to add, rename, or remove;
- subjects to add, move, or leave unplaced;
- Libraries to add or archive;
- identity and naming conflicts;
- unavailable template or folder fallbacks; and
- what will not change.

Large categories initially show 50 entries and expand in bounded 50-entry pages. A stale destination base, active-base selection, complete store snapshot, or externally synced generation invalidates the plan before mutation. The selected portfolio remains unchanged.

Every Replace destination requires the displayed typed phrase. Before any plugin-data mutation, the plugin writes a separate strict same-vault recovery package for every destination that will be replaced. If one recovery write fails, no plan operation is applied. The final multi-base store change uses the existing atomic persistence and rollback path and each destination also receives an in-plugin Undo snapshot when its bounded size permits. A plan that cannot retain the required Undo snapshot is rejected.

Cross-vault Merge and new-base initialization retain the normal portable behavior. Cross-vault Replace has an additional acknowledgement because it can remove selected destination organization even though it never changes Markdown files.

## What “path-free” means

The Index blueprint and Libraries can recreate:

- stable subject and Library identities;
- subject names;
- Index nesting;
- Library headings and nested subheadings;
- intentionally unplaced records;
- group labels, collapse state, and visual order; and
- selected Collection and study references.

They do not carry the original Markdown filenames or folder paths.

Only a valid canonical-format ENT curriculum ID from the preset's fixed clinical mapping is retained. Generic or customized ID-property values are omitted because they may contain a path or private identifier.

Import never creates notes automatically. A subject without a destination note appears as **No note**:

- Generic bases can create an empty note, create from a local template, link an existing note, or keep the placeholder.
- Protected ENT topics offer **Create unverified proposal** and route it to the Inbox.
- Other protected clinical kinds offer Link or Keep only.

Creating or linking preserves the portable identity and its Index/Library placement. A resolved subject can later change its linked note or return to a placeholder. Linking a note already owned by another portable subject requires confirmation before identities merge.

## Portable format compatibility

The current release writes portable format version 5. It adds nested Collection and Library subheadings—up to five levels in one branch, counting the top heading as level 1—to version 4's arbitrary stable Library definitions and selective Library IDs.

The current release continues to read versions 1–4, so older flat packages still import. Legacy Procedures, Medications, and Syndromes catalogs migrate to reserved stable Library IDs. Non-topic identities in version 1 files are treated conservatively as Collection or study dependencies rather than authoritative complete Libraries. Imported content nested deeper than five levels keeps its records by merging them into the nearest allowed level.

Older plugin builds reject version 5 rather than guessing destructively, and an older build that encounters a synced version-15 store with version-14 knowledge-base data preserves it read-only instead of rewriting it. Update every importing and syncing device before applying a new export.

## Review an import

After choosing a JSON file, select only the available sections to apply and choose one behavior:

- **Merge with this vault** adds or updates selected organization while retaining unrelated local organization.
- **Replace selected sections** resets only the selected plugin sections. Notes absent from a replacement Index may be hidden from that Index, but no Markdown note is deleted, moved, overwritten, or rewritten.

When source and destination use different Generic/ENT presets, Workspace settings is automatically excluded. Path-free Index, Library, Collection, and study components can still transfer without changing the destination's name or preset.

Workspace folders and Library-profile paths are validated against the destination vault. A portable workspace includes dependency descriptors for every Library referenced by a creation profile, even when that Library's subject catalog was not selected. An existing local archive decision remains authoritative. Legacy standalone workspace-configuration files cannot declare custom Library dependencies, so import retains only profiles whose stable Library IDs already exist in the destination and reports how many unmatched profiles were omitted. If an imported base or Library template is unavailable, restricted, or outside the configured templates folder, that creation default safely falls back to an empty note inside the same Undo-protected import; an invalid destination folder still blocks the import. The selected JSON package is not modified.

Workspace settings can disclose Library-specific vault-relative folder and template paths. Deselect **Workspace settings** before sharing when those paths are private. Profiles contain no note bodies or attachments and never cause import to create or rewrite a Markdown note.

Older standalone workspace exports and organization backups remain readable through the same center, subject to their legacy identity checks.

## Desktop and mobile files

Desktop uses the operating system download and file picker.

The plugin itself does not read or write outside the vault. On desktop, the operating-system surfaces place files only where the user chooses.

On iPhone and iPad, Export writes JSON into the configured Exports folder inside the vault (<code>Knowledge Base Command Center Exports/</code> by default; Settings → Exports folder) so it can sync or be shared through Files. Import uses an in-vault JSON picker and displays the selected vault path during review.

Single-base import and export enforce a 10 MB ceiling plus per-list and aggregate-reference limits. A portfolio is limited to 50 bases and 32 MB total, and also enforces strict aggregate subject, structure, and reference budgets across its already-bounded packages. Export validates the exact serialized JSON before saving, so the plugin does not intentionally create a package its own importer refuses to read.

## Same-vault recovery

Same-vault recovery starts unselected when an import file is opened. It must be selected and confirmed separately, is restored by itself, and is never described or executed as a merge with portable sections.

Current version-10 recovery files embed:

- source vault identity;
- source knowledge-base ID and name;
- Generic/ENT preset identity;
- dynamic Library definitions and layouts, including nested subheadings;
- exact local note bindings and paths; and
- the base's plugin-owned organization.

Before an Undo snapshot or mutation starts, the plugin verifies that the source vault and knowledge-base identity match the destination.

### Recovery versions

- **Version 10:** current format with nested Collection and Library subheading layouts, dynamic Library definitions, and source vault/base/preset locks.
- **Version 9:** dynamic Library definitions and layouts plus the same identity locks, but its subheadings stay a single level deep.
- **Version 8:** same identity locks and fixed clinical Library layouts, but predates arbitrary Library definitions.
- **Version 7:** predates nested Library-layout recovery but carries current-style vault/base/preset identity.
- **Versions 1–6:** do not carry a trusted knowledge-base identity or preset and require a separate **base/preset unverified** override.
- **Versions 1–5:** also lack a trusted vault identity and undergo a conservative unique-path preflight.

A current recovery from a different vault or preset is hard-rejected. Restoring into a different base in the same vault is blocked by default. A distinct override must name both source and destination, followed by the normal destructive-restore confirmation, and it is available only when both bases have the same Generic or ENT preset.

For identity-less versions 1–5, at least half of unique referenced paths must exist in the current vault, rounded up. For example, 1 of 722 paths is rejected; 361 of 722 reaches the threshold. Passing is only a compatibility preflight, not proof of origin. A legacy file with no path references can be explicitly confirmed and remains labelled unverified.

Recovery exported from a provisional identity that later lost first-upgrade convergence is intentionally rejected. Export a new recovery after every device has converged.

## Backup and restore

### Back up

1. Let Obsidian Sync or the other sync service finish. Stop editing the same knowledge base elsewhere.
2. Back up the complete vault, including its hidden <code>.obsidian</code> configuration.
3. For an additional raw copy, close Obsidian or disable the plugin before copying <code>.obsidian/plugins/ent-vault-command-center/data.json</code>.
4. Switch to each available knowledge base and open **Export / import center → Export**.
5. Select **Same-vault recovery** or **All + private recovery**, review the counts and exact-path warning, then export.
6. Restore each archived base temporarily and export its own recovery before archiving it again.
7. Store the vault backup, raw <code>data.json</code>, and recovery files securely. Do not publish them.

One base's recovery does not contain sibling or archived bases.

### Restore

1. Work in the original vault and update the plugin on every device. Use a Portable set, not recovery, for intentional cross-vault transfer.
2. Back up the current vault and export a fresh recovery for the destination base.
3. Switch to the exact base that created the recovery.
4. Open **Export / import center → Import** and choose the JSON file. On mobile, place it anywhere inside the vault first.
5. Select **Same-vault recovery** only.
6. Verify the displayed source vault, base, and preset, then complete the destructive-restore confirmation.
7. Choose **Restore private recovery**.
8. Verify the base name, headings, subject count, Libraries, Collections, pins, queues, and saved views.
9. If the result is wrong, use Undo before further organization, then restore the backup from step 2 if needed.

Do not use a different-base or legacy-identity override unless the displayed uncertainty is intentional and understood. Cross-preset recovery is always rejected.

## Sync model and conflict handling

Different knowledge bases can merge independently through Obsidian Sync. Current stores carry a per-base semantic revision, head, payload fingerprint, and bounded causal lineage. When two different semantic payloads have no proven ancestor relationship, the plugin treats them as concurrent edits, writes every possible losing complete envelope to private conflict rescue, and only then selects a deterministic whole-base winner. It still does not field-merge simultaneous edits.

Run **Open sync & recovery center** for local evidence about the active base, last successful local save, last external plugin-data reload, conflict rescues, recovery age, and any recorded active-base conflict. The center does not inspect Obsidian Sync, a provider queue, the network, or another device. An absent warning is not proof that it is safe to switch devices. Avoid editing the same base on two devices at once, let your provider settle using its supported surface, and keep current recovery exports.

Conflict-rescue counts use only direct export-folder file metadata and the documented <code>knowledge-base-command-center-conflict-*.json</code> name pattern. The bounded scan never opens the JSON. Recovery age comes from a confirmed recovery export on this device or the standalone backup name pattern; the center does not open an arbitrary portable package to infer its selected components.

When a newly enabled device starts before <code>data.json</code> arrives, it does not immediately publish an authoritative empty store. Meaningful local work is written to a private conflict-rescue JSON before an established synced store is adopted.

An unmergeable vault-identity conflict preserves the trusted local store in the private conflict-rescue folder before entering read-only mode whenever the vault is writable. Rescue JSON contains complete plugin organization and exact vault-relative paths, but no Markdown note bodies. Keep it private.

Permanent-deletion tombstones remain in plugin data so an older synced device cannot silently resurrect a deleted knowledge base. Tombstones do not consume the 50-base lifecycle limit.

## Privacy checklist before sharing

- Deselect Workspace settings if folder names should remain private.
- Review every literal Saved-view query.
- Never share Same-vault recovery or conflict-rescue JSON publicly.
- Confirm the summary contains only intended Index and Library sections.
- Do not attach <code>data.json</code> to a public issue.
- Use synthetic subject titles and paths in screenshots or bug reports.
