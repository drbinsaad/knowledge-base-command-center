import assert from "node:assert/strict";
import test from "node:test";
import { MAX_LAYOUT_DEPTH, MAX_TRANSFER_COLLECTIONS, migrateData, type LayoutSubheading } from "../src/model";
import { organizerCollectionStructureId, stageOrganizerCollectionCreations, validateOrganizerCollectionCreations, type OrganizerCollectionCreation } from "../src/note-organizer-collections";

const root: OrganizerCollectionCreation = { baseId: "base", id: "reading", title: "Reading", headingId: null, parentSubheadingId: null };

test("Collection drafts reject malformed, oversized, unsafe and duplicate identities", () => {
  assert.deepEqual(validateOrganizerCollectionCreations(undefined), []);
  assert.deepEqual(validateOrganizerCollectionCreations([root]), [root]);
  for (const value of [null, {}, Array.from({ length: 101 }, () => root), [null], [1], [root, root],
    [{ ...root, title: " " }], [{ ...root, title: "x".repeat(101) }], [{ ...root, title: "bad\nname" }],
    [{ ...root, id: "__proto__" }], [{ ...root, baseId: "" }], [{ ...root, headingId: 42 }],
    [{ ...root, parentSubheadingId: "missing-parent" }], [{ ...root, id: "x".repeat(201) }],
    [{ ...root, headingId: "root", parentSubheadingId: {} }],
  ]) assert.throws(() => validateOrganizerCollectionCreations(value));
});

test("Collection staging preserves nested breadcrumbs and canonical leaf representation", () => {
  const data = migrateData(null);
  data.collections = [];
  const child = { ...root, id: "books", title: " Books ", headingId: root.id };
  const leaf = { ...child, id: "week", title: "This week", parentSubheadingId: child.id };
  stageOrganizerCollectionCreations(data, [root, child, leaf]);
  assert.deepEqual(data.collections, [{ id: "reading", title: "Reading", collapsed: false, subjects: [], subheadings: [
    { id: "books", title: "Books", collapsed: false, subjects: [], subheadings: [{ id: "week", title: "This week", collapsed: false, subjects: [] }] },
  ] }]);
  assert.deepEqual(migrateData(data).collections, data.collections, "restart normalization retains every exact target");
});

test("existing Collection parent IDs retain legacy length and non-Latin identity", () => {
  const headingId = `مجموعة_${"x".repeat(4089)}`;
  assert.equal(headingId.length, 4096);
  const child = { ...root, id: "new-child", title: "New child", headingId, parentSubheadingId: "_favourites" };
  assert.deepEqual(validateOrganizerCollectionCreations([child]), [child]);
  assert.equal(organizerCollectionStructureId(headingId), headingId);
  for (const invalid of ["x".repeat(4097), "__proto__", "", "bad\nparent", null]) assert.throws(() => organizerCollectionStructureId(invalid), /invalid stable ID/u);
  const data = migrateData(null);
  data.collections = [{ id: headingId, title: "Reading", collapsed: false, subjects: [], subheadings: [{ id: "_favourites", title: "Favourites", collapsed: false, subjects: [] }] }];
  stageOrganizerCollectionCreations(data, [child]);
  assert.equal(data.collections[0].subheadings[0].subheadings?.[0].id, child.id);
});

test("Collection staging rejects sibling name collisions, missing parents, duplicate identities and nesting overflow", () => {
  const fresh = () => { const data = migrateData(null); data.collections = []; return data; };
  const child = { ...root, id: "books", title: "Books", headingId: root.id };
  for (const creations of [
    [root, root], [root, { ...root, id: "other", title: "READING" }], [child],
    [root, { ...child, parentSubheadingId: "missing" }],
    [root, child, { ...child, id: "duplicate-name", title: "books" }],
    [root, { ...root, id: "other", title: "Other" }, { ...child, parentSubheadingId: "other" }],
  ]) assert.throws(() => stageOrganizerCollectionCreations(fresh(), creations));
  const nested = [root];
  for (let index = 0; index < MAX_LAYOUT_DEPTH - 1; index += 1) nested.push({ ...child, id: `depth-${index}`, parentSubheadingId: index === 0 ? null : `depth-${index - 1}` });
  assert.doesNotThrow(() => stageOrganizerCollectionCreations(fresh(), nested), "five total levels including the Collection root are allowed");
  nested.push({ ...child, id: "depth-overflow", parentSubheadingId: `depth-${MAX_LAYOUT_DEPTH - 2}` });
  assert.throws(() => stageOrganizerCollectionCreations(fresh(), nested), /nesting limit/u);
  const ambiguous = fresh();
  ambiguous.collections = [{ id: root.id, title: root.title, collapsed: false, subjects: [], subheadings: [{ id: root.id, title: "Duplicate", collapsed: false, subjects: [] }] }];
  assert.throws(() => stageOrganizerCollectionCreations(ambiguous, [{ ...root, id: "new" }]), /ambiguous/u);
  assert.doesNotThrow(() => stageOrganizerCollectionCreations(ambiguous, []), "an unrelated no-creation operation does not add a new validation path");
  const full = fresh();
  full.collections = Array.from({ length: MAX_TRANSFER_COLLECTIONS }, (_, index) => ({ id: `h-${index}`, title: `Heading ${index}`, collapsed: false, subjects: [], subheadings: [] as LayoutSubheading[] }));
  assert.throws(() => stageOrganizerCollectionCreations(full, [root]), /size or nesting limit/u);
});
