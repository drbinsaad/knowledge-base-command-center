import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { LIBRARY_ICON_IDS } from "../src/main.ts";
import * as libraryIcons from "../src/library-icons.ts";
import * as leaf from "../src/library-form-modals.ts";
import * as libraryModal from "../src/library-modal.ts";
import * as settingsModal from "../src/library-settings-modal.ts";

const srcRoot = path.resolve(import.meta.dirname, "..", "src");

/** Runtime (non type-only) relative imports and re-exports of one source file. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(path.join(srcRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  for (const statement of source.statements) {
    let specifier: ts.Expression | undefined;
    let erased = false;
    if (ts.isImportDeclaration(statement)) {
      specifier = statement.moduleSpecifier;
      const clause = statement.importClause;
      if (clause) {
        erased = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
        if (!erased && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          erased = clause.namedBindings.elements.every((element) => element.isTypeOnly);
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      specifier = statement.moduleSpecifier;
      erased = statement.isTypeOnly
        || Boolean(statement.exportClause && ts.isNamedExports(statement.exportClause)
          && statement.exportClause.elements.every((element) => element.isTypeOnly));
    }
    if (!specifier || erased || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
    found.push(`${path.basename(specifier.text).replace(/\.ts$/, "")}.ts`);
  }
  return found;
}

function reachable(start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const next of runtimeImports(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

test("library-modal re-exports the moved classes with the same identity as the leaf", () => {
  assert.equal(libraryModal.LibraryEditorModal, leaf.LibraryEditorModal);
  assert.equal(libraryModal.DeleteArchivedLibraryModal, leaf.DeleteArchivedLibraryModal);
  assert.equal(typeof libraryModal.ManageLibrariesModal, "function");
  assert.equal(typeof settingsModal.LibrarySettingsModal, "function");
});

test("library-modal and library-settings-modal are no longer a runtime import cycle", () => {
  const modalImports = runtimeImports("library-modal.ts");
  const settingsImports = runtimeImports("library-settings-modal.ts");
  assert.ok(modalImports.includes("library-settings-modal.ts"), "the manager still opens the settings modal");
  assert.ok(modalImports.includes("library-form-modals.ts"), "the manager imports the leaf directly");
  assert.ok(settingsImports.includes("library-form-modals.ts"), "the settings modal imports the leaf directly");
  assert.ok(!settingsImports.includes("library-modal.ts"), "settings modal must not import library-modal at runtime");
  assert.ok(!reachable("library-settings-modal.ts").has("library-modal.ts"), "no runtime path back to library-modal");
});

test("the library form leaf has no runtime import of main, library-modal or library-settings-modal", () => {
  const leafImports = runtimeImports("library-form-modals.ts");
  assert.ok(leafImports.length > 0, "the check must see the leaf's real runtime imports");
  const closure = reachable("library-form-modals.ts");
  for (const forbidden of ["main.ts", "library-modal.ts", "library-settings-modal.ts"]) {
    assert.ok(!leafImports.includes(forbidden), `leaf must not import ${forbidden} at runtime`);
    assert.ok(!closure.has(forbidden), `leaf must not reach ${forbidden} at runtime`);
  }
});

test("main re-exports the canonical library-icons tuple (same object, same 20 IDs in order)", () => {
  assert.equal(LIBRARY_ICON_IDS, libraryIcons.LIBRARY_ICON_IDS);
  assert.deepEqual([...LIBRARY_ICON_IDS], [
    "library", "book-open", "book-copy", "folder", "folders", "bookmark", "archive",
    "clipboard-list", "pill", "dna", "stethoscope", "heart-pulse", "brain", "microscope",
    "flask-conical", "syringe", "activity", "graduation-cap", "file-text", "notebook-tabs",
  ]);
  assert.equal(libraryIcons.LIBRARY_ICON_IDS.length, 20);
  assert.equal("LIBRARY_FORM_ICON_IDS" in leaf, false, "the temporary leaf copy is gone");
});
