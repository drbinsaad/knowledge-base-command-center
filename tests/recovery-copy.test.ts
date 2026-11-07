import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_COPY_CONFLICT_RESCUE_KIND,
  RECOVERY_COPY_LIMITS,
  checkRecoveryCopyDeclaredSize,
  createRecoveryRestoreIntent,
  fingerprintRecoveryCopyBytes,
  parseRecoveryCopy,
  recoveryCopySourceTokenMatches,
  recoverySourceMatchesExactly,
  suggestRestoredBaseName,
  type RecoveryCopyParseResult,
} from "../src/recovery-copy.ts";
import {
  DATA_VERSION,
  ENT_CLINICAL_SETTINGS,
  STORE_KIND,
  STORE_VERSION,
  cloneJsonValue,
  createDefaultStore,
  createKnowledgeBaseEntry,
  fingerprintText,
  migrateData,
  snapshotPersonal,
  type PluginStore,
} from "../src/model.ts";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const VAULT = "vault-synthetic-one";

function makeStore(vaultId = VAULT): PluginStore {
  const store = createDefaultStore(undefined, NOW - 1000, vaultId);
  const base = store.bases[0];
  base.data.settings.workspaceName = "Synthetic Base";
  base.data.settings.setupComplete = true;
  base.data.pinnedPaths = ["Synthetic/a.md", "Synthetic/b.md"];
  base.data.selectedPath = "Synthetic/a.md";
  base.data.layoutSnapshots = [snapshotPersonal(base.data, "Named")];
  base.data.undoStack = [snapshotPersonal(base.data, "Undo me")];
  base.data.redoStack = [snapshotPersonal(base.data, "Redo me")];
  return store;
}

function makeEntStore(): PluginStore {
  const data = migrateData({});
  data.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  data.settings.workspaceName = "Synthetic ENT";
  return createDefaultStore(data, NOW - 1000, VAULT);
}

function wrap(store: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND,
    version: 1,
    exportedAt: new Date(NOW - 60_000).toISOString(),
    reason: "synthetic",
    privacy: "synthetic",
    store,
    ...overrides,
  }, null, 2);
}

function expectPreview(result: RecoveryCopyParseResult) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.reason}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function expectRejected(result: RecoveryCopyParseResult, reason: string) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, reason, result.message);
  assert.equal(result.restorable, false);
  assert.equal(result.preservedNotRestorable, true);
  assert.match(result.message, /\S/);
  return result;
}

const parse = (content: string | Uint8Array, extra: Record<string, unknown> = {}) =>
  parseRecoveryCopy({ content, currentVaultId: VAULT, now: NOW, ...extra });

test("a raw complete plugin store previews and is restorable in the same vault", () => {
  const text = JSON.stringify(makeStore());
  const before = text.slice();
  const result = expectPreview(parse(text));
  assert.equal(text, before);
  assert.equal(result.preview.sourceKind, "raw-store");
  assert.equal(result.preview.date, null);
  assert.equal(result.preview.supportedSchema, true);
  assert.equal(result.preview.identity, "same-vault");
  assert.equal(result.preview.restorable, true);
  assert.equal(result.preview.bases.length, 1);
  const base = result.preview.bases[0];
  assert.equal(base.name, "Synthetic Base");
  assert.equal(base.preset, "generic");
  assert.equal(base.counts.pinned, 2);
  assert.equal(base.counts.namedSnapshots, 1);
  assert.equal(base.counts.undoSteps, 1);
  assert.equal(base.counts.redoSteps, 1);
  assert.match(result.preview.privateContentDisclosure, /exact (vault-relative )?paths/i);
  assert.match(result.preview.privateContentDisclosure, /Undo/);
  assert.match(result.preview.privateContentDisclosure, /Clear device-local data/);
  assert.equal(result.preview.sourceToken.startsWith("fp:"), true);
});

