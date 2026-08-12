# Starter templates

Five ready-to-use Obsidian note templates for [Knowledge Base Command Center](../README.md). They are ordinary Markdown files. Nothing in this folder is loaded by the plugin automatically — you copy the ones you want into your vault and point a setting at them.

| Template | Intended for |
| --- | --- |
| [`Study topic.md`](Study%20topic.md) | A concept, subject, or lecture topic you are learning. |
| [`Source note.md`](Source%20note.md) | A paper, book, article, or video you are reading. |
| [`Project.md`](Project.md) | A piece of work with an outcome, next actions, and a decision log. |
| [`Meeting or case log.md`](Meeting%20or%20case%20log.md) | A dated encounter: meeting, session, or case entry. |
| [`Question inbox.md`](Question%20inbox.md) | An open question you want to capture now and resolve later. |

## Install them

1. Copy the template files you want into a folder **inside your vault**, for example `Templates/`. The plugin only reads templates that live in the vault.
2. Open **Settings → Knowledge Base Command Center** and set **Templates folder** to that folder. Leaving it empty allows any Markdown file in the vault to be chosen instead.
3. Choose where the template applies:
   - **Per knowledge base** — set **Default starting content** to copy a template and pick one under **Default template**. Every new note in that knowledge base starts there unless you change it in the Create note form.
   - **Per Library** — open **Settings → Libraries → Library creation profiles**, select a Library, and override its **starting content** and **template path**. Fields left on **Inherit** follow the knowledge-base default. Profiles are keyed by the Library's stable internal ID, so renaming or reordering a Library keeps its profile.
   - **Per note** — the Create note form always shows the resolved folder, mode, and template, and you can change them for one note.

The destination path is previewed before creation, missing folders are created safely, and an existing file is never overwritten.

## What each token does

Tokens are replaced **once, at explicit note creation**. They are not re-evaluated when the note is opened, when a Library is renamed, or when organization changes later.

### YAML-safe tokens

Use these inside frontmatter. Each expands to a complete double-quoted YAML scalar — including the quotes — so a title containing a colon, quote mark, or line break cannot break the note's properties. Write `category: {{yaml:category}}`, not `category: "{{yaml:category}}"`.

| Token | Resolves to |
| --- | --- |
| `{{yaml:title}}` | The note title you typed. Prefer this over plain `{{title}}` in frontmatter. |
| `{{yaml:id}}` | The subject's stable or configured ID when the record already has one; otherwise `""`. |
| `{{yaml:category}}` | The title of the deepest Library subheading the note is placed in, then its heading, then the record group or Library name as a fallback. |
| `{{yaml:parent}}` | The existing parent subject's title when one is known; otherwise `""`. |
| `{{yaml:library}}` | The Library's name. |
| `{{yaml:type}}` | The Library's singular item label — the word the Library uses for one of its records. |

When a value is unavailable, the token becomes an empty quoted scalar `""` rather than being left in the file.

`{{yaml:id}}`, `{{yaml:category}}`, `{{yaml:parent}}`, `{{yaml:library}}`, and `{{yaml:type}}` are filled from the Library context of the note being created. Creating a note without a Library context — for example a plain **Create note** into the Index — leaves them as `""`. `{{yaml:title}}` always resolves to the note title.

### Body tokens

| Token | Resolves to |
| --- | --- |
| `{{title}}` | The note title, inserted literally. Safe in the body; use `{{yaml:title}}` in frontmatter. |
| `{{date}}` | The creation date. |
| `{{time}}` | The creation time. |

### Everything else is copied unchanged

The `yaml:` prefix is deliberate and exact. Plain `{{id}}`, `{{category}}`, and any other templating syntax — including syntax belonging to the Templater or core Templates plugins — is copied through untouched, so these files can carry another plugin's tokens alongside these.

## Notes on the shipped templates

- The explanatory HTML comment sits **after** the frontmatter, because Obsidian only recognises properties when `---` is the very first line. Delete the comment once you have the template installed.
- Leave the end of a note free if you use **Quick append**: it maintains its own managed *Follow-up notes* block at the end of the file and appends beneath it.
- These templates set only descriptive properties. The plugin never rewrites frontmatter in existing notes, and it never infers Library placement from note properties.

## Related documentation

- [Getting started](../docs/GETTING_STARTED.md)
- [User guide](../docs/USER_GUIDE.md) — see *Create notes* for the full token reference
- [Apple Shortcut guide](../docs/APPLE_SHORTCUT.md)
