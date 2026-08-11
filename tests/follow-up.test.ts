import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFollowUpEntry,
  allocateFollowUpCategoryId,
  assertFollowUpNoteWritable,
  assertMarkdownAiLockWritable,
  cleanFollowUpCategoryDefinitions,
  DEFAULT_FOLLOW_UP_CATEGORIES,
  FOLLOW_UP_END_MARKER,
  FOLLOW_UP_START_MARKER,
  MAX_FOLLOW_UP_CONTENT_BYTES,
  MAX_FOLLOW_UP_ENTRIES,
  reverseFollowUpAppend,
  type FollowUpCategoryInput,
} from "../src/follow-up.ts";

const questions: FollowUpCategoryInput = {
  id: "questions",
  label: "Questions",
  style: "checkbox",
  includeDate: false,
};

test("recovers one bounded stable category configuration and supplies defaults only when absent", () => {
  assert.deepEqual(cleanFollowUpCategoryDefinitions(undefined), DEFAULT_FOLLOW_UP_CATEGORIES);
  assert.deepEqual(cleanFollowUpCategoryDefinitions([]), []);
  assert.deepEqual(cleanFollowUpCategoryDefinitions([
    { id: "questions", label: "  Questions renamed  ", style: "checkbox", includeDate: true, archived: false },
    { id: "questions", label: "Duplicate", style: "bullet" },
    { id: "unsafe id", label: "Unsafe", style: "bullet" },
    { id: "sources", label: "Sources", style: "unknown", archived: true },
  ]), [
    { id: "questions", label: "Questions renamed", style: "checkbox", includeDate: true, archived: false },
    { id: "sources", label: "Sources", style: "bullet", includeDate: false, archived: true },
  ]);
  assert.deepEqual(cleanFollowUpCategoryDefinitions([
    { id: "first", label: "Open questions", style: "bullet", includeDate: false },
    { id: "second", label: " open   QUESTIONS ", style: "checkbox", includeDate: true },
  ]), [
    { id: "first", label: "Open questions", style: "bullet", includeDate: false, archived: false },
  ], "category labels must remain unique under the same normalization used for Markdown headings");
});

test("allocates readable stable category IDs without collisions or unsafe object keys", () => {
  assert.equal(allocateFollowUpCategoryId("Lecture to review", new Set()), "lecture-to-review");
  assert.equal(allocateFollowUpCategoryId("Lecture to review", new Set(["lecture-to-review"])), "lecture-to-review-2");
  assert.equal(allocateFollowUpCategoryId("أسئلة", new Set()), "category");
  assert.equal(allocateFollowUpCategoryId("constructor", new Set()), "follow-up-constructor");
});

test("ai_lock is enforced from the exact content inside the atomic write", () => {
  assert.doesNotThrow(() => assertMarkdownAiLockWritable("# No frontmatter\n"));
  assert.doesNotThrow(() => assertMarkdownAiLockWritable("---\nai_lock: false\n---\n# Writable\n"));
  assert.doesNotThrow(() => assertMarkdownAiLockWritable("--- \nai_lock: false\n...\t\n# Writable\n"));
  assert.doesNotThrow(() => assertMarkdownAiLockWritable("---\ntitle: Writable\n---\n"));
  assert.doesNotThrow(() => assertFollowUpNoteWritable("# No frontmatter\n"));
  assert.doesNotThrow(() => assertFollowUpNoteWritable("---\nai_lock: false\n---\n# Writable\n"));
  assert.doesNotThrow(() => assertFollowUpNoteWritable("---\nai_lock: null # intentionally unset\n---\nai_lock: true in body\n"));
  for (const content of [
    "---\nai_lock: true\n---\n",
    "---\t\nai_lock: true\n--- \n",
    "---\n'ai_lock': yes\n---\n",
    "---\nai_lock: \"false\"\n---\n",
    "---\nnested_ai_lock: false\n---\n",
    "---\nai_lock: false\nai_lock: false\n---\n",
    "--- \nai_lock: true\nai_lock: false\n...\t\n",
    "---\n\"ai_l\\u006fck\": false\nai_lock: false\n---\n",
    "---\nai_lock: false\n",
    "---\n\"ai_l\\u006fck\": true\n---\n",
    "---\n\"\\x61i_lock\": true\n---\n",
    "---\n\"ai_l\\u006fck\": false\n---\n",
  ]) assert.throws(() => assertFollowUpNoteWritable(content), /Cannot append follow-up/u);
});