test("a version-1 conflict-rescue wrapper previews with a trustworthy date", () => {
  const result = expectPreview(parse(wrap(makeStore())));
  assert.equal(result.preview.sourceKind, "conflict-rescue");
  assert.equal(result.preview.date?.iso, new Date(NOW - 60_000).toISOString());
  assert.equal(result.preview.restorable, true);
});

test("untrustworthy wrapper dates are not shown", () => {
  const future = expectPreview(parse(wrap(makeStore(), { exportedAt: new Date(NOW + 10 * 86_400_000).toISOString() })));
  assert.equal(future.preview.date, null);
  const junk = expectPreview(parse(wrap(makeStore(), { exportedAt: "not a date" })));
  assert.equal(junk.preview.date, null);
  const ancient = expectPreview(parse(wrap(makeStore(), { exportedAt: "1999-01-01T00:00:00.000Z" })));
  assert.equal(ancient.preview.date, null);
});

test("malformed, empty and arbitrary JSON never become a default store", () => {
  expectRejected(parse("{\"kind\": "), "malformed-json");
  expectRejected(parse(""), "empty");
  expectRejected(parse("  \n "), "empty");
  expectRejected(parse(new Uint8Array(0)), "empty");
  expectRejected(parse("{}"), "unrecognized");
  expectRejected(parse("[]"), "unrecognized");
  expectRejected(parse("null"), "unrecognized");
  expectRejected(parse("42"), "unrecognized");
  expectRejected(parse(JSON.stringify({ collections: [], settings: {} })), "unrecognized");
  expectRejected(parse(JSON.stringify({ kind: "something-else", version: 1, store: makeStore() })), "unrecognized");
  expectRejected(parse(wrap({})), "unrecognized");
  expectRejected(parse(wrap(null)), "unrecognized");
  expectRejected(parse(wrap([])), "unrecognized");
  // A pre-v11 flat store would be wrapped by migrateStore: refuse it.
  expectRejected(parse(JSON.stringify({ ...makeStore(), version: 10 })), "unrecognized");
  // Damaged but recognizable stores are preserved-not-restorable.
  expectRejected(parse(JSON.stringify({ ...makeStore(), bases: [{ id: "x" }] })), "damaged-store");
  expectRejected(parse(JSON.stringify({ ...makeStore(), bases: [] })), "damaged-store");
  const invalidBytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
  expectRejected(parse(invalidBytes), "not-utf8");
});

test("rejected results still carry a source token for preserved-copy disclosure", () => {
  const result = expectRejected(parse("{}"), "unrecognized");
  assert.equal(result.sourceToken?.startsWith("fp:"), true);
});

test("future OUTER versions are rejected before migrateStore", () => {
  expectRejected(parse(JSON.stringify({ ...makeStore(), version: STORE_VERSION + 1 })), "future-outer-version");
  expectRejected(parse(JSON.stringify({ ...makeStore(), version: String(STORE_VERSION + 5) })), "future-outer-version");
  expectRejected(parse(wrap(makeStore(), { version: 2 })), "future-outer-version");
});

test("future INNER versions are rejected before migrateStore", () => {
  expectRejected(parse(wrap({ ...makeStore(), version: STORE_VERSION + 1 })), "future-inner-version");
  const store = makeStore();
  const innerFuture = cloneJsonValue(store) as unknown as { bases: Array<{ data: { version: number } }> };
  innerFuture.bases[0].data.version = DATA_VERSION + 1;
  expectRejected(parse(JSON.stringify(innerFuture)), "future-inner-version");
  expectRejected(parse(wrap(innerFuture)), "future-inner-version");
});

test("a store from another vault is previewed but reported as not restorable with portable-transfer guidance", () => {
  const result = expectPreview(parse(JSON.stringify(makeStore("vault-other-xyz"))));
  assert.equal(result.preview.identity, "foreign-vault");
  assert.equal(result.preview.restorable, false);
  assert.match(result.preview.identityGuidance, /portable/i);
  assert.match(result.preview.identityGuidance, /not (be )?restor/i);
  const intent = createRecoveryRestoreIntent({
    parsed: result,
    selectedBaseId: result.preview.bases[0].baseId,
    existingNames: [],
    existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-new", semanticHead: "aaaaaaaaaaaaaaaa" }),
    now: NOW,
  });
  assert.equal(intent.ok, false);
  if (!intent.ok) assert.equal(intent.reason, "identity-not-restorable");
});

