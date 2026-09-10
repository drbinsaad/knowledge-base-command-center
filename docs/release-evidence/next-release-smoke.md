# 0.20.1 device and Sync smoke record

Candidate: 0.20.1, including the final compact sticky toolbar and touch-aware Clear handling. This is the active candidate smoke record; historical 0.20.0 evidence remains in its [separate release record](0.20.0-iphone.md).

Status: **Physical iPhone, VoiceOver, and two-device Sync checks are unexecuted.** Automated Chromium/WebKit results and browser-renderer screenshots must not be recorded as device passes. The historical 0.19.1 evidence remains unchanged.

After the final sticky candidate and its physical-iPhone verification gap were explicitly reported, the maintainer directed **“publish”**. The candidate-specific [0.20.1 waiver record](0.20.1-iphone.md) records publication authorization with the physical scope unverified. No row below is changed to Pass by that authorization, and no earlier release's waiver is reused.

An earlier user-provided physical-iPhone screenshot showed the compact nonsticky build only. It is not final sticky-toolbar sign-off and does not execute any row below. Do not reproduce that screenshot or its private titles in public evidence.

Use this short candidate smoke pass before the full [physical-iPhone checklist](../manual-iphone-release-checklist.md). Use only a disposable synthetic vault. Record the actual build hash, device, operating system, Obsidian version, and Sync provider for each run.

| Flow | Pass criteria | Result |
| --- | --- | --- |
| Browse space before keyboard focus | With Obsidian's real top and bottom chrome, the default portrait list shows at least five complete normal note rows on the intended phone viewport, without body-level horizontal overflow; later notes scroll into view above the bottom toolbar. | Unexecuted |
| Sticky controls and Filters | Scroll deeply with the keyboard closed. Tabs and Search/Filters remain reachable while base/Add/Details/counts scroll away. Open Filters without moving the list; its bounded panel scrolls independently, and closing it or pressing Escape preserves the list and returns usable focus. Repeat after rotation and larger text changes. | Unexecuted |
| Cold start and restart | Open the Generic base, follow a note, return to its KBCC route, restart Obsidian, and confirm the destination remains correct. | Unexecuted |
| Touch and keyboard | Search with the software keyboard open, scroll to a later result, tap the intended note, return with Back, and tap Clear. Verify exact selection, focus and scroll restoration; change scope and availability; all visible actions remain reachable in portrait and landscape. With a hardware keyboard, navigate earlier rows without hiding focus under the pinned toolbar. | Unexecuted |
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
| Update announcement | Upgrade a disposable existing installation to 0.20.1. Verify readable highlights, reachable controls and VoiceOver order, one-time automatic display, and the exact release link `https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.20.1`. | Unexecuted |

For each executed row, add the date, device/build details, observed outcome, and a sanitized evidence path. If a row is skipped, state why and retain **Unexecuted**. Any candidate-specific waiver must be explicitly recorded; earlier release waivers do not carry forward.

The automated production-renderer suite runs the actual `src/view.ts` view and production dialogs in Chromium and desktop WebKit with synthetic notes, native browser DOM, and a narrow Obsidian host adapter. It checks real rendered controls and focus, but does not load Obsidian, a Sync provider, iOS WebKit, or VoiceOver. Its synthetic host supplies theme variables and test icons, so screenshots show the implemented KBCC layout, not exact platform chrome or production icon assets.

## 0.20.1 supplemental implementation checks

On 2026-09-10, before the 0.20.1 metadata was assigned, `npm run review` passed 1,187 runtime tests, three performance budgets and ten release tests, plus its coverage, typecheck, lint/JSON, build, bundle and Community checks. The full browser suite passed 117 cases (66 Chromium, 51 WebKit), with zero failures, skips or flakes. Real Obsidian 1.13.7 desktop mobile emulation additionally passed four viewport and four interaction checks in a disposable synthetic vault; note bytes were unchanged, no renderer errors were captured, and desktop geometry remained identical. These observations do not execute any physical-device or Sync row above. The [0.20.1 evidence record](0.20.1-iphone.md) separates these implementation results from the exact versioned release gate.

The subsequent versioned 0.20.1 local gate passed 1,188 runtime tests, 117 browser cases, three performance budgets and ten release tests, with zero dependency vulnerabilities and unchanged bundle limits. See the [candidate evidence record](0.20.1-iphone.md) for runtime versions and the separate Node 22 publication gate. These results do not execute any physical-device or Sync row above.

## Historical 0.20.0 initial supplemental browser run

On 2026-09-09, Node 25.8.1 with Playwright 1.62.1 on macOS passed all 53 browser cases: 15 existing Chromium geometry cases and 19 production-renderer cases in each of Chromium and WebKit. The 4 empty-Collection cases passed again after their final mobile target-size correction. Coverage includes keyboard focus, scoped search, refresh/disclosure retention, actual dialog interactions, direct Collection creation, readable count semantics, 44px mobile targets, and light/dark metadata contrast in the synthetic themes. These are browser passes only; every physical-device and Sync row above remains **Unexecuted**.

## Historical 0.20.0 follow-up implementation verification

The completed Settings labels, search and spacing follow-ups on the same date passed 83 browser cases (49 Chromium, 34 WebKit), with no failed, skipped or flaky cases. Real Obsidian 1.14.1 additionally verified Settings and search interactions in a disposable synthetic vault, including compact Settings geometry and keyboard management at 320, 390, 900 and 1200px. All six test-note bodies remained unchanged. These are supplemental desktop-runtime observations only; the physical-device and controlled Sync rows remain **Unexecuted**. See the [0.20.0 evidence record](0.20.0-iphone.md) for the release-specific boundary.
