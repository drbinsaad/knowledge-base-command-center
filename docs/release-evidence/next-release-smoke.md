# 0.20.0 device and Sync smoke record

Candidate: 0.20.0. This record began during the working changes after 0.19.1 and is now bound to release tag `0.20.0`.

Status: **Physical iPhone, VoiceOver, and two-device Sync checks are unexecuted.** Automated Chromium/WebKit results and browser-renderer screenshots must not be recorded as device passes. The historical 0.19.1 evidence remains unchanged.

After that scope was explicitly reported, the maintainer directed **“publish”**. The candidate-specific [0.20.0 waiver record](0.20.0-iphone.md) accepts these unverified checks for this release only. No row below is changed to Pass by that authorization.

Use this short candidate smoke pass before the full [physical-iPhone checklist](../manual-iphone-release-checklist.md). Use only a disposable synthetic vault. Record the actual build hash, device, operating system, Obsidian version, and Sync provider for each run.

| Flow | Pass criteria | Result |
| --- | --- | --- |
| Cold start and restart | Open the Generic base, follow a note, return to its KBCC route, restart Obsidian, and confirm the destination remains correct. | Unexecuted |
| Touch and keyboard | Search with the software keyboard open; change scope and availability; all visible actions remain reachable in portrait and landscape. | Unexecuted |
| Large text and Arabic | With the largest supported Dynamic Type size and Arabic/RTL content, read and activate tabs, results, dialogs, and their footer actions without overlap. | Unexecuted |
| VoiceOver | Navigate tabs, disclosure buttons, Show more, a selected record, Create note, Organizer stages, and recovery controls; verify names, state announcements, order, and focus after refresh/close. | Unexecuted |
| Expanded lists | Expand beyond 300 records, select a later row, then trigger a vault/metadata refresh. Keep the expanded page, selection, scroll position, and usable focus. | Unexecuted |
| Create note | Open and cancel the form, then create one synthetic note; title, path preview, scrolling body, and Save/Cancel remain reachable with the keyboard open. | Unexecuted |
| Organizer | Select notes, prepare destinations, review, apply, and undo a synthetic change; verify both list and modal focus remain usable. | Unexecuted |
| Attachment cancellation | Open Attach file, cancel the system picker, then open it again. No false busy state, file, or link remains after cancellation. | Unexecuted |
| Export/recovery | Export a private same-vault backup, inspect its intended boundary, and restore only into a disposable matching base; cancel a mismatched attempt. | Unexecuted |
| Two-device handoff | On device A, create organization; finish Sync; on B, open/restart and verify it. Repeat in the opposite direction, including initially delayed plugin data. | Unexecuted |
| Concurrent semantic edits | Using disposable copies, make distinct organization edits on both devices before Sync. After reconciliation, verify the deterministic survivor and private rescue preserve the losing change. | Unexecuted |
| Background and interruption | Background during search and a delayed metadata refresh, then foreground; confirm a responsive view and no stuck submission. | Unexecuted |

For each executed row, add the date, device/build details, observed outcome, and a sanitized evidence path. If a row is skipped, state why and retain **Unexecuted**. Any candidate-specific waiver must be explicitly recorded; earlier release waivers do not carry forward.

The automated production-renderer suite runs the actual `src/view.ts` view and production dialogs in Chromium and desktop WebKit with synthetic notes, native browser DOM, and a narrow Obsidian host adapter. It checks real rendered controls and focus, but does not load Obsidian, a Sync provider, iOS WebKit, or VoiceOver. Its synthetic host supplies theme variables and test icons, so screenshots show the implemented KBCC layout, not exact platform chrome or production icon assets.

## Initial supplemental local browser run

On 2026-09-09, Node 25.8.1 with Playwright 1.62.1 on macOS passed all 53 browser cases: 15 existing Chromium geometry cases and 19 production-renderer cases in each of Chromium and WebKit. The 4 empty-Collection cases passed again after their final mobile target-size correction. Coverage includes keyboard focus, scoped search, refresh/disclosure retention, actual dialog interactions, direct Collection creation, readable count semantics, 44px mobile targets, and light/dark metadata contrast in the synthetic themes. These are browser passes only; every physical-device and Sync row above remains **Unexecuted**.

## Follow-up implementation verification

The completed Settings labels, search and spacing follow-ups on the same date passed 83 browser cases (49 Chromium, 34 WebKit), with no failed, skipped or flaky cases. Real Obsidian 1.14.1 additionally verified Settings and search interactions in a disposable synthetic vault, including compact Settings geometry and keyboard management at 320, 390, 900 and 1200px. All six test-note bodies remained unchanged. These are supplemental desktop-runtime observations only; the physical-device and controlled Sync rows remain **Unexecuted**. See the [0.20.0 evidence record](0.20.0-iphone.md) for the release-specific boundary.
