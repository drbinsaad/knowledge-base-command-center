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
- Include Index, Inbox, Collections, the built-in Procedures/Medications/Syndromes Libraries where the profile supports them, and at least two custom Libraries with distinct icons and long names.
- Export a same-vault recovery for every test base and make a complete vault backup before starting.
- Test portrait and landscape at default Dynamic Type and the largest accessibility text size. Record the CSS viewport width shown by the test device in each orientation; landscape coverage must include a width above the former 620 px phone breakpoint (current iPhones commonly report 844–956 px).

## Manual release gate

Record **Pass**, **Fail**, or **Not applicable** plus a short observation for every item. A relevant Fail blocks the release until it is fixed and retested on the physical device.

1. Open the Command Center from Obsidian's mobile **Open** menu. Confirm the header, knowledge-base switcher, tabs, and search field fit without body-level horizontal scrolling.
2. In both portrait and landscape, focus search with the software keyboard visible. Confirm the results pane retains useful nonzero height, the search field remains below the visible top edge when iOS pans the viewport, and the first result appears above the keyboard.
3. Search `laryn`, `laryngo`, and `laryngomalacia`, clearing between terms. Confirm no blank frame appears and record the perceived typing latency.
4. Enter a broad one-letter query. Confirm the app remains responsive, the full count is visible, no more than 300 result rows are rendered, and the interface says **Showing the first 300 of _N_ results.** when capped. Clear search, open an Index or Library containing more than 300 records, confirm the first browse page stays responsive, then use **Show 300 more** and verify the count advances without jumping to a different section.
5. Confirm results are grouped by knowledge base and then library section. The active base must appear first; other available bases must be ordered by workspace name; the archived base must not appear.
6. Select the uniquely named note-backed result from the other available base. Confirm every open Command Center view switches to that base, the record is selected, and its focused inspector opens.
7. Use **Back to main page** from the record inspector. Confirm the previous search and scroll position remain usable, then dismiss the keyboard and confirm the active tab scrolls back into view.
8. Open **Manage index…**. Record initial-render time and the response while typing five characters; confirm Indexed, Available, Hidden, Groups, and Diagnostics remain usable.
9. Open **Create note from template or empty note…** with the keyboard visible. Confirm every field and action button is reachable by scrolling inside the modal.
10. Create notes with an Arabic title and with literal replacement characters such as `$&` and `` $` ``. Confirm filenames and `{{title}}` substitutions preserve the intended text and do not overwrite an existing note.
11. Enter Arrange mode and use the row **…** menu to Move under, Indent, Outdent, Move up/down, and Make top-level. Confirm each action works by touch and ordinary arrangement does not move or rewrite the Markdown file.
12. Open a custom Library. Use **Add → Add existing note** to classify a disposable Index topic, confirm it leaves the active base's Knowledge Index, then use the record **…** menu to move it to another custom Library and back. Confirm the Markdown path, file contents, Collection membership, pin, and Next status do not change. Repeat once with a valid built-in clinical destination where the source kind permits it.
13. Open **Manage libraries**. Create a custom Library, edit its plural/singular labels and icon, reorder it, archive it, and restore it. In that Library create a heading and nested subheading, rename and reorder both, move a record between them, then delete the non-empty heading. Confirm the record remains under the explicit Unplaced section after leaving and reopening Arrange. Archive the Library again and verify permanent deletion requires an explicit record destination. Repeat the menu actions at the largest Dynamic Type setting.
14. Export a portable format v4 package containing two selected custom Libraries, one unselected Library, an empty Library, empty headings, nested subheadings, placed records, and an unplaced record. Import it into another disposable base using Merge and then Replace; confirm only the selected Library IDs and exact layouts change. Export and restore a same-vault recovery v9 on the source base; confirm both files land under `Knowledge Base Command Center Exports/` and privacy warnings are visible.
15. With base A active on the phone and base B active on desktop, make one organization edit in each after Sync is settled. Confirm both survive the next Sync. Do not use this test to imply that simultaneous edits to the same base are field-merged.
16. Open base management, archive and restore a disposable base, and confirm long names, confirmations, safe areas, and the 50-base-limit message do not clip.
17. Use Accessibility Inspector to confirm interactive controls meet a 44 × 44 point target, including Library tabs, Library-manager controls, heading/subheading titles, and their **…** menus; labels and modal focus are meaningful, and layout remains operable at the largest Dynamic Type setting.
18. In a disposable synced copy, remove only the plugin's local mobile `data.json` while the plugin is disabled (preserve the desktop copy and all backups), then enable the candidate on iPhone before Sync redelivers that file. Open the view once, let Sync finish, and confirm the established bases, headings, and subjects are adopted instead of an empty store. Repeat with one disposable local organization edit before delivery; confirm a private `knowledge-base-command-center-conflict-*.json` appears under `Knowledge Base Command Center Exports/` before the established store is adopted. Verify that the rescue contains plugin organization and paths but no Markdown note bodies.
19. Open Quick Entry from the Command Center header and from Obsidian's mobile **Open** menu. Confirm the hub fits in portrait and landscape, every action remains reachable at the largest Dynamic Type setting, and dismissing any picker makes no change.
20. Under **Settings → Mobile → Manage toolbar**, scroll to the bottom, choose **Add global command**, search for **Quick entry**, and add the hub plus one focused Quick Entry command. Run both toolbar actions, confirm their icons and labels are meaningful, and confirm the plugin installed no default hotkey.
21. In a custom Library that has headings and subheadings, use Quick Entry to create a note, add the current note, and add an existing note. For each action choose a specific subheading and confirm the resulting record appears only at that placement without moving or rewriting Markdown. Repeat in an empty custom Library; create the requested first heading, cancel the following action, and confirm only the empty heading was created and Undo removes it.
22. Create an Apple Shortcut using **Open URLs** with exactly `obsidian://kbcc-quick-entry`. Confirm it opens only the hub. Then test `?title=Private`, `?path=Private/Note.md`, and one unknown query key; confirm each URL fails closed without opening a form, creating a note, or exposing its value in a notice or log.
23. Open Quick Entry, leave its destination picker open, then cause a same-base Sync reload from another device. Confirm the stale picker cannot create, classify, or switch anything. Repeat by switching the active knowledge base from another Command Center view, then confirm an explicitly reopened base picker can still perform one deliberate switch.

## Sign-off

- Blocking failures and issue links:
- Retest evidence:
- Final result: Pass / Fail
- Tester signature or initials:
