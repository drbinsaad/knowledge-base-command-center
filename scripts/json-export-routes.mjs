import assert from "node:assert/strict";

/**
 * Static guard for the JSON export routes users actually reach. It is bound to
 * the real entry points and call sites, not to a text snippet that dead code
 * could satisfy. `sources` is an array of [relative path under src/, content].
 * Throws an AssertionError when a route is missing or bypassed.
 */
export function checkJsonExportRoutes(sources) {
  const files = new Map(sources);
  const get = (name) => {
    const content = files.get(name);
    assert.equal(typeof content, "string", `src/${name} is required by the JSON export route guard`);
    return content;
  };
  const modals = get("modals.ts");
  const portability = get("portability-modal.ts");
  const portfolio = get("portfolio-modal.ts");
  const recoveryModal = get("sync-recovery-modal.ts");
  const main = get("main.ts");

  // 1. The one audited helper: mobile writes through writePortableJson inside the vault.
  assert.match(
    modals,
    /export\s+async\s+function\s+deliverJsonExport\s*\([\s\S]*?\{\s*if\s*\(\s*Platform\.isMobile\s*\)\s*\{\s*return\s*\{\s*medium:\s*"vault",\s*file:\s*await\s+plugin\.writePortableJson\(kind,\s*value\)\s*\}/,
    "deliverJsonExport must exist in modals.ts and its mobile branch must write through plugin.writePortableJson(kind, value)",
  );

  // 2. Reachable user recovery backup: Sync recovery modal -> Export center
  //    with purpose "backup" -> recovery selection -> deliverJsonExport -> recorded.
  assert.match(
    recoveryModal,
    /new\s+ExportImportCenterModal\(\s*this\.plugin,\s*"export",\s*undefined,\s*"backup"\s*\)\.open\(\)/,
    "the Sync recovery modal must open the export center with purpose backup",
  );
  assert.match(
    portability,
    /if\s*\(\s*purpose\s*===\s*"backup"\s*\)\s*this\.exportSelection\.recovery\s*=\s*true/,
    "the export center must mark the backup purpose as a recovery export",
  );
  assert.match(
    portability,
    /await\s+deliverJsonExport\(\s*this\.plugin,\s*"portable"/,
    "the export center must deliver the portable package through deliverJsonExport",
  );
  assert.match(
    portability,
    /selection\.recovery\)\s*this\.plugin\.recordRecoveryExport\(/,
    "a recovery export must be recorded after delivery",
  );
  assert.match(portability, /import\s*\{[^}]*\bdeliverJsonExport\b[^}]*\}\s*from\s*["']\.\/modals["']/, "portability-modal.ts must import deliverJsonExport from ./modals");

  // 3. Automatic recovery package written by the plugin before a portfolio import.
  assert.match(main, /await\s+this\.writePortableJson\(\s*"backup",\s*recovery\.package\s*\)/, "main.ts must write automatic recovery packages through writePortableJson(\"backup\", ...)");
  assert.match(main, /async\s+writePortableJson\(/, "main.ts must define writePortableJson");

  // 4. Portfolio export.
  assert.match(portfolio, /await\s+deliverJsonExport\(\s*this\.plugin,\s*"portfolio"/, "portfolio export must go through deliverJsonExport");
  assert.match(portfolio, /import\s*\{[^}]*\bdeliverJsonExport\b[^}]*\}\s*from\s*["']\.\/modals["']/, "portfolio-modal.ts must import deliverJsonExport from ./modals");

  // 5. Nothing else bypasses the helper.
  const allowedDeliverers = ["portability-modal.ts", "portfolio-modal.ts"];
  const deliverers = [...files].filter(([name, content]) => name !== "modals.ts" && /\bdeliverJsonExport\s*\(/.test(content)).map(([name]) => name).sort();
  assert.deepEqual(deliverers, allowedDeliverers, "deliverJsonExport must be called only from the audited export modals");
  const writers = [...files].filter(([name, content]) => name !== "main.ts" && /\bwritePortableJson\s*\(/.test(content)).map(([name]) => name).sort();
  assert.deepEqual(writers, ["modals.ts"], "writePortableJson must be reached outside main.ts only through deliverJsonExport in modals.ts");
  const directWrites = [...files]
    .filter(([name, content]) => name !== "main.ts" && /\bvault\.(?:create|modify|createBinary)\s*\(|\badapter\.(?:write|writeBinary)\s*\(/.test(content))
    .map(([name]) => name);
  assert.deepEqual(directWrites, [], "files other than main.ts must not write to the vault directly");
}
