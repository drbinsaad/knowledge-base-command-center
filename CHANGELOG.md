# Changelog

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
