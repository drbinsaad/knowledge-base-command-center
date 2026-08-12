import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attachmentFileName,
  attachmentPathCandidate,
  canonicalAttachmentFolder,
  insertAttachmentReference,
  noteAttachmentFolder,
} from "../src/attachment";
import { attachmentSubmitReady } from "../src/attachment-modal";

test("Ask each time requires an explicit destination after file selection", () => {
  assert.equal(attachmentSubmitReady(false, "ask", false), false);
  assert.equal(attachmentSubmitReady(true, "ask", false), false);
  assert.equal(attachmentSubmitReady(true, "ask", true), true);
  assert.equal(attachmentSubmitReady(true, "fixed-folder", false), true);
});

test("attachment references append in one marker-owned section", () => {
  const first = insertAttachmentReference("# Topic\n", "![[one.png]]", "marker", "<!-- kbcc:attachments -->", "Attachments");
  const second = insertAttachmentReference(first, "![[two.png]]", "marker", "<!-- kbcc:attachments -->", "Attachments");
  assert.equal(second, "# Topic\n\n<!-- kbcc:attachments -->\n![[one.png]]\n![[two.png]]\n");
});

test("heading insertion appends before the next peer heading and preserves CRLF", () => {
  const source = "---\r\ntitle: Test\r\n---\r\n\r\n## Attachments\r\n\r\n![[one.pdf]]\r\n\r\n## Notes\r\n- Keep\r\n";
  const output = insertAttachmentReference(source, "[[two.pdf]]", "heading", "", "Attachments");
  assert.equal(output, "---\r\ntitle: Test\r\n---\r\n\r\n## Attachments\r\n\r\n![[one.pdf]]\r\n[[two.pdf]]\r\n\r\n## Notes\r\n- Keep\r\n");
});

test("missing heading and end targets append without rewriting frontmatter", () => {
  const source = "---\ntitle: A\n---\n\nText\n";
  assert.equal(
    insertAttachmentReference(source, "![[image.png]]", "heading", "", "Media"),
    "---\ntitle: A\n---\n\nText\n\n## Media\n\n![[image.png]]\n",
  );
  assert.equal(
    insertAttachmentReference(source, "[[file.pdf]]", "end", "", ""),
    "---\ntitle: A\n---\n\nText\n\n[[file.pdf]]\n",
  );
});

test("inserting into a mixed-EOL note rewrites no existing line ending", () => {
  const source = "# Topic\n\n## Attachments\r\n\r\n![[one.png]]\n\n## Notes\n- Keep\n";
  const output = insertAttachmentReference(source, "![[two.png]]", "heading", "", "Attachments");

  assert.equal(output, "# Topic\n\n## Attachments\r\n\r\n![[one.png]]\n![[two.png]]\n\n## Notes\n- Keep\n");
  assert.equal(output.replace("![[two.png]]\n", ""), source, "every original byte outside the inserted line is preserved");

  const marker = insertAttachmentReference(
    "# Topic\r\n\r\n<!-- kbcc:attachments -->\n![[one.png]]\n\n## Notes\n",
    "![[three.png]]",
    "marker",
    "<!-- kbcc:attachments -->",
    "",
  );
  assert.equal(marker, "# Topic\r\n\r\n<!-- kbcc:attachments -->\n![[one.png]]\n![[three.png]]\n\n## Notes\n");
});

test("an indented code block quoting a fence stays content instead of opening a fence", () => {
  const source = [
    "# Topic",
    "",
    "Example of the fence syntax:",
    "",
    "    ```",
    "",
    "## Attachments",
    "![[one.png]]",
    "",
    "## Notes",
    "",
  ].join("\n");
  const output = insertAttachmentReference(source, "![[two.png]]", "heading", "", "Attachments");
  assert.match(output, /## Attachments\n!\[\[one\.png\]\]\n!\[\[two\.png\]\]\n\n## Notes/u);
  assert.equal(output.replace("![[two.png]]\n", ""), source);

  assert.throws(
    () => insertAttachmentReference("# Topic\n\n```\n## Attachments\n", "![[unsafe.png]]", "heading", "", "Attachments"),
    /unclosed fenced code block/i,
    "a genuinely unclosed top-level fence still fails closed",
  );
});

test("attachment paths are normalized, sanitized, and collision-ready", () => {
  assert.equal(attachmentFileName("unsafe:/scan?.png"), "unsafe--scan-.png");
  assert.equal(attachmentFileName(".env"), "env");
  assert.equal(noteAttachmentFolder("Knowledge/Topic.md"), "Knowledge/Topic attachments");
  assert.equal(noteAttachmentFolder("Topic.md"), "Topic attachments");
  assert.equal(attachmentPathCandidate("Assets", "scan.png"), "Assets/scan.png");
  assert.equal(attachmentPathCandidate("Assets", "scan.png", 2), "Assets/scan 2.png");
  assert.equal(canonicalAttachmentFolder("/05 Sources//_books/"), "05 Sources/_books");
});

test("attachment heading and marker insertion ignore fenced examples and normalize closing hashes", () => {
  const source = [
    "# Topic",
    "",
    "```md",
    "```js",
    "## Attachments",
    "<!-- kbcc:attachments -->",
    "```",
    "",
    "## Attachments ###",
    "![[one.png]]",
    "",
    "## Notes",
    "",
  ].join("\n");
  const heading = insertAttachmentReference(source, "![[two.png]]", "heading", "", "Attachments");
  assert.match(heading, /## Attachments ###\n!\[\[one\.png\]\]\n!\[\[two\.png\]\]\n\n## Notes/u);
  const marker = insertAttachmentReference(source, "![[three.png]]", "marker", "<!-- kbcc:attachments -->", "");
  assert.match(marker, /## Notes\n\n<!-- kbcc:attachments -->\n!\[\[three\.png\]\]\n$/u);

  assert.throws(
    () => insertAttachmentReference("# Topic\n\n```md\n## Attachments\n", "![[unsafe.png]]", "end", "", ""),
    /unclosed fenced code block/i,
  );
});

test("attachment UI stays scoped, touch-sized, and physically gated", () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const checklist = readFileSync(new URL("../docs/manual-iphone-release-checklist.md", import.meta.url), "utf8");
  assert.match(styles, /\.ent-cc-attachment-modal\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)/su);
  assert.match(styles, /\.ent-cc-attachment-footer button\s*\{[^}]*min-height:\s*44px/su);
  assert.match(styles, /\.ent-cc-attachment-modal \.setting-item-control,[\s\S]*?width:\s*100%/u);
  assert.match(styles, /\.ent-cc-attachment-modal \.setting-item-control > button,[\s\S]*?min-height:\s*44px/u);
  assert.match(checklist, /Attach file to current note[\s\S]*Follow Obsidian[\s\S]*fixed folder[\s\S]*note-local folder[\s\S]*Ask each time/u);
});
