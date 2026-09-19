# Collections + Workflow Reliability candidate: native QA record

Historical pre-versioned implementation evidence. The later [0.24.0 release record](0.24.0-iphone.md) contains separate authorization and final validation; its compatibility fixes and runtime hashes supersede this candidate without rewriting these original observations.

- Date: 2026-09-19
- Status: **Native desktop smoke checks passed within the scope below; unpublished development candidate**
- Candidate identity: Collections + Workflow Reliability, based on commit `127cb4ba1b479938c711ceffeb08c2cef5366e90`, branch `codex/collections-workflow`
- Manifest version: `0.23.1` retained pending separate release preparation. This candidate is **not** the published 0.23.1 build; identify it by the hashes below.
- Native environment: Obsidian **1.14.2**, installer **1.13.7**, macOS desktop
- Disposable test vault: **KBCC Native QA icOeSK**, synthetic notes only, **no Sync configured**
- Native test execution: user explicitly approved enabling KBCC only in the disposable test vault. Real Obsidian commands, native UI, read-only state inspection, and file hashes were exercised. No product source changes were needed during this pass.
- Physical iPhone/iPad and controlled two-device Sync: **NOT VERIFIED — unexecuted**

This record adds candidate-specific native checks without changing the active versioned release checklist. No historical release waiver or previous device result carries forward. Preparing or completing these checks does not authorize publication, tagging, or installation into the main vault.

## Exact candidate assets

The checksums below were independently read from the existing candidate archive on 2026-09-19. The ZIP contains exactly `main.js`, `manifest.json`, and `styles.css`.

| Asset | SHA-256 |
| --- | --- |
| `main.js` | `000755628503673f7707fd6fa34406db6f800c7408b5995341d93e056666fdb1` |
| `manifest.json` | `5117bc7886339ed1846425e5b4f290554616e16295bfa959a721f5a7bd0d4320` |
| `styles.css` | `bf2adfc80d7211a9d9134e0f11a9ad47b81f072e4ae3a5a0f374f824d35b318b` |
| `kbcc-collections-workflow-candidate.zip` | `ffed735f702c701e2183fc986fa5306d5800fbccb791ba25a63935fd1ffd8d67` |
| `source-candidate.tar.gz` | `018298bbc5a7f45bb43e2e3e4ccac850574206f44309341dd09e61f292c494a5` |

The installed disposable-vault assets were verified identical to these candidate assets before and after execution. The source archive predates this supplemental QA record. If any runtime asset changes, record its new hashes and repeat applicable checks.

Synthetic Markdown baseline, recorded before plugin execution:

| Fixture | SHA-256 |
| --- | --- |
| `Alpha.md` | `b5deae8c226d88535375e93c4ff3f427a9f0ef4eb8c7ee1448486b42c004c4d2` |
| `Beta.md` | `99f26ce199a9708632e0c4288b4136d2990df3951c35c90c84d327a7fef7f895` |

## Existing automated and browser evidence

The candidate preparation run previously verified the following on Node **22.23.2**:

- **1,430 runtime tests**, including enforced coverage thresholds.
- **3 performance checks** and **10 release-integrity checks**.
- Typecheck, zero-warning lint/JSON validation, production build, bundle limits, and Community-oriented static checks.
- Dependency audit: **zero known vulnerabilities reported**.
- Full Chromium/WebKit browser matrix: **283 passing cases**.

Browser checks use a synthetic Obsidian host. They cover production renderers at desktop, phone/tablet, RTL, enlarged-text, rotation/split-width, and short keyboard-like sizes, but do not establish native Obsidian integration, physical-device behavior, or live two-device Sync. Interactive synthetic previews likewise remain supplemental evidence. These prior results are not a claim that the automated suites were rerun while drafting this record.

## Native desktop checks

Record observations only after exercising the actual candidate inside the disposable Obsidian vault. Before/after state receipts and synthetic screenshots remain outside the repository. Command IDs below use the stable `ent-vault-command-center:` prefix.

