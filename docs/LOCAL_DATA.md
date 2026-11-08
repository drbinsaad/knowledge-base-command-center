# Local data and cleanup

KBCC separates synced organization from device-only interaction history. Covers load only from existing vault images; online loading is not supported.

## Synced plugin data

The active Obsidian configuration profile stores KBCC organization in `plugins/ent-vault-command-center/data.json`. Current builds write store version 17 and base-data version 17, protecting collection-scoped saved views from older readers. It contains knowledge-base identities, settings, direct-note and linked-folder membership, Library definitions and display profiles, Collections, paths, pins, visual hierarchy, and named snapshots. A neighboring `data.json.bak` follows the documented committed-state backup procedure.

Each Library display profile stores layout, image-property name, card size, proportions, fit, and up to six visible-property names. It does not store cover URLs, image bytes, displayed property values, or external-image permission. Markdown properties and existing cover files remain ordinary vault files, which may independently sync through the user's vault setup. An online URL in a note property never authorizes KBCC to load it.

Portable Workspace format 3 remains unchanged inside package format 7; saved-view component format 2 preserves collection scopes. Private recovery format 13 restores organization and display profiles, including archived Library preferences. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md) for scope and downgrade protection.

## Four active App-local values and one legacy cleanup key

Obsidian stores these as vault-specific App-local values outside the plugin folder; removing only the folder is not reliable cleanup:

| Value | What it can retain |
| --- | --- |
| Device interaction state | Active routes, collapsed sections, bounded Undo/Redo, and pending transaction/history journals; format version 5; version-4 journals remain readable |
| Local diagnostic facts | Sync/recovery observations and update-announcement history |
| Rename-recovery journal | Format version 2; bounded, vault-scoped repair state containing vault identity and old/new vault-relative paths; version-1 journals remain readable |
| Return-navigation history | Format version 2, with version-1 histories readable: vault identity, up to 24 opened-note paths, originating base/tab, selected-record path, literal search text, compact-detail state, and scroll position |
| Legacy external Library-image permission | An inert versioned boolean that may remain from a private test build; ignored for image loading and included only for cleanup |

These values are not synced by KBCC. User-entered search text can itself be sensitive, even though KBCC does not copy note bodies into return history. Keep a device profile containing search text and path-bearing histories private.

There is no external-image enable control or authorization path. A legacy allowed value in `ent-vault-command-center.library-images.v1` cannot enable remote covers. It is excluded from synced settings, exports, imports, recovery and Undo. Its removal affects only the current vault's App-local storage on this device.

Update every synced device to 0.24.0 or a newer compatible release before editing. Older 0.23.1 preserves the newer store read-only. Return-navigation format 2 uses the same App-local key; older builds reject it rather than drop a collection filter. A writable downgrade needs matching pre-upgrade organization backups, a complete vault backup, and coordinated Sync handling; do not lower schema fields or install older assets over newer organization data.

## Undo history after updates

Each knowledge base's device-local Undo/Redo is stored with a fingerprint of the organization it operates on, inside the same version-5 device-interaction value. At startup, a base whose history is not bound to the organization now loaded (for example Sync changed it while Obsidian was closed, or the history was saved before this binding existed) has only that base's Undo/Redo reset, with one notice. Its route and collapsed sections, other bases' history, and your notes and organization are unchanged. After updating from an earlier release, expect existing Undo history to be reset once. Returning to an older release is not protected: it drops the binding when it saves, so the newer release resets those bases again. A value written by a newer release is left untouched, history stays empty, and nothing replaces it until you run **Clear device-local data**.

Rename recovery now writes journal format 2 at the existing App-local storage address. Recognized version-1 journals remain readable. If you return to 0.26.1 while a version-2 journal is still present, that older build can enter protected recovery rather than ignoring outstanding renames. This local journal change does not change the synced organization format or rewrite Markdown notes.

## Reset or uninstall

Export current private recovery and back up the vault first. Run **Clear device-local data…**, confirm, and then disable or uninstall in the same session. On success, the command removes all five plugin-owned App-local values and suppresses new local tracking until restart. It does not remove `data.json`, Markdown notes, attachments, recovery files, browser cookies, or browser image cache. It also does not remove conflict rescues (`knowledge-base-command-center-conflict-*.json`) or kept data backups (`data.json.bak-kept-*`). A full private rescue can contain per-base view and Undo history, so keep those files private and delete them yourself only when you are sure you no longer need them. **Review kept copies…** in the Sync & recovery center can list them.

Cleanup includes the legacy external-image key. If cleanup fails, an old value may remain on disk, but it is still inert, including after restart. Removing it cannot undo requests previously sent by a private test build or clear browser cookies/cache. It does not modify another vault's or device's App-local data.

If the plugin was removed before cleanup, reinstall and enable the same or a newer compatible build, run the clear command, then disable/remove it again. See [Library display and privacy](LIBRARY_DISPLAY_AND_PRIVACY.md) for the local-only release boundary and deferred online-cover proposal.
