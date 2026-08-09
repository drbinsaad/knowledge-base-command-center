# Manual real-iPhone release checklist

Complete this checklist on a physical iPhone before tagging a release that changes search, navigation, modals, import/export, Sync handling, or mobile styles. Simulator and automated DOM results may accompany this record but do not replace it.

Do not use private notes, patient information, or copyrighted source material in screenshots, recordings, logs, or issue attachments.

## Test record

- Candidate version and commit:
- Date:
- Tester:
- iPhone model:
- iOS version:
- Obsidian version:
- Sync method:
- Vault note count:
- Knowledge-base count:
- Dynamic Type settings tested:
- Portrait CSS viewport width(s) tested:
- Landscape CSS viewport width(s) tested (include at least one width between 844 and 1024 px):
- Portrait result:
- Landscape result:

## Prerequisites

- Use a disposable or backed-up vault containing at least 8,000 Markdown notes.
- Configure at least two available knowledge bases, with a uniquely named searchable note-backed record in the second base, plus one archived base.
- Include Index, Inbox, Collections, Procedures, Medications, and Syndromes records where the profile supports them.
- Export a same-vault recovery for every test base and make a complete vault backup before starting.
- Test portrait and landscape at default Dynamic Type and the largest accessibility text size. Record the CSS viewport width shown by the test device in each orientation; landscape coverage must include a width above the former 620 px phone breakpoint (current iPhones commonly report 844–956 px).

## Manual release gate

Record **Pass**, **Fail**, or **Not applicable** plus a short observation for every item. A relevant Fail blocks the release until it is fixed and retested on the physical device.

1. Open the Command Center from the ribbon. Confirm the header, knowledge-base switcher, tabs, and search field fit without body-level horizontal scrolling.
2. In both portrait and landscape, focus search with the software keyboard visible. Confirm the results pane retains useful nonzero height, the search field remains below the visible top edge when iOS pans the viewport, and the first result appears above the keyboard.
3. Search `laryn`, `laryngo`, and `laryngomalacia`, clearing between terms. Confirm no blank frame appears and record the perceived typing latency.
4. Enter a broad one-letter query. Confirm the app remains responsive, the full count is visible, no more than 300 result rows are rendered, and the interface says **Showing the first 300 of _N_ results.** when capped.
5. Confirm results are grouped by knowledge base and then library section. The active base must appear first; other available bases must be ordered by workspace name; the archived base must not appear.
6. Select the uniquely named note-backed result from the other available base. Confirm every open Command Center view switches to that base, the record is selected, and its focused inspector opens.
7. Use **Back to main page** from the record inspector. Confirm the previous search and scroll position remain usable, then dismiss the keyboard and confirm the active tab scrolls back into view.
8. Open **Manage index…**. Record initial-render time and the response while typing five characters; confirm Indexed, Available, Hidden, Groups, and Diagnostics remain usable.
9. Open **Create note from template or empty note…** with the keyboard visible. Confirm every field and action button is reachable by scrolling inside the modal.
10. Create notes with an Arabic title and with literal replacement characters such as `$&` and `` $` ``. Confirm filenames and `{{title}}` substitutions preserve the intended text and do not overwrite an existing note.
11. Enter Arrange mode and use the row **…** menu to Move under, Indent, Outdent, Move up/down, and Make top-level. Confirm each action works by touch and ordinary arrangement does not move or rewrite the Markdown file.
12. Export a portable package and same-vault recovery. Confirm both land under `Knowledge Base Command Center Exports/`, privacy warnings are visible, and the recovery can be selected and restored on the same device.
13. With base A active on the phone and base B active on desktop, make one organization edit in each after Sync is settled. Confirm both survive the next Sync. Do not use this test to imply that simultaneous edits to the same base are field-merged.
14. Open base management, archive and restore a disposable base, and confirm long names, confirmations, safe areas, and the 50-base-limit message do not clip.
15. Use Accessibility Inspector to confirm interactive controls meet a 44 × 44 point target, labels and modal focus are meaningful, and layout remains operable at the largest Dynamic Type setting.

## Sign-off

- Blocking failures and issue links:
- Retest evidence:
- Final result: Pass / Fail
- Tester signature or initials:
