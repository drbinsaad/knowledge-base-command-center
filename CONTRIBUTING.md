# Contributing

Thank you for helping improve Knowledge Base Command Center.

By participating, follow the [Code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through [Security](SECURITY.md), not a public issue.

## Before starting

Search existing issues. Use the Feature request form for substantial behavior, data-model, Sync, migration, or UI changes so the approach and compatibility boundary can be discussed first.

Small, focused fixes can go directly to a pull request when their scope is clear.

## Development requirements

- Node.js 22
- npm using the committed <code>package-lock.json</code>
- Obsidian 1.13.0 or newer for manual integration testing
- A disposable synthetic vault for UI, import/export, and mobile checks

Install dependencies:

~~~bash
npm ci
npm run test:layout:install
~~~

The second command installs the local Chromium binary used only by the rendered-layout regression suite. CI installs it automatically.

Run the complete local gate:

~~~bash
npm run check
~~~

The check task runs strict typechecking, zero-warning lint and JSON validation, automatically discovered runtime tests with core/UI coverage thresholds, the large-vault performance budget, a production build and bundle-size budget, Community-oriented static checks, release verification, and real-Chromium row-geometry tests.

## Repository map

- <code>src/main.ts</code>: plugin lifecycle, commands, storage, Sync, and guarded mutations.
- <code>src/view.ts</code>: main Command Center, search, Index, Libraries, Collections, queues, and inspector.
- <code>src/bases-view.ts</code>: the configurable, bounded custom view for Obsidian <code>.base</code> query results.
- <code>src/index-manager.ts</code>: bulk membership, group, and diagnostic workflows.
- <code>src/knowledge-base-modal.ts</code>: knowledge-base creation and lifecycle.
- <code>src/library-modal.ts</code>: Library creation and lifecycle.
- <code>src/portability-modal.ts</code> and <code>src/portability.ts</code>: export, import, validation, and recovery.
- <code>src/model.ts</code> and <code>src/store-merge.ts</code>: schemas, migration, normalization, and Sync reconciliation.
- <code>tests/</code>: model, lifecycle, rendered UI, real-browser layout, mobile DOM, release, performance, and store-merge coverage.
- <code>docs/</code>: user guidance, release evidence, and privacy-sensitive operating procedures.

## Non-negotiable boundaries

1. Keep the Generic profile independent of the optional ENT clinical preset.
2. Preserve the stable plugin ID <code>ent-vault-command-center</code>; it is an upgrade compatibility key.
3. Ordinary Index, Library, Collection, and visual-organization actions must not move or rewrite Markdown notes.
4. Preserve mobile compatibility. Runtime code must not depend on Node.js, Electron, or desktop-only APIs.
5. Do not add analytics, telemetry, advertising, accounts, or network requests without an explicit public design and privacy review.
6. Unrecognized or newer plugin data must fail read-only rather than being downgraded or overwritten.
7. Never include a real vault, note content, <code>data.json</code>, recovery export, local absolute path, patient information, credentials, or copyrighted source text in a fixture, screenshot, issue, or commit.

## Make the change

- Keep the patch focused and preserve unrelated behavior.
- Add or update tests for user-visible behavior, migrations, validation, rollback, and regression risks.
- Treat imported and synced data as untrusted input.
- Bound list sizes, hierarchy depth, history, file size, and expensive rendering paths.
- Preserve Undo or rollback before any destructive plugin-state mutation.
- Update README, user guides, troubleshooting, security, or changelog when the public contract changes.
- Do not hand-edit generated <code>main.js</code> or files under <code>dist/</code>.

## UI and mobile changes

Use synthetic data and test both pointer and keyboard behavior. Preserve semantic labels, focus, text direction, 44-point touch targets, safe areas, software-keyboard reachability, and meaningful empty states.

Automated DOM checks do not replace a real iPhone for WebKit viewport, software keyboard, landscape, Dynamic Type, safe-area, and performance behavior. If a change affects search, navigation, modals, import/export, Sync handling, or mobile styles, complete every applicable item in [the physical-iPhone checklist](docs/manual-iphone-release-checklist.md) or explicitly record any skipped scope as unverified.

Screenshots must follow [asset provenance and privacy rules](docs/assets/README.md). Never turn a screenshot into a broader test claim.

## Pull request expectations

A pull request should include:

- the user problem and user-visible outcome;
- linked issue or an explanation of why one is unnecessary;
- data-schema, migration, Sync, privacy, and rollback impact;
- desktop and mobile implications;
- tests added or updated;
- exact validation commands and results;
- sanitized screenshots for meaningful UI changes; and
- physical-device evidence or an explicit not-applicable/unverified statement.

Keep release version changes separate unless the maintainer requested a release. Only maintainers tag and publish releases.
