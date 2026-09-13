# Local data and cleanup

This describes the unreleased Library-display source changes after 0.22.0. KBCC separates synced organization from device-only interaction history and external-image permission.

## Synced plugin data

The active Obsidian configuration profile stores KBCC organization in `plugins/ent-vault-command-center/data.json`. The source build writes store version 16 and base-data version 16. It contains knowledge-base identities, settings, direct-note and linked-folder membership, Library definitions and display profiles, Collections, paths, pins, visual hierarchy, and named snapshots. A neighboring `data.json.bak` follows the documented committed-state backup procedure.

Each Library display profile stores layout, image-property name, card size, proportions, fit, and up to six visible-property names. It does not store cover URLs, image bytes, displayed property values, or external-image permission. Markdown properties and the existing cover files remain ordinary vault files, which may independently sync through the user's vault setup.

Portable Workspace format 3 and package format 6 can carry display profiles. Private recovery format 12 restores them, including archived Library preferences. See [Portability and recovery](PORTABILITY_AND_RECOVERY.md) for scope and downgrade protection.

## Five App-local values

Obsidian stores these as vault-specific App-local values outside the plugin folder; removing only the folder is not reliable cleanup:

| Value | What it can retain |
| --- | --- |
| Device interaction state | Active routes, collapsed sections, bounded Undo/Redo, and pending transaction/history journals; existing format version 4 |
| Local diagnostic facts | Sync/recovery observations and update-announcement history |
| Rename-recovery journal | Bounded, vault-scoped repair state containing vault identity and old/new vault-relative paths |
| Return-navigation history | Vault identity, up to 24 opened-note paths, originating base/tab, selected-record path, literal search text, compact-detail state, and scroll position |
| External Library-image permission | A versioned boolean; no URLs, note content, paths, or host history |

These values are not synced by KBCC. User-entered search text can itself be sensitive, even though KBCC does not copy note bodies into return history. Keep a device profile containing search text and path-bearing histories private.

External-image permission applies to all Libraries in this vault on this device. Other vaults and devices keep their own permission. It is excluded from synced settings, exports, imports, recovery, and Undo. Missing, malformed, or unreadable permission defaults to blocked.

## Reset or uninstall

Export current private recovery and back up the vault first. Run **Clear device-local data…**, confirm, and then disable or uninstall in the same session. On success, the command removes all five plugin-owned App-local values and suppresses new local tracking until restart. It does not remove `data.json`, Markdown notes, attachments, recovery files, browser cookies, or browser image cache.

The reset disables external covers and removes their current image sources in this vault on this device before attempting local-storage cleanup. **Block external images** in Library settings can revoke just the permission in the same scope. Neither action changes another vault's or device's permission. Requests already sent cannot be undone or removed from the host's logs. If permission cleanup fails, images remain blocked for the current session but the old stored permission may return after restart; check Library settings again. Enabling external images is refused if its permission cannot be saved.

If the plugin was removed before cleanup, reinstall and enable the same or a newer compatible build, run the clear command, then disable/remove it again. See the [Library privacy proposal](LIBRARY_DISPLAY_AND_PRIVACY.md) for network behavior and pending review.