test("identity is never inferred from names; missing current or stored identity is unverified", () => {
  const unknownCurrent = expectPreview(parseRecoveryCopy({ content: JSON.stringify(makeStore()), currentVaultId: null, now: NOW }));
  assert.equal(unknownCurrent.preview.identity, "unverified");
  assert.equal(unknownCurrent.preview.restorable, false);
  const raw = cloneJsonValue(makeStore()) as unknown as Record<string, unknown>;
  delete raw.vaultId;
  const missing = expectPreview(parse(JSON.stringify(raw)));
  assert.equal(missing.preview.identity, "unverified");
  assert.equal(missing.preview.restorable, false);
});

test("declared size is checked before any read, and actual UTF-8 bytes after", () => {
  assert.equal(checkRecoveryCopyDeclaredSize(10).ok, true);
  assert.equal(checkRecoveryCopyDeclaredSize(null).ok, true);
  assert.equal(checkRecoveryCopyDeclaredSize(RECOVERY_COPY_LIMITS.maxBytes + 1).ok, false);
  assert.equal(checkRecoveryCopyDeclaredSize(-1).ok, false);
  assert.equal(checkRecoveryCopyDeclaredSize(Number.NaN).ok, false);
  const throwing = {
    get length(): number { throw new Error("content was read"); },
  };
  // Declared oversize must reject without touching the content at all.
  const result = parseRecoveryCopy({
    content: throwing as unknown as string,
    declaredSize: RECOVERY_COPY_LIMITS.maxBytes + 1,
    currentVaultId: VAULT,
    now: NOW,
  });
  const rejected = expectRejected(result, "too-large");
  assert.equal(rejected.sourceToken, null);
});

test("multi-byte characters near the cap are counted as UTF-8 bytes", () => {
  const maxBytes = 200;
  // 101 two-byte characters = 202 bytes but only ~101 UTF-16 units.
  const pad = (count: number) => JSON.stringify({ pad: "é".repeat(count) });
  const over = pad(98); // `{"pad":"` + 196 + `"}` = 8 + 196 + 2 = 206 bytes, 108 characters
  assert.ok(over.length < maxBytes);
  assert.ok(new TextEncoder().encode(over).length > maxBytes);
  expectRejected(parse(over, { limits: { maxBytes } }), "too-large");
  expectRejected(parse(new TextEncoder().encode(over), { limits: { maxBytes } }), "too-large");
  // Exactly at the cap is accepted by the size gate (and then judged unrecognized).
  const exact = pad(95); // 8 + 190 + 2 = 200 bytes
  assert.equal(new TextEncoder().encode(exact).length, maxBytes);
  expectRejected(parse(exact, { limits: { maxBytes } }), "unrecognized");
  // Four-byte characters (surrogate pairs) are also counted by bytes.
  const emoji = JSON.stringify({ pad: "😀".repeat(50) });
  assert.ok(emoji.length < maxBytes);
  expectRejected(parse(emoji, { limits: { maxBytes } }), "too-large");
});

test("very deep JSON is rejected without recursion", () => {
  const depth = RECOVERY_COPY_LIMITS.maxDepth + 1;
  const deepArray = `${"[".repeat(depth)}${"]".repeat(depth)}`;
  expectRejected(parse(deepArray), "too-deep");
  const huge = 200_000;
  expectRejected(parse(`${"[".repeat(huge)}${"]".repeat(huge)}`), "too-deep");
  const deepObject = `${"{\"a\":".repeat(depth)}1${"}".repeat(depth)}`;
  expectRejected(parse(deepObject), "too-deep");
  // Brackets inside strings do not count.
  const quoted = JSON.stringify({ text: "[".repeat(depth * 3) });
  expectRejected(parse(quoted), "unrecognized");
});

