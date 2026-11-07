import assert from "node:assert/strict";
import test from "node:test";
import {
  createVaultRenameJournal,
  createVaultRenameJournalForScope,
  vaultRenameAppendFits,
  MAX_PENDING_VAULT_RENAMES,
  MAX_VAULT_RENAME_JOURNAL_BYTES,
  parseVaultRenameJournal,
  VAULT_RENAME_JOURNAL_VERSION,
} from "../src/vault-rename-journal.ts";

test("vault-rename journal preserves ordered file and folder rewrites", () => {
  const parsed = parseVaultRenameJournal(createVaultRenameJournal("vault-rename-journal", [
    { oldPath: "Notes/A.md", newPath: "Notes/B.md", folderRename: false },
    { oldPath: "Notes", newPath: "Archive/Notes", folderRename: true },
  ]));
  assert.deepEqual(parsed, {
    version: VAULT_RENAME_JOURNAL_VERSION,
    scope: { kind: "bound", vaultId: "vault-rename-journal" },
    blocked: null,
    renames: [
      { oldPath: "Notes/A.md", newPath: "Notes/B.md", folderRename: false },
      { oldPath: "Notes", newPath: "Archive/Notes", folderRename: true },
    ],
  });
});

test("vault-rename journal rejects malformed, unsafe, empty, and oversized recovery authority", () => {
  const entry = { oldPath: "Notes/A.md", newPath: "Notes/B.md", folderRename: false };
  for (const malformed of [
    null,
    {},
    { version: 2, vaultId: "vault-journal", renames: [entry] },
    { version: 1, vaultId: "vault-journal", renames: [entry], ignored: true },
    { version: 1, vaultId: "vault-journal", renames: [] },
    { version: 1, vaultId: "../other", renames: [entry] },
    { version: 1, vaultId: "vault-journal", renames: [{ ...entry, oldPath: "../A.md" }] },
    { version: 1, vaultId: "vault-journal", renames: [{ ...entry, newPath: entry.oldPath }] },
    { version: 1, vaultId: "vault-journal", renames: [{ ...entry, folderRename: "no" }] },
    { version: 1, vaultId: "vault-journal", renames: [{ ...entry, ignored: true }] },
    { version: 1, vaultId: "vault-journal", renames: Array.from({ length: MAX_PENDING_VAULT_RENAMES + 1 }, () => entry) },
    {
      version: 1,
      vaultId: "vault-journal",
      renames: [entry],
      padding: "x".repeat(MAX_VAULT_RENAME_JOURNAL_BYTES),
    },
  ]) {
    assert.throws(() => parseVaultRenameJournal(malformed));
  }
});

const ENTRY = { oldPath: "Notes/A.md", newPath: "Notes/B.md", folderRename: false };

test("a genuine v1 envelope reads as a bound v2 journal without being relabeled", () => {
  const parsed = parseVaultRenameJournal({ version: 1, vaultId: "vault-fresh-aaaaaaaaaaaa", renames: [ENTRY] });
  assert.deepEqual(parsed.scope, { kind: "bound", vaultId: "vault-fresh-aaaaaaaaaaaa" });
  assert.equal(parsed.blocked, null);
});

test("v2 scopes are exact, discriminated and bounded", () => {
  const bootstrap = { kind: "bootstrap", bootstrapId: "bootstrap-1", expectedVaultId: null };
  const ok = parseVaultRenameJournal({ version: 2, scope: bootstrap, renames: [ENTRY], blocked: null });
  assert.deepEqual(ok.scope, bootstrap);
  assert.equal(parseVaultRenameJournal({ version: 2, scope: { ...bootstrap, expectedVaultId: "vault-known" }, renames: [ENTRY], blocked: "ambiguous-path" }).blocked, "ambiguous-path");
  // An empty prefix is valid only when a blocked marker explains it.
  assert.equal(parseVaultRenameJournal({ version: 2, scope: bootstrap, renames: [], blocked: "overflow" }).renames.length, 0);
  for (const bad of [
    { version: 2, scope: bootstrap, renames: [], blocked: null },
    { version: 2, scope: bootstrap, renames: [ENTRY] },
    { version: 2, scope: bootstrap, renames: [ENTRY], blocked: "other" },
    { version: 2, scope: { kind: "bootstrap", bootstrapId: "bootstrap-1" }, renames: [ENTRY], blocked: null },
    { version: 2, scope: { kind: "bound", vaultId: "v", extra: 1 }, renames: [ENTRY], blocked: null },
    { version: 2, scope: { kind: "other", vaultId: "v" }, renames: [ENTRY], blocked: null },
    { version: 3, scope: bootstrap, renames: [ENTRY], blocked: null },
    { version: 2, scope: bootstrap, renames: [ENTRY], blocked: null, ignored: true },
  ]) {
    assert.throws(() => parseVaultRenameJournal(bad));
  }
});

test("append bounds are checked before anything is added, with room kept for a blocked marker", () => {
  const scope = { kind: "bound", vaultId: "vault-bounds" } as const;
  const full = Array.from({ length: MAX_PENDING_VAULT_RENAMES }, () => ENTRY);
  assert.equal(vaultRenameAppendFits(scope, full.slice(0, MAX_PENDING_VAULT_RENAMES - 1), ENTRY), true);
  assert.equal(vaultRenameAppendFits(scope, full, ENTRY), false);
  const wide = { oldPath: `${"x".repeat(4000)}.md`, newPath: `${"y".repeat(4000)}.md`, folderRename: false };
  let renames: typeof full = [];
  while (vaultRenameAppendFits(scope, renames, wide)) renames = [...renames, wide];
  assert.ok(renames.length > 0 && renames.length < MAX_PENDING_VAULT_RENAMES);
  // The accepted prefix plus a blocked marker still parses within the byte bound.
  assert.doesNotThrow(() => createVaultRenameJournalForScope(scope, renames, "overflow"));
});
