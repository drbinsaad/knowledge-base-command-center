import assert from "node:assert/strict";
import test from "node:test";
import {
  KBCC_RETURN_NAVIGATION_VERSION,
  MAX_KBCC_RETURN_ROUTES,
  kbccReturnRouteForNote,
  parseKbccReturnNavigationState,
  rebuildBoundedKbccReturnNavigationState,
  rememberKbccReturnRoute,
  type KbccReturnRoute,
} from "../src/kbcc-return-navigation";

function route(notePath: string, capturedAt: number, query = "type:resource"): KbccReturnRoute {
  return {
    notePath,
    baseId: "base-main",
    capturedAt,
    view: {
      activeTab: "library:resources",
      selectedPath: notePath,
      query,
      detailVisible: true,
      browseRowLimit: 600,
      browseStructureLimit: 600,
      listScrollTop: 480,
      detailScrollTop: 72,
    },
  };
}

test("return navigation round-trips exact per-note route state", () => {
  const state = rememberKbccReturnRoute(null, "vault-main", route("Notes/Recovery.md", 100));
  const parsed = parseKbccReturnNavigationState(structuredClone(state));

  assert.deepEqual(parsed, {
    version: KBCC_RETURN_NAVIGATION_VERSION,
    vaultId: "vault-main",
    routes: [route("Notes/Recovery.md", 100)],
  });
  assert.deepEqual(kbccReturnRouteForNote(parsed, "vault-main", "Notes/Recovery.md"), route("Notes/Recovery.md", 100));
  assert.equal(kbccReturnRouteForNote(parsed, "vault-other", "Notes/Recovery.md"), null, "a foreign vault never receives the route");
  assert.equal(kbccReturnRouteForNote(parsed, "vault-main", "Notes/Unrelated.md"), null, "routes are bound to the opened note");
});

test("remembering routes replaces one note and keeps only the newest bounded history", () => {
  let state = null;
  for (let index = 0; index < MAX_KBCC_RETURN_ROUTES + 5; index += 1) {
    state = rememberKbccReturnRoute(state, "vault-main", route(`Notes/${index}.md`, index));
  }
  assert.equal(state.routes.length, MAX_KBCC_RETURN_ROUTES);
  assert.equal(state.routes[0]?.notePath, `Notes/${MAX_KBCC_RETURN_ROUTES + 4}.md`);
  assert.equal(state.routes.some((candidate) => candidate.notePath === "Notes/0.md"), false);

  state = rememberKbccReturnRoute(state, "vault-main", route("Notes/10.md", 1_000, "updated query"));
  assert.equal(state.routes.length, MAX_KBCC_RETURN_ROUTES);
  assert.equal(state.routes[0]?.notePath, "Notes/10.md");
  assert.equal(state.routes[0]?.view.query, "updated query");
  assert.equal(state.routes.filter((candidate) => candidate.notePath === "Notes/10.md").length, 1);

  const foreign = rememberKbccReturnRoute(state, "vault-new", route("Notes/New vault.md", 2_000));
  assert.deepEqual(foreign.routes.map((candidate) => candidate.notePath), ["Notes/New vault.md"]);
});

test("the route just remembered wins even when the wall clock moves backwards or ties", () => {
  let state = null;
  for (let index = 0; index < MAX_KBCC_RETURN_ROUTES; index += 1) {
    state = rememberKbccReturnRoute(
      state,
      "vault-main",
      route(`Notes/Future ${index}.md`, 10_000 + index),
    );
  }

  state = rememberKbccReturnRoute(state, "vault-main", route("Notes/After clock correction.md", 1));
  assert.equal(state.routes.length, MAX_KBCC_RETURN_ROUTES);
  assert.equal(state.routes[0]?.notePath, "Notes/After clock correction.md");
  assert.equal(
    state.routes.some((candidate) => candidate.notePath === "Notes/After clock correction.md"),
    true,
    "a full history cannot evict the route from the action that just happened",
  );

  state = rememberKbccReturnRoute(state, "vault-main", route("Notes/Zulu same millisecond.md", 1));
  assert.equal(
    state.routes[0]?.notePath,
    "Notes/Zulu same millisecond.md",
    "lexical ordering cannot overrule newest-first insertion when timestamps tie",
  );
});

test("return navigation rejects malformed, duplicated, oversized, and non-Markdown state", () => {
  const valid = rememberKbccReturnRoute(null, "vault-main", route("Notes/Valid.md", 100));
  assert.throws(() => parseKbccReturnNavigationState({ ...valid, version: 99 }), /unsupported/iu);
  assert.throws(() => parseKbccReturnNavigationState({ ...valid, routes: [valid.routes[0], valid.routes[0]] }), /duplicate/iu);
  assert.throws(() => parseKbccReturnNavigationState({
    ...valid,
    routes: [{ ...valid.routes[0], notePath: "Attachments/image.png" }],
  }), /Markdown/iu);
  assert.throws(() => parseKbccReturnNavigationState({
    ...valid,
    routes: [{ ...valid.routes[0], view: { ...valid.routes[0]?.view, query: "x".repeat(10_001) } }],
  }), /query/iu);
  assert.throws(() => parseKbccReturnNavigationState({
    ...valid,
    routes: [{ ...valid.routes[0], view: { ...valid.routes[0]?.view, listScrollTop: -1 } }],
  }), /scroll/iu);
  assert.throws(() => parseKbccReturnNavigationState({
    ...valid,
    routes: [{ ...valid.routes[0], view: { ...valid.routes[0]?.view, browseRowLimit: 100_000 } }],
  }), /row limit/iu);
});

test("return navigation preserves legitimate format characters in paths and search text", () => {
  const unicodeRoute = route("Notes/Café Family 👨‍👩‍👧.md", 500, "؜ airway 👨‍👩‍👧");
  const state = rememberKbccReturnRoute(null, "vault-main", unicodeRoute);

  assert.deepEqual(parseKbccReturnNavigationState(structuredClone(state)).routes, [unicodeRoute]);
});

test("bounded rebuild salvages a page when only selected detail grows invalid and drops an invalid note route", () => {
  const selectedOnly = route("Notes/Keep page.md", 300);
  selectedOnly.view.selectedPath = `${"s".repeat(4_094)}.md`;
  const invalidNote = route(`${"n".repeat(4_094)}.md`, 200);
  const unrelated = route("Other/Unrelated.md", 100);

  const rebuilt = rebuildBoundedKbccReturnNavigationState(
    "vault-main",
    [selectedOnly, invalidNote, unrelated],
  );

  assert.deepEqual(rebuilt.routes.map((candidate) => candidate.notePath), [
    "Notes/Keep page.md",
    "Other/Unrelated.md",
  ]);
  assert.deepEqual(rebuilt.routes[0]?.view, {
    ...route("Notes/Keep page.md", 300).view,
    selectedPath: "",
    detailVisible: false,
    detailScrollTop: 0,
  });
  assert.deepEqual(parseKbccReturnNavigationState(structuredClone(rebuilt)), rebuilt);
});
