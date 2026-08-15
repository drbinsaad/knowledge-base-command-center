import assert from "node:assert/strict";
import test from "node:test";
import {
  createVaultRenameJournal,
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
    vaultId: "vault-rename-journal",
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
