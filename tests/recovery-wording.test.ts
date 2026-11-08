import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REVIEW_KEPT_COPIES_ROUTE } from "../src/main.ts";

// A05/A08/W1 wording. The exact visible names must match the real entry.
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the kept-backup notices point to the real entry by its exact visible names", () => {
  assert.equal(
    REVIEW_KEPT_COPIES_ROUTE,
    "To review it, open Sync & recovery center and choose “Review kept copies…”. Keep the file; it is private and can hold exact paths.",
  );
  const main = read("src/main.ts");
  assert.equal(main.split("${REVIEW_KEPT_COPIES_ROUTE}").length - 1, 2, "both the missing-primary and the divergent-backup notices use it");
  const sync = read("src/sync-recovery-modal.ts");
  assert.match(sync, /"Review kept copies…"/);
  assert.match(sync, /"Kept copies"/);
  assert.match(sync, /this\.titleEl\.setText\("Sync & recovery center"\)/);
});

test("no source promises a restore the app cannot do", () => {
  for (const path of ["src/main.ts", "src/sync-recovery-modal.ts", "src/portability-modal.ts", "src/recovery-copy-modal.ts"]) {
    const text = read(path);
    assert.doesNotMatch(text, /or you restore from that file/, path);
    assert.doesNotMatch(text, /Keep that file and ask for help restoring/, path);
    assert.doesNotMatch(text, /cannot be imported through the Import center yet/, path);
  }
});

test("desktop export says the download started, not that it was saved; mobile confirms only after the write", () => {
  const modal = read("src/portability-modal.ts");
  assert.match(modal, /Export started: \$\{selectionCount\(selection\)\} selected sections were sent to your downloads\. This plugin cannot confirm the file was saved/);
  assert.doesNotMatch(modal, /new Notice\(`Exported \$\{selectionCount/);
  // The vault branch runs only after deliverJsonExport (which awaits writePortableJson) resolved.
  const vaultBranch = modal.indexOf('delivery.medium === "vault"');
  assert.ok(vaultBranch > modal.indexOf("await deliverJsonExport("));
  assert.match(modal, /Saved \$\{selectionCount\(selection\)\} selected sections inside the vault/);
});

test("per-base labels and the private-rescue disclosure are shown", () => {
  const modal = read("src/portability-modal.ts");
  assert.match(modal, /Each export covers this one knowledge base only, so back up every base you rely on/);
  assert.match(modal, /Automatic conflict rescues are fuller: they can also hold per-base view and Undo history, and Clear device-local data does not remove them/);
  assert.match(modal, /\$\{RESCUE_HISTORY_DISCLOSURE\}/);
  const sync = read("src/sync-recovery-modal.ts");
  assert.match(sync, /Each backup covers the active knowledge base only/);
  assert.match(sync, /per-base view and Undo history, and Clear device-local data does not remove them/);
});

test("the troubleshooting guide names the real entry and drops the old claims", () => {
  const guide = read("docs/TROUBLESHOOTING.md");
  assert.match(guide, /choose \*\*Review kept copies…\*\*/);
  assert.match(guide, /\*\*Choose another file\*\*/);
  assert.match(guide, /\*\*Export started\*\*/);
  assert.match(guide, /\*\*Clear device-local data\*\* does not remove it/);
  assert.doesNotMatch(guide, /It cannot be imported through the Import center yet/);
  assert.doesNotMatch(guide, /ask for help restoring it/);
});