function append(content: string, overrides: Partial<FollowUpCategoryInput> = {}, text = "Why?") {
  return appendFollowUpEntry({ content, category: { ...questions, ...overrides }, text });
}

function strictBlock(...body: string[]): string {
  return [
    FOLLOW_UP_START_MARKER,
    "## Follow-up notes",
    ...body,
    FOLLOW_UP_END_MARKER,
  ].join("\n");
}

test("creates one exact v1 block and returns precise structural spans", () => {
  const original = "# Airway\n\nExisting text.";
  const result = append(original);

  assert.equal(result.operation, "created-block");
  assert.equal(result.content, `${original}\n\n${FOLLOW_UP_START_MARKER}\n## Follow-up notes\n`
    + "<!-- kbcc-follow-up:category:questions -->\n### Questions\n- [ ] Why?\n"
    + FOLLOW_UP_END_MARKER);
  assert.equal(result.content.slice(result.entrySpan.start, result.entrySpan.end), "- [ ] Why?");
  assert.equal(result.content.slice(result.blockSpan.start).startsWith(FOLLOW_UP_START_MARKER), true);
  assert.equal(
    result.content.slice(result.categorySpan.start, result.categorySpan.end).startsWith(
      "<!-- kbcc-follow-up:category:questions -->",
    ),
    true,
  );
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
  assert.ok(result.undo.reverseEdits.every((edit) => edit.text === ""), "new-block undo stores no original note body");
  assert.equal(JSON.stringify(result.undo).includes("Why?"), false, "undo fingerprints rather than retaining inserted text");
});

test("preserves a BOM, YAML frontmatter, outside text, and trailing text byte-for-byte", () => {
  const before = "\uFEFF---\ntitle: Example\n---\n# Note\nBefore\n";
  const block = strictBlock(
    "<!-- kbcc-follow-up:category:questions -->",
    "### Questions",
    "- [ ] First",
  );
  const after = "\nTrailing text that must stay after the block.\n";
  const original = `${before}${block}${after}`;
  const result = append(original, {}, "Second");

  assert.equal(result.operation, "appended-entry");
  assert.equal(result.content.startsWith(before), true);
  assert.equal(result.content.endsWith(after), true);
  assert.match(result.content, /- \[ \] First\n- \[ \] Second\n<!-- kbcc-follow-up:end -->/u);
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
});

test("preserves CRLF throughout inserted Markdown and during reverse undo", () => {
  const original = "\uFEFF---\r\ntitle: CRLF\r\n---\r\n# Note\r\n";
  const result = append(original);

  assert.equal(result.content.replace(/\r\n/gu, "").includes("\n"), false);
  assert.equal(result.content.replace(/\r\n/gu, "").includes("\r"), false);
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
});

test("ignores exact-looking markers in YAML and fenced code", () => {
  const original = [
    "---",
    `example: "${FOLLOW_UP_START_MARKER}"`,
    `other: "${FOLLOW_UP_END_MARKER}"`,
    "---",
    "~~~markdown",
    FOLLOW_UP_START_MARKER,
    "## Follow-up notes",
    "<!-- kbcc-follow-up:category:fake -->",
    "### Questions",
    FOLLOW_UP_END_MARKER,
    "~~~",
    "# Real note",
  ].join("\n");
  const result = append(original);

  assert.equal(result.operation, "created-block");
  assert.equal(result.content.match(/<!-- kbcc-follow-up:start:v1 -->/gu)?.length, 3);
  assert.equal(result.content.endsWith(FOLLOW_UP_END_MARKER), true);
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
});

