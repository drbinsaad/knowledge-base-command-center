# Documentation asset provenance

These assets have different evidentiary roles. Captions and reuse must preserve that distinction.

| File | Type and provenance | What it can show | What it must not imply |
| --- | --- | --- | --- |
| <code>hero.png</code> | AI-generated abstract concept artwork, 2172 × 724 pixels. It was created with OpenAI image generation on 2026-08-10 from a project-authored, text-free knowledge-card prompt and no reference image. It is not a screenshot of Obsidian or Knowledge Base Command Center. | The general idea of interconnected, organized knowledge cards. | Actual product layout, a shipped feature, real user data, or usability evidence. |
| <code>how-it-works.svg</code> | Project-authored vector diagram, hand-written SVG in this repository. It is a schematic, not a capture of any interface. | How the plugin relates to a vault: files stay in place while structure lives in plugin data, including nested collection levels. | Actual product layout, real user data, or usability evidence. |
| <code>generic-browser-desktop.png</code> | Chromium screenshot captured on 2026-09-09 at 1440 × 960 pixels from the production view renderer and stylesheet during the implementation later versioned as 0.20.0. The version was not assigned at capture time. <code>tests/browser/view-harness.ts</code> supplies a synthetic Generic base; <code>obsidian-browser.ts</code> and <code>host.css</code> supply native host helpers, theme variables, and test icons. | The implemented Generic workspace layout, scoped search, availability controls, Libraries grouping, and collapsed workspace options. | Real user notes, an Obsidian app capture, exact platform chrome/icon assets, or physical-device/VoiceOver/Sync evidence. |
| <code>workspace-desktop.png</code> | Historical real, sanitized desktop capture of the version-0.10.0 interface, cropped to the plugin workspace, 1320 × 650 pixels. | The optional ENT preset's Medications Library, tab navigation, grouped placeholder records, search field, and desktop density. | A current Generic-profile default, resolved medication notes, clinical approval, or comprehensive desktop testing. |
| <code>search-mobile.png</code> | Historical real, sanitized iPhone portrait capture of the version-0.10.0 interface, 1206 × 2622 pixels. | One portrait search state with the software keyboard visible, a live result count, compact rows, No note badges, and row action menus. | A current-build capture, a completed physical-iPhone release checklist, or verification of landscape, broad-query paging, destructive fresh-device recovery, the full touch import/export matrix, every Dynamic Type setting, or Android behavior. |

The screenshots contain no visible patient identifiers, private note bodies, credentials, local filesystem paths, or recovery data. The Generic preview uses invented research-note titles. Clinical terms visible in the historical captures are interface records, not patient information or medical advice.

These documentation assets are distributed with the repository under the
[MIT License](../../LICENSE). Obsidian names, interface elements, and trademarks
visible in real product captures remain the property of their respective
owners; this project is not endorsed by Obsidian.

## Required captions

When reused in project documentation:

- describe <code>hero.png</code> as abstract AI-generated artwork;
- label <code>how-it-works.svg</code> as a diagram rather than a screenshot;
- describe <code>generic-browser-desktop.png</code> as a production-renderer preview in a synthetic browser host, not a real Obsidian capture;
- describe the two older screenshots as historical real, sanitized version-0.10.0 captures;
- identify the desktop image as the optional ENT preset rather than a Generic default;
- link mobile claims to [the 0.10.0 iPhone evidence note](../release-evidence/0.10.0-iphone.md); and
- never convert the existence of a screenshot into a checklist pass or broader test claim.

## Suggested alt text

- <code>hero.png</code>: “Abstract illustration of interconnected knowledge cards.”
- <code>generic-browser-desktop.png</code>: “KBCC Generic workspace production renderer showing synthetic research notes, scoped search, and workspace options.”
- <code>workspace-desktop.png</code>: “Knowledge Base Command Center desktop view showing the Medications Library.”
- <code>search-mobile.png</code>: “Knowledge Base Command Center search results above the iPhone keyboard.”
- <code>how-it-works.svg</code>: “Diagram: an unchanged vault of Markdown notes on the left, and the plugin’s own data on the right holding the index, nested collections, libraries and queues.”

Do not replace the screenshots with generated mockups while continuing to label them as real captures.

## Reproducing the Generic preview

Run <code>npm run test:layout:install</code>, then set <code>KBCC_BROWSER_SCREENSHOT_DIR</code> to an absolute directory outside this repository and run <code>npm run test:layout</code>. The production-renderer tests capture desktop/mobile light/dark states and dialogs. The documentation image is an unchanged copy of <code>chromium-generic-desktop-light.png</code>; do not substitute a hand-written HTML recreation. Record a new capture date and candidate version whenever the image is refreshed.

## Adding more screenshots later

The page does not depend on further captures. If you do add one, put the PNG in this folder, add a provenance row above describing exactly what it shows and what it must not imply, and reference it from the README with a caption that matches that row. Never label a generated image as a real capture.
