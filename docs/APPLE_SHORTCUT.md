# Apple Shortcuts guide

Knowledge Base Command Center registers ten fixed Obsidian URL actions. Each one opens exactly one flow inside Obsidian and carries no data. Because they are plain `obsidian://` URLs, an Apple Shortcut can open any of them from the Home Screen, the share sheet, Back Tap, a widget, or a Mac menu bar item.

Nothing here requires an add-on, an account, or a network connection. The plugin makes no request of any kind when a URL is opened.

## The ten URLs

| URL | What it opens |
| --- | --- |
| `obsidian://kbcc-quick-entry` | The Quick entry hub for the active knowledge base. |
| `obsidian://kbcc-create-subject` | Create a portable **No note** subject. |
| `obsidian://kbcc-create-heading` | Create an Index group, Collection heading, or Library heading. |
| `obsidian://kbcc-create-subheading` | Create a subheading under a chosen heading or subheading. |
| `obsidian://kbcc-create-note` | The blank Create note form. |
| `obsidian://kbcc-add-current-note` | Classify the note Obsidian currently has active. |
| `obsidian://kbcc-add-existing-note` | The local note picker, to add an existing note. |
| `obsidian://kbcc-quick-append-current` | A blank Quick append form for the currently active note. |
| `obsidian://kbcc-quick-append-existing` | The note picker, then a blank Quick append form. |
| `obsidian://kbcc-attach-current` | **Attach file to current note** for the active note, when it is eligible. |

Every route runs the same guarded handler as its Command palette command. A URL never skips a confirmation, never submits a form, and never writes a file on its own.

## Build a Shortcut

These steps are the same on iPhone, iPad, and Mac.

1. Open the **Shortcuts** app.
2. Tap or click **+** to create a new shortcut.
3. Search for the **Open URLs** action and add it. (The action is named *Open URLs*; *Open App* will not work, because you need Obsidian to receive the specific action.)
4. Replace the placeholder text with one URL from the table above, exactly as written — no query string, no trailing `?`.
5. Rename the shortcut something you will recognise, for example *Capture question*.
6. Choose an icon and colour so it is identifiable on the Home Screen.
7. Save.

Test it once before you rely on it. Obsidian should come to the foreground with the intended form or picker already open.

### Put it where you will use it

- **Home Screen** — in the shortcut's details, choose **Add to Home Screen**. iOS creates an icon that launches the flow in one tap.
- **Share sheet** — in the shortcut's details, turn on **Show in Share Sheet**. Useful for pairing a capture flow with whatever you are reading.
- **Back Tap** (iPhone) — open **Settings → Accessibility → Touch → Back Tap**, choose **Double Tap** or **Triple Tap**, and pick your shortcut. Two taps on the back of the phone then opens Quick entry.
- **Widget or Lock Screen** — add the Shortcuts widget and select the shortcut.
- **Mac** — in the shortcut's details, enable **Pin in Menu Bar**, or assign a keyboard shortcut under **Add Keyboard Shortcut**.
- **Spotlight / Siri** — the shortcut's name becomes its spoken and searchable trigger, so name it in plain words.

### Inside Obsidian instead

If you only need the flow while Obsidian is already open, you do not need a Shortcut at all. Assign a hotkey under **Settings → Hotkeys**, or add the command to the mobile toolbar under **Settings → Mobile → Manage toolbar options → Add global command**. See [Quick entry and shortcuts](USER_GUIDE.md#quick-entry-and-shortcuts).

## The URLs reject every parameter — on purpose

Each route accepts only Obsidian's own intrinsic `action` value. If the URL carries **any** additional query key, the route fails closed: it returns before a hub, picker, or form opens, and nothing happens at all.

That means all of the following do nothing:

```text
obsidian://kbcc-create-note?title=My%20note
obsidian://kbcc-quick-append-current?content=remember%20this
obsidian://kbcc-add-existing-note?path=Private/Note.md
obsidian://kbcc-quick-entry?anything=at-all
```

This is a deliberate privacy boundary rather than a missing feature. A URL is one of the least protected surfaces on the device: it can appear in a Shortcut anyone can inspect or share, in automation logs, in a scanned QR code, or in a link someone else sends you. Refusing parameters means:

- no note title, path, body text, category, or clinical value can ever travel through a URL, so none of it can be logged, shared, or shoulder-surfed;
- no third party can craft a link that silently files, appends to, or attaches something to a note in your vault, because the flow always stops at a form you can see; and
- the routes cannot quietly grow data-carrying capabilities later, because the allowlist is a single key checked by tests.

Current-note routes resolve the note only from Obsidian's own active workspace. No note identity is carried in the URL, and `obsidian://kbcc-attach-current` reports a deliberately generic notice when there is no eligible active Markdown note — it does not disclose which note is open or why it was refused.

The trade-off is real and worth stating plainly: you cannot build a "capture this text straight into my vault" Shortcut with these URLs. You get a one-tap route to the right blank form, and you type there.

## Which vault does the URL open?

The URL does **not** select a vault.

Obsidian's own `obsidian://open` scheme accepts a `vault=` parameter, but that does not apply here: the plugin's guard accepts a single `action` key, so `obsidian://kbcc-quick-entry?vault=Research` carries a second key and fails closed like any other parameter. There is no plugin-provided way to target a named vault.

In practice the URL is handled by the Obsidian instance that receives it — on iOS, the app as it currently stands, with the vault it currently has open. Build your shortcuts on the assumption that they act on whatever vault Obsidian opens, and, if you keep several vaults, open the right one before tapping. The plugin also resolves the *active knowledge base*, not a named one; use **Switch knowledge base** inside the Quick entry hub if it is not the one you wanted.

## Sharing your own Shortcut

This project does not ship an importable `.shortcut` file or an iCloud link. A shortcut is a single **Open URLs** action, so building it yourself takes under a minute and means you never import an automation you have not read.

If you build one you would like to share, the Shortcuts app can generate an iCloud link from the shortcut's share menu. Anyone opening a shared shortcut should inspect its actions first — a shortcut can contain far more than one URL.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Nothing happens at all | The URL has a query string. Remove everything from `?` onward. |
| Obsidian opens but no form appears | The action name is misspelled. Compare it against the table above, character for character. |
| "No eligible active Markdown note is available" | The active file is not a Markdown note, is a protected source note, or plugin data is currently read-only. Open a normal note first. |
| The wrong knowledge base opens | The active knowledge base is plugin-wide. Switch it in the Quick entry hub or with **Switch knowledge base…**. |
| A Library flow asks for a heading first | Library capture always requires an explicit heading or subheading. Create the Library's first heading, then retry. |

More in [Troubleshooting](TROUBLESHOOTING.md).

## See also

- [User guide → Quick entry and shortcuts](USER_GUIDE.md#quick-entry-and-shortcuts)
- [User guide → Quick append](USER_GUIDE.md#quick-append)
- [Getting started → Set up Quick entry](GETTING_STARTED.md#set-up-quick-entry)
- [Security policy](../SECURITY.md)