test("too many nodes and too many bases are rejected", () => {
  expectRejected(parse(JSON.stringify({ list: new Array(60).fill(1) }), { limits: { maxNodes: 50 } }), "too-many-nodes");
  const store = makeStore();
  const template = store.bases[0];
  for (let index = 0; index < RECOVERY_COPY_LIMITS.maxBases; index += 1) {
    store.bases.push({ ...cloneJsonValue(template), id: `extra-${index}` });
  }
  expectRejected(parse(JSON.stringify(store)), "too-many-bases");
  expectRejected(parse(wrap(store)), "too-many-bases");
});

test("Generic and ENT presets are reported as in the source", () => {
  const generic = expectPreview(parse(JSON.stringify(makeStore())));
  assert.equal(generic.preview.bases[0].preset, "generic");
  const ent = expectPreview(parse(wrap(makeEntStore())));
  assert.equal(ent.preview.bases[0].preset, "ent-clinical");
  assert.equal(ent.preview.bases[0].name, "Synthetic ENT");
});

test("restore intent: new identity, unique name, kept organization, empty executable history", () => {
  const text = wrap(makeStore());
  const parsed = expectPreview(parse(text));
  const sourceBase = parsed.store.bases[0];
  const result = createRecoveryRestoreIntent({
    parsed,
    selectedBaseId: sourceBase.id,
    existingNames: ["Synthetic Base", "synthetic base (restored)"],
    existingBaseIds: ["base-taken"],
    generateIdentity: () => ({ baseId: "base-restored-1", semanticHead: "0123456789abcdef" }),
    now: NOW,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  const { intent } = result;
  assert.equal(intent.sourceBaseId, sourceBase.id);
  assert.equal(intent.sourceToken, parsed.preview.sourceToken);
  assert.equal(intent.entry.id, "base-restored-1");
  assert.notEqual(intent.entry.id, sourceBase.id);
  assert.equal(intent.entry.semanticHead, "0123456789abcdef");
  assert.equal(intent.entry.semanticRevision, 0);
  assert.deepEqual(intent.entry.semanticLineage, []);
  assert.equal(intent.entry.archivedAt, null);
  assert.match(intent.entry.semanticHash, /^[0-9a-f]{16}$/);
  assert.equal(intent.name, "Synthetic Base (restored 2)");
  assert.equal(intent.entry.data.settings.workspaceName, intent.name);
  assert.equal(intent.preset, "generic");
  assert.deepEqual(intent.entry.data.pinnedPaths, ["Synthetic/a.md", "Synthetic/b.md"]);
  assert.equal(intent.entry.data.layoutSnapshots.length, 1);
  assert.deepEqual(intent.entry.data.undoStack, []);
  assert.deepEqual(intent.entry.data.redoStack, []);
  assert.equal(intent.entry.data.selectedPath, "");
  assert.ok(intent.omitted.length >= 2);
  assert.ok(intent.omitted.some((line) => /Undo/.test(line)));
  // The parsed source is not mutated by building an intent.
  assert.equal(parsed.store.bases[0].data.undoStack.length, 1);
  assert.equal(parsed.store.bases[0].data.settings.workspaceName, "Synthetic Base");
  assert.equal(parse(text).ok && (parse(text) as { preview: { sourceToken: string } }).preview.sourceToken, parsed.preview.sourceToken);
});

test("restore intent keeps the ENT preset and rejects bad selections or identities", () => {
  const parsed = expectPreview(parse(JSON.stringify(makeEntStore())));
  const baseId = parsed.store.bases[0].id;
  const ok = createRecoveryRestoreIntent({
    parsed, selectedBaseId: baseId, existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-ent-restored", semanticHead: "fedcba9876543210" }), now: NOW,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.intent.preset, "ent-clinical");
    assert.equal(ok.intent.entry.data.settings.workspaceMode, "ent-clinical");
    assert.equal(ok.intent.name, "Synthetic ENT (restored)");
  }
  const missing = createRecoveryRestoreIntent({
    parsed, selectedBaseId: "nope", existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-x", semanticHead: "fedcba9876543210" }), now: NOW,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "base-not-found");
  for (const identity of [
    { baseId: baseId, semanticHead: "fedcba9876543210" },
    { baseId: "base-taken", semanticHead: "fedcba9876543210" },
    { baseId: "bad id!", semanticHead: "fedcba9876543210" },
    { baseId: "base-ok", semanticHead: "short" },
    { baseId: "base-ok", semanticHead: parsed.store.bases[0].semanticHead },
  ]) {
    const bad = createRecoveryRestoreIntent({
      parsed, selectedBaseId: baseId, existingNames: [], existingBaseIds: ["base-taken"],
      generateIdentity: () => identity, now: NOW,
    });
    assert.equal(bad.ok, false, JSON.stringify(identity));
    if (!bad.ok) assert.equal(bad.reason, "identity-unavailable");
  }
});

test("restore intent validates a user-edited name", () => {
  const parsed = expectPreview(parse(JSON.stringify(makeStore())));
  const baseId = parsed.store.bases[0].id;
  const run = (chosenName: string, existingNames: string[] = []) => createRecoveryRestoreIntent({
    parsed, selectedBaseId: baseId, existingNames, existingBaseIds: [], chosenName,
    generateIdentity: () => ({ baseId: "base-edit", semanticHead: "0123456789abcdef" }), now: NOW,
  });
  const good = run("  My   Copy ");
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.intent.name, "My   Copy");
  for (const bad of ["", "   ", "x".repeat(101), "bad\u0007name"]) {
    const result = run(bad);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid-name");
  }
  const clash = run("my copy", ["My Copy"]);
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.equal(clash.reason, "name-in-use");
});

test("name suggestion is unique, bounded and case-insensitive", () => {
  assert.equal(suggestRestoredBaseName("Alpha", []), "Alpha (restored)");
  assert.equal(suggestRestoredBaseName("Alpha", ["ALPHA (restored)"]), "Alpha (restored 2)");
  assert.equal(suggestRestoredBaseName("Alpha", ["Alpha (restored)", "Alpha (restored 2)"]), "Alpha (restored 3)");
  const long = suggestRestoredBaseName("L".repeat(100), []);
  assert.ok(long.length <= 100);
  assert.ok(long.endsWith(" (restored)"));
  assert.equal(suggestRestoredBaseName("", []), "Recovered base (restored)");
});

test("source token detects any byte change and is stable across string and bytes", () => {
  const text = JSON.stringify(makeStore());
  const parsed = expectPreview(parse(text));
  const token = parsed.preview.sourceToken;
  assert.equal(recoveryCopySourceTokenMatches(token, text), true);
  assert.equal(recoveryCopySourceTokenMatches(token, new TextEncoder().encode(text)), true);
  assert.equal(recoveryCopySourceTokenMatches(token, `${text}\n`), false);
  assert.equal(recoveryCopySourceTokenMatches(token, text.replace("Synthetic Base", "Synthetic Basf")), false);
  assert.equal(recoveryCopySourceTokenMatches("fp:0:00", text), false);
  assert.equal(recoveryCopySourceTokenMatches(token, "x".repeat(RECOVERY_COPY_LIMITS.maxBytes + 1)), false);
  // BOM bytes are a different source even though JSON text is the same.
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
  assert.equal(recoveryCopySourceTokenMatches(token, withBom), false);
  expectPreview(parse(withBom));
});

test("lookup token reuses the existing fingerprint and carries the byte length", () => {
  const token = fingerprintRecoveryCopyBytes(new TextEncoder().encode("abc"));
  assert.equal(token, `fp:3:${fingerprintText("abc")}`);
  assert.notEqual(token, fingerprintRecoveryCopyBytes(new TextEncoder().encode("abd")));
});

test("exact match compares retained bytes; a forced token collision is still a mismatch", () => {
  const storeA = JSON.stringify(makeStore());
  // Same length, one character different: only a byte comparison can tell them apart.
  const storeB = storeA.replace("Synthetic Base", "Synthetic Basf");
  assert.notEqual(storeA, storeB);
  assert.equal(storeA.length, storeB.length);
  const constant = () => "fp:forced-collision";
  const parsedA = expectPreview(parse(storeA, { fingerprint: constant }));
  const parsedB = expectPreview(parse(storeB, { fingerprint: constant }));
  assert.equal(parsedA.preview.sourceToken, parsedB.preview.sourceToken);
  // The token alone would call these the same file.
  assert.equal(recoveryCopySourceTokenMatches(parsedA.preview.sourceToken, storeB, undefined, constant), true);
  const made = createRecoveryRestoreIntent({
    parsed: parsedA, selectedBaseId: parsedA.store.bases[0].id, existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-exact", semanticHead: "0123456789abcdef" }), now: NOW,
  });
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(recoverySourceMatchesExactly(made.intent, storeA), true);
  assert.equal(recoverySourceMatchesExactly(made.intent, new TextEncoder().encode(storeA)), true);
  assert.equal(recoverySourceMatchesExactly(made.intent, storeB), false);
  assert.equal(recoverySourceMatchesExactly(made.intent, `${storeA} `), false);
  assert.equal(recoverySourceMatchesExactly(made.intent, null), false);
  assert.equal(recoverySourceMatchesExactly(made.intent, "x".repeat(RECOVERY_COPY_LIMITS.maxBytes + 1)), false);
  assert.equal(recoverySourceMatchesExactly(made.intent, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(storeA)])), false);
  // Mutating the caller's buffer after parsing cannot change what was retained.
  const bytes = new TextEncoder().encode(storeA);
  const again = expectPreview(parse(bytes));
  bytes[2] = 0x20;
  const intent = createRecoveryRestoreIntent({
    parsed: again, selectedBaseId: again.store.bases[0].id, existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-exact2", semanticHead: "0123456789abcdef" }), now: NOW,
  });
  assert.equal(intent.ok && recoverySourceMatchesExactly(intent.intent, storeA), true);
});

test("parsing never modifies any fixture input, string or bytes", () => {
  const fixtures: string[] = [
    JSON.stringify(makeStore()),
    wrap(makeStore()),
    JSON.stringify(makeEntStore()),
    JSON.stringify(makeStore("vault-other-xyz")),
    "{\"kind\": ",
    "",
    "{}",
    JSON.stringify({ ...makeStore(), version: STORE_VERSION + 1 }),
    wrap({ ...makeStore(), version: STORE_VERSION + 1 }),
    "[".repeat(RECOVERY_COPY_LIMITS.maxDepth + 5),
  ];
  for (const fixture of fixtures) {
    const copy = `${fixture}`;
    const bytes = new TextEncoder().encode(fixture);
    const bytesBefore = Uint8Array.from(bytes);
    parse(fixture);
    parse(bytes);
    assert.equal(fixture, copy);
    assert.deepEqual(bytes, bytesBefore);
  }
  assert.equal(STORE_KIND, "knowledge-base-command-center-store");
});

test("a created entry matches the store entry shape used by createKnowledgeBaseEntry", () => {
  const parsed = expectPreview(parse(JSON.stringify(makeStore())));
  const result = createRecoveryRestoreIntent({
    parsed, selectedBaseId: parsed.store.bases[0].id, existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-shape", semanticHead: "0123456789abcdef" }), now: NOW,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const reference = createKnowledgeBaseEntry(cloneJsonValue(result.intent.entry.data), "base-shape", NOW);
  assert.equal(result.intent.entry.semanticHash, reference.semanticHash);
  assert.equal(result.intent.entry.createdAt, NOW);
  assert.equal(result.intent.entry.updatedAt, NOW);
});
