import assert from "node:assert/strict";
import test from "node:test";
import { Notice } from "obsidian";
import { createOpenedBaseGuard } from "../src/opened-base-guard";

test("semantic surface ownership preserves drafts through a no-op reload while fencing pending work", () => {
  let pending = false;
  let version = "vault/base/head-a";
  let epoch = 1;
  let generation = 0;
  let stale = 0;
  const host = {
    data: {},
    getActiveKnowledgeBaseId: () => "base",
    getDataEpoch: () => epoch,
    getExternalChangeGeneration: () => generation,
    getBaseSurfaceVersion: () => version,
    isExternalReloadInProgress: () => pending,
  };
  const guard = createOpenedBaseGuard(host, { message: "Changed destination.", onStale: () => { stale += 1; } });
  assert.equal(guard(), true);
  pending = true;
  generation += 1;
  Notice.messages.length = 0;
  assert.equal(guard(), false);
  assert.equal(guard.owns(), false);
  assert.equal(guard(), false);
  assert.equal(Notice.messages.length, 1);
  assert.equal(stale, 0, "an arrival blocks action without closing the draft");
  host.data = {};
  epoch += 2;
  pending = false;
  assert.equal(guard(), true, "settled identical semantic data still owns the draft");
  version = "vault/base/head-b";
  assert.equal(guard(), false);
  assert.equal(stale, 1);
});

test("semantic guards cannot adopt a newer epoch for an explicitly older surface", () => {
  const host = {
    data: {}, getActiveKnowledgeBaseId: () => "base", getDataEpoch: () => 2,
    getBaseSurfaceVersion: () => "same-head",
  };
  const guard = createOpenedBaseGuard(host, { message: "Stale.", openedDataEpoch: 1 });
  assert.equal(guard.owns(), false);
});

test("legacy hosts retain identity, epoch, and external-notification fencing", () => {
  let generation = 0;
  const host = { data: {}, getActiveKnowledgeBaseId: () => "base", getExternalChangeGeneration: () => generation };
  const guard = createOpenedBaseGuard(host, { message: "Stale." });
  assert.equal(guard.owns(), true);
  generation += 1;
  assert.equal(guard.owns(), false);
});