| Check | Required invariant | Result and observation |
| --- | --- | --- |
| Installed-build identity and startup | Installed assets match; view and commands load. | **Pass** — exact hashes matched, setup completed, plugin loaded after reload, and no captured renderer errors. |
| Real Collection picker | Native suggestions, keyboard selection, creation footer and dismissal work. | **Pass for exercised paths** — Enter added Alpha to existing Reading; **New collection** created Reference shelf while Reading existed and added Alpha automatically. Nested placement was independently tested through the subheading action below; exhaustive picker keyboard traversal remains unexecuted. |
| Inline drafts and cancellation | Collection/subheading drafts are not persisted by Review or Cancel. | **Pass** — Draft series / Chapter one was staged and reviewed, then discarded. Collections, semantic revision (4), and Undo labels were identical before/after. |
| Review, Save, and unchanged Done | Structure and membership commit together; collection-only changes preserve primary placement. | **Pass** — Study series / Chapter one saved with Alpha only in the nested destination and previous memberships retained. Reopen prefilled exact checkboxes. Unchanged **Done** closed with semantic revision (5) and Undo labels unchanged; no error. Direct persistence-call instrumentation was not used. |
| Undo/Redo and reload | Session batch and durable per-base history restore structure/memberships together. | **Pass** — session Undo removed Study series and its subheading/membership; Redo restored exact identities. After plugin reload, per-base Undo/Redo repeated this successfully. |
| Stale native file | A renamed source cannot apply an old review. | **Pass** — after reviewing Stale draft, Obsidian renamed Alpha. Save reported “Nothing was applied,” required refresh, and disabled Save. No Stale draft persisted. Draft was discarded; the fixture filename was restored. Native destination-deletion race was not separately exercised. |
| Collapsed populated destinations | Add/create actions target exact nested destination, expand it, and persist. | **Pass** — from collapsed, populated Chapter one, **Add notes here** added Beta; **Create note here** showed Study series / Chapter one and created exactly one Gamma note. Both appeared in the expanded destination and survived subsequent reload. Top-level collection actions were visible; this round-trip used a subheading. |
| Collection search and return | Scoped descendants and search filters survive note navigation. | **Pass for exercised route** — Study series search found all three nested notes. Query Beta + Linked notes + linked-first returned one result. Open note → saved KBCC page → Back preserved query, scope, availability and linked-first. Deleted-scope and cross-base cases retain automated coverage but were not repeated natively. |
| Native narrow/wide layout | Phone/tablet-sized native-emulation controls and scrolling remain usable. | **Pass for smoke scope** — 390×844 and 1180×820 had no document horizontal overflow; collection actions were 44px high. Phone scrolling retained tabs/search and reached inline creation fields. Review/Cancel/Done stayed within the viewport; tablet footer used one row. Review and Done were activated. Physical touch, software keyboard, exhaustive focus traversal and native phone Save were not executed. |
| Final integrity and renderer diagnostics | Existing synthetic Markdown remains byte-identical and no unintended files/errors remain. | **Pass** — Alpha/Beta hashes exactly match baseline; both retain no primary placement. Exactly three Markdown files remain (two fixtures plus intended Gamma). No discarded/stale collection, duplicate exact membership, or captured renderer/console error remained. Candidate asset hashes remained unchanged. |

The native host was restored to desktop mode at 1024×800, with temporary device metrics cleared. The candidate remains enabled only in this disposable vault. The main vault was not modified and nothing was published. Synthetic screenshots `native-phone-organizer.png`, `native-tablet-review.png`, and `native-tablet-collections.png` are retained in the local candidate-artifact directory, outside the repository. The Obsidian development skill guided runtime inspection and error checks.

Primary-placement preservation in this native pass used initially unplaced notes only. Preservation of an existing Index or Library placement has automated coverage but still needs its own native/physical-device observation; the pass above must not be read as that broader claim.

## Unverified physical-device and Sync scope

Actual iPhone/iPad portrait, landscape, Split View, software and hardware keyboard behavior, touch/Pencil/trackpad input, native safe areas, largest Dynamic Type, VoiceOver, Arabic/RTL on device, background/interruption, device performance, and controlled two-device Sync remain **NOT VERIFIED**. This synthetic desktop vault has no Sync configured, so it cannot establish delivery, concurrent changes, offline recovery, or cross-device persistence.

No physical-device row may be changed to Pass merely because a browser fixture or desktop-resized pane passed. Use a physical device and the exact candidate hashes for device results. Any skipped scope remains explicitly unverified, and a future publication decision requires fresh candidate-specific authorization rather than a historical waiver.

## Privacy and publication boundary

Use synthetic notes and local fixture images only. Do not include real note contents, recovery codes, patient information, credentials, `data.json`, recovery exports, absolute local paths, or private screenshots in this record or a commit. Ordinary Collection and organization operations must not move or rewrite source Markdown. Online-cover loading remains excluded.

This record does not change version metadata, declare a release ready, authorize a main-vault installation, or establish remote publication. Native observations and any remaining failures must be filled in before deciding the next release step.
