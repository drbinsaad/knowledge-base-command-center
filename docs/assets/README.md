# Documentation asset provenance

These assets have different evidentiary roles. Captions and reuse must preserve that distinction.

| File | Type and provenance | What it can show | What it must not imply |
| --- | --- | --- | --- |
| <code>hero.png</code> | AI-generated abstract concept artwork, 2172 × 724 pixels. It was created with OpenAI image generation on 2026-08-10 from a project-authored, text-free knowledge-card prompt and no reference image. It is not a screenshot of Obsidian or Knowledge Base Command Center. | The general idea of interconnected, organized knowledge cards. | Actual product layout, a shipped feature, real user data, or usability evidence. |
| <code>workspace-desktop.png</code> | Real, sanitized desktop capture of the current version-0.10.0 interface, cropped to the plugin workspace, 1320 × 650 pixels. | The optional ENT preset's Medications Library, tab navigation, grouped placeholder records, search field, and desktop density. | A Generic-profile default, resolved medication notes, clinical approval, or comprehensive desktop testing. |
| <code>search-mobile.png</code> | Real, sanitized iPhone portrait capture of the current version-0.10.0 interface, 1206 × 2622 pixels. | One portrait search state with the software keyboard visible, a live result count, compact rows, No note badges, and row action menus. | A completed physical-iPhone release checklist or verification of landscape, broad-query paging, destructive fresh-device recovery, the full touch import/export matrix, every Dynamic Type setting, or Android behavior. |

The two screenshots contain no visible patient identifiers, private note bodies, credentials, local filesystem paths, or recovery data. Clinical terms visible in the captures are interface records, not patient information or medical advice.

These documentation assets are distributed with the repository under the
[MIT License](../../LICENSE). Obsidian names, interface elements, and trademarks
visible in real product captures remain the property of their respective
owners; this project is not endorsed by Obsidian.

## Required captions

When reused in project documentation:

- describe <code>hero.png</code> as abstract AI-generated artwork;
- describe both screenshots as real, sanitized version-0.10.0 captures;
- identify the desktop image as the optional ENT preset rather than a Generic default;
- link mobile claims to [the 0.10.0 iPhone evidence note](../release-evidence/0.10.0-iphone.md); and
- never convert the existence of a screenshot into a checklist pass or broader test claim.

## Suggested alt text

- <code>hero.png</code>: “Abstract illustration of interconnected knowledge cards.”
- <code>workspace-desktop.png</code>: “Knowledge Base Command Center desktop view showing the Medications Library.”
- <code>search-mobile.png</code>: “Knowledge Base Command Center search results above the iPhone keyboard.”

Do not replace the screenshots with generated mockups while continuing to label them as real captures.
