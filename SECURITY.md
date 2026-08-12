# Security policy

## Supported versions

| Version | Security support |
| --- | --- |
| Latest published release | Supported |
| Older releases | Update first; fixes are not guaranteed to be backported |
| Unreleased branches or local builds | Best-effort investigation only |

If a report affects an older version, confirm whether it reproduces on the latest release without placing private data or exploit details in a public channel.

## Report a vulnerability

Do not open a public issue for a vulnerability that could expose, modify, delete, or misroute vault data.

1. Open the repository **Security** tab.
2. If **Report a vulnerability** is available, use it to create a private advisory.
3. Include the plugin version, Obsidian version, operating system/device, installation method, minimal reproduction steps, and potential effect on vault data.
4. Use a synthetic scratch vault. Do not attach a real <code>data.json</code>, note body, recovery/conflict-rescue export, patient information, credentials, or copyrighted source text.

GitHub private vulnerability reporting is a repository setting and may not always be enabled. This repository does not currently publish a dedicated security email. If the button is unavailable, retain technical details and use any private contact method the maintainer has published on the [GitHub profile](https://github.com/drbinsaad). If no private route is visible, do not post sensitive details publicly; a sanitized public report may request a private contact without identifying the vulnerability.

After a valid private report reaches the maintainer, an acknowledgement is targeted within seven days. Investigation and fix timing depends on severity, reproducibility, and release risk.

## In scope

Security-relevant reports include:

- unintended note creation, modification, movement, overwrite, or deletion;
- path traversal or writes outside permitted vault locations;
- unsafe imported configuration, prototype pollution, hierarchy abuse, or resource exhaustion;
- recovery applied to the wrong vault, knowledge base, or preset;
- downgrade or migration behavior that overwrites newer/unrecognized data;
- Sync races that silently replace trusted organization;
- exposure of note bodies, exact private paths, plugin data, or clipboard contents;
- unexpected network, telemetry, Node.js, Electron, or desktop-only runtime access; and
- release-asset or build-pipeline integrity problems.

## Usually out of scope

- issues that require a user to publish their own private recovery or <code>data.json</code> contrary to the warnings;
- unsupported older versions when the issue does not reproduce on the latest release;
- social engineering, denial of service against GitHub or Obsidian infrastructure, and vulnerabilities in those upstream products;
- feature requests, ordinary UI defects, or documented whole-base last-write-wins Sync behavior without a separate security impact; and
- medical or clinical-content disputes. The plugin is an organization tool and does not provide clinical approval or autonomous decision support.

## Trust boundary

Knowledge Base Command Center runs inside the current Obsidian vault. It intentionally enumerates Markdown paths and cached metadata to build indexes and enumerates vault entries for folder and in-vault JSON pickers. Content reads are targeted to a selected template or import, to the note explicitly selected for Quick append inside Obsidian's atomic process operation, to an explicit attachment destination note, and to separately disclosed ENT canonical workflows. The explicit Attach file command reads only the external file selected by the user and writes its bytes to a validated vault path; it does not enumerate external files, request direct camera access or capture, intercept paste/drop, or transmit the binary. On mobile, any camera or photo-library source offered by the operating system's file picker remains an explicit user choice.

The plugin has no intended analytics, telemetry, advertising, account, payment, or network requests. Ordinary organization changes plugin data only.

Portable Index and Library sections exclude source note paths and note bodies. Workspace settings can contain configured vault-relative folders; saved queries are literal. Same-vault recovery, conflict rescues, and raw <code>data.json</code> contain exact vault-relative paths and must remain private.

The Quick entry, Quick append, and Attach file protocol routes are fixed and action-only. They accept only Obsidian's intrinsic action dispatch; any additional query key fails closed before a hub, picker, or form opens. URLs cannot prefill a title, note path, category, content, file, or other entry field, and rejected query values are not retained or logged. Current-note routes derive their target only from Obsidian's local active workspace. Attach file additionally requires the exact current Markdown file object, writable plugin state, and a non-immutable path before its operating-system picker opens; an ineligible target receives a generic notice that does not disclose its title, path, or rejection reason.

Quick append is an explicit Markdown-write workflow. It uses the selected note's latest content inside Obsidian's atomic process operation, refuses <code>ai_lock: true</code> or ambiguous lock declarations, and changes only a strictly marked managed block. Its short undo retains only a file reference, offsets, and integrity fingerprints in memory; neither note bodies nor appended text are written to plugin data. The feature does not import, move, or manage attachments.

Two ENT-only workflows—proposal promotion and advanced canonical placement—can move a selected note and update structural frontmatter and its top-level heading after explicit action. They refuse <code>ai_lock: true</code>, preview their destination, and attempt rollback.

The attachment command can create a new binary file and insert one generated Markdown link after an explicit user action. Existing attachments are never moved or deleted. If link insertion fails after the binary write, the plugin keeps the binary and reports its vault path rather than deleting data automatically. Attachment contents are excluded from plugin exports and recovery packages.

## Coordinated disclosure

Please allow a reasonable investigation and remediation window before public disclosure. The maintainer will credit reporters who want attribution, unless legal, privacy, or safety considerations prevent it. Do not access data you do not own, degrade another person's vault, or retain private material beyond what is necessary to demonstrate the issue.
