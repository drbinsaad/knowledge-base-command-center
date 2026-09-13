# Local data and cleanup

This describes version 0.23.0. KBCC separates synced organization from device-only interaction history. Covers load only from existing vault images; online loading is not supported.

## Synced plugin data

The active Obsidian configuration profile stores KBCC organization in `plugins/ent-vault-command-center/data.json`. Version 0.23.0 writes store version 16 and base-data version 16. It contains knowledge-base identities, settings, direct-note and linked-folder membership, Library definitions and display profiles, Collections, paths, pins, visual hierarchy, and named snapshots. A neighboring `data.json.bak` follows the documented committed-state backup procedure.

Each Library display profile stores layout, image-property name, card size, proportions, fit, and up to six visible-property names. It does not store cover URLs, image bytes, displayed property values, or external-image permission. Markdown properties and existing cover files remain ordinary vault files, which may independently sync through the user's vault setup. An online URL in a note property never authorizes KBCC to load it.

Portable Workspace format 3 and package format 6 can carry display profiles. Private recovery format 12 restores them, including archived Library preferences. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md) for scope and downgrade protection.

## Four active App-local values and one legacy cleanup key

Obsidian stores these as vault-specific App-local values outside the plugin folder; removing only the folder is not reliable cleanup:

| Value | What it can retain |
| --- | --- |
| Device interaction state | Active routes, collapsed sections, bounded Undo/Redo, and pending transaction/history journals; existing format version 4 |
| Local diagnostic facts | Sync/recovery observations and update-announcement history |
| Rename-recovery journal | Bounded, vault-scoped repair state containing vault identity and old/new vault-relative paths |
| Return-navigation history | Vault identity, up to 24 opened-note paths, originating base/tab, selected-record path, literal search text, compact-detail state, and scroll position |
| Legacy external Library-image permission | An inert versioned boolean that may remain from a private test build; ignored for image loading and included only for cleanup |

These values are not synced by KBCC. User-entered search text can itself be sensitive, even though KBCC does not copy note bodies into return history. Keep a device profile containing search text and path-bearing histories private.

Version 0.23.0 has no external-image enable control or authorization path. A legacy allowed value in `ent-vault-command-center.library-images.v1` cannot enable remote covers. It is excluded from synced settings, exports, imports, recovery and Undo. Its removal affects only the current vault's App-local storage on this device.

## Reset or uninstall

Export current private recovery and back up the vault first. Run **Clear device-local data…**, confirm, and then disable or uninstall in the same session. On success, the command removes all five plugin-owned App-local values and suppresses new local tracking until restart. It does not remove `data.json`, Markdown notes, attachments, recovery files, browser cookies, or browser image cache.

Cleanup includes the legacy external-image key. If cleanup fails, an old value may remain on disk, but it is still inert in version 0.23.0, including after restart. Removing it cannot undo requests previously sent by a private test build or clear browser cookies/cache. It does not modify another vault's or device's App-local data.

If the plugin was removed before cleanup, reinstall and enable the same or a newer compatible build, run the clear command, then disable/remove it again. See [Library display and privacy](LIBRARY_DISPLAY_AND_PRIVACY.md) for the local-only release boundary and deferred online-cover proposal.
