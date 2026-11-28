import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_LIBRARY_IDS, LIBRARY_KINDS } from "../src/model.ts";
import {
  COMPLETE_PORTABLE_SELECTION,
  completePortableSelection,
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  selectionWithLibraryIds,
} from "../src/portability.ts";

const PROCEDURE = BUILTIN_LIBRARY_IDS.procedure;
const MEDICATION = BUILTIN_LIBRARY_IDS.medication;
const SYNDROME = BUILTIN_LIBRARY_IDS.syndrome;
const ALL = LIBRARY_KINDS.map((kind) => BUILTIN_LIBRARY_IDS[kind]);

test("a built-in library that is deselected stays deselected", () => {
  const complete = completePortableSelection(ALL);
  assert.deepEqual(selectionWithLibraryIds(complete, [PROCEDURE, SYNDROME]).libraryIds, [PROCEDURE, SYNDROME]);
  assert.deepEqual(selectionWithLibraryIds(complete, []).libraryIds, []);
  // The raw complete selection still carries the old per-library flags; they must not bring a library back.
  assert.deepEqual(selectionWithLibraryIds(COMPLETE_PORTABLE_SELECTION, [MEDICATION]).libraryIds, [MEDICATION]);
  assert.deepEqual(selectionWithLibraryIds(COMPLETE_PORTABLE_SELECTION, []).libraryIds, []);
});

test("selectionWithLibraryIds keeps the other components and can select a library again", () => {
  const start = normalizePortableSelection({ ...EMPTY_PORTABLE_SELECTION, index: true, collections: true });
  const next = selectionWithLibraryIds(start, [MEDICATION]);
  assert.equal(next.index, true);
  assert.equal(next.collections, true);
  assert.equal(next.workspace, false);
  assert.deepEqual(next.libraryIds, [MEDICATION]);
  assert.deepEqual(selectionWithLibraryIds(next, [MEDICATION, SYNDROME]).libraryIds, [MEDICATION, SYNDROME]);
  assert.throws(() => selectionWithLibraryIds(start, ["Not A Library Id!"]), /invalid stable ID/);
});
