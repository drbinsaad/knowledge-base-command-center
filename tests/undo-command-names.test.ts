import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// WF-12 (T7). Reads the command registrations in src/main.ts as text, so it
// needs no plugin instance. IDs are upgrade keys and must never change. The
// display names are applied later, when the main.ts change lands.

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

function displayNameOf(id: string): string {
  const match = new RegExp(`id: "${id}",\\s*name: "([^"]+)"`).exec(source);
  assert.ok(match, `command ${id} is registered with a display name`);
  return match[1];
}

const ids = ["undo-last-note-organizer-batch", "undo-personal-organization", "undo-last-quick-append"] as const;

test("WF-12 T7 the three Undo command IDs are exactly the baseline IDs", () => {
  for (const id of ids) {
    assert.equal(source.split(`id: "${id}",`).length - 1, 1, `${id} is registered exactly once`);
  }
  assert.ok(displayNameOf("undo-last-note-organizer-batch"));
  assert.ok(displayNameOf("undo-personal-organization"));
  assert.ok(displayNameOf("undo-last-quick-append"));
});

test("WF-12 T7 the three Undo display names are distinct", { todo: "WF-12 main labels pending" }, () => {
  const names = ids.map(displayNameOf);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 3, `names must be distinct: ${names.join(" | ")}`);
});

test("WF-12 T7 each Undo display name says its scope and promises no Markdown undo", { todo: "WF-12 main labels pending" }, () => {
  const organizer = displayNameOf("undo-last-note-organizer-batch");
  const organization = displayNameOf("undo-personal-organization");
  const quick = displayNameOf("undo-last-quick-append");
  assert.match(organizer, /organizer/i);
  assert.match(organizer, /all bases|every base|multi|bases/i, "multi-base Organizer Undo says it spans bases");
  assert.match(organization, /current (knowledge )?base/i, "organization Undo says current base");
  assert.match(organization, /organization/i);
  assert.match(quick, /quick append/i);
  assert.match(quick, /note|append/i);
  for (const name of [organizer, organization, quick]) {
    assert.doesNotMatch(name, /markdown/i, `${name}: no Markdown undo promise in a name`);
  }
});
