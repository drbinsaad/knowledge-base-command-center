# Contributing

Thank you for helping improve Knowledge Base Command Center.

## Before opening a pull request

1. Open an issue for substantial behavior or data-model changes so the approach can be discussed first.
2. Keep the generic knowledge-base profile independent of the optional ENT clinical preset.
3. Preserve mobile compatibility and avoid Node.js, Electron, and desktop-only APIs in runtime code.
4. Never include a real vault, note content, `data.json`, or other personal information in a report, fixture, screenshot, or commit.
5. Run `npm ci`, `npm test`, and `npm run build`.

Pull requests should explain the user-visible change, data-migration impact, mobile considerations, and the validation performed.