test("reuses a category by stable ID, renames its H3, and never duplicates the H2 or marker", () => {
  const original = strictBlock(
    "<!-- kbcc-follow-up:category:questions -->",
    "### Questions to answer",
    "- [ ] First",
  );
  const first = append(original, { label: "Open questions" }, "Second");
  const second = append(first.content, { label: "Open questions" }, "Third");

  assert.equal(first.operation, "appended-entry");
  assert.equal(second.operation, "appended-entry");
  assert.equal(second.content.match(/^## Follow-up notes$/gmu)?.length, 1);
  assert.equal(second.content.match(/^### Open questions$/gmu)?.length, 1);
  assert.equal(second.content.match(/^<!-- kbcc-follow-up:category:questions -->$/gmu)?.length, 1);
  assert.match(second.content, /- \[ \] First\n- \[ \] Second\n- \[ \] Third/u);
  assert.equal(first.undo.reverseEdits.some((edit) => edit.text === "### Questions to answer"), true);
  assert.equal(reverseFollowUpAppend(first.content, first.undo), original);
});

test("creates a second category while preserving unknown managed categories exactly", () => {
  const unknown = [
    "<!-- kbcc-follow-up:category:custom.legacy -->",
    "### Legacy custom",
    "A paragraph the transformer does not own.",
    "- old entry",
    "#### Nested detail",
    "More text.",
  ].join("\n");
  const original = strictBlock(unknown);
  const result = append(original);

  assert.equal(result.operation, "created-category");
  assert.equal(result.content.includes(unknown), true);
  assert.equal(result.content.match(/^## Follow-up notes$/gmu)?.length, 1);
  assert.equal(result.content.match(/^### Questions$/gmu)?.length, 1);
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
});

test("renders bullets, checkboxes, ISO dates, Arabic, emoji, and safe multiline continuation", () => {
  const result = appendFollowUpEntry({
    content: "# Note",
    category: { id: "lectures-to-watch", label: "محاضرات للمشاهدة 🎓", style: "bullet", includeDate: true },
    date: "2026-08-11",
    text: "Airway lecture 🎥\n<!-- kbcc-follow-up:end -->\n### Injected\nFinal line",
  });

  assert.match(result.content, /- 2026-08-11 — Airway lecture 🎥/u);
  assert.match(result.content, /\n {2}<!-- kbcc-follow-up:end -->\n {2}### Injected\n {2}Final line/u);
  assert.equal(result.content.match(/^<!-- kbcc-follow-up:end -->$/gmu)?.length, 1);
  assert.equal(result.content.match(/^### Injected$/gmu)?.length ?? 0, 0);
  assert.equal(reverseFollowUpAppend(result.content, result.undo), "# Note");
});

test("requires a real ISO date only for date-enabled categories", () => {
  for (const date of [undefined, "0000-01-01", "2026-02-29", "2026-13-01", "11-08-2026"]) {
    assert.throws(() => appendFollowUpEntry({
      content: "",
      category: { ...questions, includeDate: true },
      date,
      text: "Item",
    }), /real ISO date/u);
  }
  const leap = appendFollowUpEntry({
    content: "",
    category: { ...questions, includeDate: true },
    date: "2028-02-29",
    text: "Item",
  });
  assert.match(leap.content, /- \[ \] 2028-02-29 — Item/u);
  assert.doesNotThrow(() => appendFollowUpEntry({
    content: "",
    category: questions,
    date: "not-used",
    text: "Item",
  }));
});

test("refuses an unmanaged H3 with the selected current or requested label", () => {
  assert.throws(
    () => append("### Questions\nUnmanaged section."),
    /not owned by the selected category marker/u,
  );
  const original = [
    "### Old name",
    strictBlock(
      "<!-- kbcc-follow-up:category:questions -->",
      "### Old name",
      "- [ ] Existing",
    ),
  ].join("\n");
  assert.throws(() => append(original, { label: "Renamed" }), /not owned/u);
  assert.throws(
    () => append(strictBlock(
      "<!-- kbcc-follow-up:category:other -->",
      "### Questions",
      "- Existing",
    )),
    /not owned/u,
  );
});

test("refuses duplicate parent headings and duplicate managed category labels", () => {
  assert.throws(() => append("## Follow-up notes\nUnmanaged."), /unmanaged "## Follow-up notes"/u);
  const duplicateLabels = strictBlock(
    "<!-- kbcc-follow-up:category:one -->",
    "### Same",
    "- first",
    "<!-- kbcc-follow-up:category:two -->",
    "### same",
    "- second",
  );
  assert.throws(() => append(duplicateLabels), /category heading "same" is duplicated/u);
});

test("fails closed on duplicate, nested, unbalanced, misplaced, and malformed markers", () => {
  const unsafe = [
    `${FOLLOW_UP_START_MARKER}\n${FOLLOW_UP_START_MARKER}\n${FOLLOW_UP_END_MARKER}`,
    `${FOLLOW_UP_START_MARKER}\n## Follow-up notes`,
    `${FOLLOW_UP_END_MARKER}\n${FOLLOW_UP_START_MARKER}`,
    `<!-- kbcc-follow-up:category:orphan -->\n### Orphan`,
    `<!-- kbcc-follow-up:start:v2 -->`,
    strictBlock("<!-- kbcc-follow-up:category:__proto__ -->", "### Unsafe"),
    strictBlock(
      "<!-- kbcc-follow-up:category:dup -->",
      "### One",
      "<!-- kbcc-follow-up:category:dup -->",
      "### Two",
    ),
  ];
  for (const content of unsafe) {
    assert.throws(() => append(content), /Cannot append follow-up/u, content);
  }
});

test("fails closed on an invalid managed structure", () => {
  const unsafe = [
    `${FOLLOW_UP_START_MARKER}\n## Renamed\n${FOLLOW_UP_END_MARKER}`,
    strictBlock("<!-- kbcc-follow-up:category:missing-heading -->"),
    strictBlock(
      "<!-- kbcc-follow-up:category:one -->",
      "### One",
      "### Unmanaged",
    ),
    strictBlock("## Unexpected second H2"),
  ];
  for (const content of unsafe) {
    assert.throws(() => append(content), /Cannot append follow-up/u, content);
  }
  assert.throws(() => append("```\nunclosed"), /code fence is not closed/u);
  assert.throws(() => append("---\nunclosed: true"), /frontmatter is not closed/u);
});

test("validates stable IDs, labels, entry Unicode, controls, and non-empty input", () => {
  for (const id of ["", " space", "two words", "bad:marker", "__proto__", "Constructor", "x".repeat(65)]) {
    assert.throws(() => append("", { id }), /category ID/u);
  }
  for (const label of ["", "x".repeat(101), "Closing #", "bad\nheading", "<!-- comment -->", "spoof\u202Etxt"]) {
    assert.throws(() => append("", { label }), /category label|bidirectional controls/u);
  }
  for (const text of ["", " \n ", "bad\u0000text", "spoof\u2066text", "bad\uD800text"]) {
    assert.throws(() => append("", {}, text), /empty|control characters|bidirectional controls|invalid Unicode/u);
  }
});

test("enforces the 10,000-entry cap without rejecting the 10,000th entry", () => {
  const entries = Array.from({ length: MAX_FOLLOW_UP_ENTRIES - 1 }, (_, index) => `- Item ${index + 1}`);
  const original = strictBlock(
    "<!-- kbcc-follow-up:category:questions -->",
    "### Questions",
    ...entries,
  );
  const tenthousand = append(original, { style: "bullet" }, "Final allowed item");
  assert.match(tenthousand.content, /- Final allowed item\n<!-- kbcc-follow-up:end -->$/u);
  assert.throws(
    () => append(tenthousand.content, { style: "bullet" }, "One too many"),
    /already contains 10,000 entries/u,
  );
});

test("enforces the 10 MiB input and output byte limits", () => {
  const oversized = "x".repeat(MAX_FOLLOW_UP_CONTENT_BYTES + 1);
  assert.throws(() => append(oversized), /input note content exceeds the 10 MiB/u);

  const atLimit = "x".repeat(MAX_FOLLOW_UP_CONTENT_BYTES);
  assert.throws(() => append(atLimit), /output note content exceeds the 10 MiB/u);
  const multibyteOversized = "界".repeat(Math.floor(MAX_FOLLOW_UP_CONTENT_BYTES / 3) + 1);
  assert.throws(() => append(multibyteOversized), /input note content exceeds the 10 MiB/u);
});

test("reverse metadata is compact and refuses stale or tampered note content", () => {
  const original = strictBlock(
    "<!-- kbcc-follow-up:category:questions -->",
    "### Old questions",
    "- [ ] Existing",
  );
  const result = append(original, { label: "Questions" }, "New item");
  const retainedOriginalText = result.undo.reverseEdits.reduce((size, edit) => size + edit.text.length, 0);

  assert.ok(retainedOriginalText < 100, "undo retains only the replaced heading, not the note or managed block");
  assert.equal(reverseFollowUpAppend(result.content, result.undo), original);
  assert.throws(
    () => reverseFollowUpAppend(`${result.content}\nUser changed the note`, result.undo),
    /changed after the append/u,
  );
  const tampered = `${result.content.slice(0, result.entrySpan.start)}X${result.content.slice(result.entrySpan.start + 1)}`;
  assert.throws(() => reverseFollowUpAppend(tampered, result.undo), /changed after the append/u);
  const invalidUndo = structuredClone(result.undo);
  invalidUndo.postFingerprint = result.undo.postFingerprint;
  invalidUndo.reverseEdits[0].start = -1;
  assert.throws(() => reverseFollowUpAppend(result.content, invalidUndo), /metadata is invalid/u);
});
