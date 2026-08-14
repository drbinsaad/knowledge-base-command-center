import assert from "node:assert/strict";
import test from "node:test";
import { Notice } from "obsidian";
import type { LegacyIndexReviewPlan } from "../src/legacy-index-review.ts";
import { LegacyIndexReviewModal, type LegacyIndexReviewHost } from "../src/legacy-index-review-modal.ts";
import { migrateData } from "../src/model.ts";
import { EntCommandCenterSettingsTab } from "../src/settings.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

function reviewPlan(count: number): LegacyIndexReviewPlan {
  return {
    version: 1,
    source: { id: "legacy-kb", path: "Knowledge Base", origin: "legacy-primary-folder" },
    sourceFolderAvailable: true,
    candidates: Array.from({ length: count }, (_, index) => ({
      path: `Knowledge Base/Topic ${String(index).padStart(5, "0")}.md`,
      title: `Topic ${index}`,
      domain: "Knowledge Base",
      kind: "topic" as const,
    })),
    preserveCapacity: 50_000,
    stateFingerprint: "1111111111111111",
    fingerprint: "2222222222222222",
  };
}

interface HostHarness {
  host: LegacyIndexReviewHost;
  applied: Array<{ plan: LegacyIndexReviewPlan; preservePaths: readonly string[]; syncContentsConfirmed: boolean }>;
  kept: LegacyIndexReviewPlan[];
  setReadOnly(value: boolean): void;
  replaceData(): void;
}

function reviewHost(plan: LegacyIndexReviewPlan): HostHarness {
  let readOnly = false;
  const applied: Array<{ plan: LegacyIndexReviewPlan; preservePaths: readonly string[]; syncContentsConfirmed: boolean }> = [];
  const kept: LegacyIndexReviewPlan[] = [];
  const host = {
    app: {},
    data: {},
    getActiveKnowledgeBaseId: () => "base-main",
    getDataEpoch: () => 7,
    getExternalChangeGeneration: () => 3,
    isDataReadOnly: () => readOnly,
    getLegacyIndexReviewPlans: () => [plan],
    applyLegacyIndexReview: async (
      review: LegacyIndexReviewPlan,
      preservePaths: readonly string[],
      syncContentsConfirmed: boolean,
    ) => {
      applied.push({ plan: review, preservePaths: [...preservePaths], syncContentsConfirmed });
    },
    keepLegacyIndexSource: async (review: LegacyIndexReviewPlan) => { kept.push(review); },
  } as unknown as LegacyIndexReviewHost;
  return {
    host,
    applied,
    kept,
    setReadOnly: (value) => { readOnly = value; },
    replaceData: () => { host.data = {}; },
  };
}

interface ModalHarness {
  modal: LegacyIndexReviewModal;
  content: FakeElement;
  closed(): number;
  resolved(): number;
}

function openReviewModal(host: LegacyIndexReviewHost, plan: LegacyIndexReviewPlan): ModalHarness {
  const dom = createFakeDom();
  const modalRoot = dom.document.body.createDiv();
  const title = modalRoot.createDiv();
  const content = modalRoot.createDiv();
  let closeCount = 0;
  let resolveCount = 0;
  const modal = new LegacyIndexReviewModal(
    host,
    plan,
    () => { resolveCount += 1; },
    () => { closeCount += 1; },
  );
  Object.assign(modal, {
    modalEl: asHtmlElement(modalRoot),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.close = () => { modal.onClose(); };
  modal.onOpen();
  return { modal, content, closed: () => closeCount, resolved: () => resolveCount };
}

function button(content: FakeElement, text: string): FakeElement {
  const match = content.querySelectorAll("button").find((candidate) => candidate.textContent === text);
  assert.ok(match, `missing button: ${text}`);
  return match;
}

function confirmSync(content: FakeElement): void {
  const confirmation = content.querySelector(".ent-cc-legacy-review-sync-confirmation input") as unknown as
    FakeElement & { checked: boolean };
  assert.ok(confirmation);
  confirmation.checked = true;
  confirmation.dispatch("change");
}

async function settleAction(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("legacy review keeps the candidate DOM bounded while selection covers the full plan", () => {
  const plan = reviewPlan(650);
  const harness = reviewHost(plan);
  const { content } = openReviewModal(harness.host, plan);

  assert.equal(content.querySelectorAll(".ent-cc-legacy-review-candidate").length, 300);
  assert.match(content.querySelector(".ent-cc-legacy-review-page-status")?.textContent ?? "", /1.*300.*650/u);
  assert.match(content.querySelector(".ent-cc-legacy-review-summary")?.textContent ?? "", /650 notes become/u);

  const firstPageCheckbox = content.querySelectorAll(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]")[0] as unknown as FakeElement & { checked: boolean };
  firstPageCheckbox.checked = false;
  firstPageCheckbox.dispatch("change");

  button(content, "Next").click();
  assert.equal(content.querySelectorAll(".ent-cc-legacy-review-candidate").length, 300);
  assert.match(content.querySelector(".ent-cc-legacy-review-page-status")?.textContent ?? "", /301.*600.*650/u);
  assert.equal(content.querySelectorAll(".ent-cc-legacy-review-candidate-title")[0]?.textContent, "Topic 300");
  button(content, "Previous").click();
  assert.equal(
    (content.querySelectorAll(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]")[0] as unknown as { checked: boolean }).checked,
    false,
    "selection persists when a bounded page is destroyed and rebuilt",
  );

  const filter = content.querySelector("input[type=\"search\"]") as unknown as FakeElement & { value: string };
  filter.value = "Topic 649";
  filter.dispatch("input");
  assert.equal(content.querySelectorAll(".ent-cc-legacy-review-candidate").length, 1);
  assert.equal(content.querySelector(".ent-cc-legacy-review-candidate-title")?.textContent, "Topic 649");
  const filteredCheckbox = content.querySelector(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]");
  assert.ok(filteredCheckbox?.getAttribute("aria-labelledby"));
  assert.ok(filteredCheckbox?.getAttribute("aria-describedby"));

  button(content, "Clear all notes").click();
  assert.match(content.querySelector(".ent-cc-legacy-review-summary")?.textContent ?? "", /0 notes become.*650 notes leave/u);
  assert.equal((content.querySelector(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]") as unknown as { checked: boolean }).checked, false);
});

test("Apply sends the exact reviewed plan and selected paths, then resolves and closes", async () => {
  const plan = reviewPlan(2);
  const harness = reviewHost(plan);
  const surface = openReviewModal(harness.host, plan);
  assert.equal((button(surface.content, "Apply review & unlink") as unknown as { disabled: boolean }).disabled, true);
  confirmSync(surface.content);
  const first = surface.content.querySelectorAll(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]")[0] as unknown as FakeElement & { checked: boolean };
  first.checked = false;
  first.dispatch("change");

  button(surface.content, "Apply review & unlink").click();
  await settleAction();

  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied[0]?.plan, plan, "the host receives the exact preview it must revalidate");
  assert.deepEqual(harness.applied[0]?.preservePaths, [plan.candidates[1]?.path]);
  assert.equal(harness.applied[0]?.syncContentsConfirmed, true);
  assert.equal(harness.kept.length, 0);
  assert.equal(surface.resolved(), 1);
  assert.equal(surface.closed(), 1);
});

test("Keep linked is an explicit provenance choice and Not now performs no write", async () => {
  const keepPlan = reviewPlan(1);
  const keepHost = reviewHost(keepPlan);
  const keepSurface = openReviewModal(keepHost.host, keepPlan);
  button(keepSurface.content, "Keep linked").click();
  await settleAction();
  assert.deepEqual(keepHost.kept, [keepPlan]);
  assert.equal(keepHost.applied.length, 0);
  assert.equal(keepSurface.resolved(), 1);
  assert.equal(keepSurface.closed(), 1);

  const laterPlan = reviewPlan(1);
  const laterHost = reviewHost(laterPlan);
  const laterSurface = openReviewModal(laterHost.host, laterPlan);
  assert.match(laterSurface.content.textContent, /Not now changes nothing.*warning remain/iu);
  button(laterSurface.content, "Not now").click();
  assert.equal(laterHost.kept.length, 0);
  assert.equal(laterHost.applied.length, 0);
  assert.equal(laterSurface.resolved(), 0);
  assert.equal(laterSurface.closed(), 1, "Escape/Not now lifecycle releases the active-modal claim");
  laterSurface.modal.onClose();
  assert.equal(laterSurface.closed(), 1, "a repeated close signal cannot release another modal's claim");
});

test("an in-flight review cannot be dismissed into a second stale modal", async () => {
  const plan = reviewPlan(1);
  const harness = reviewHost(plan);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  harness.host.applyLegacyIndexReview = async () => pending;
  const surface = openReviewModal(harness.host, plan);
  confirmSync(surface.content);
  button(surface.content, "Apply review & unlink").click();
  await Promise.resolve();
  assert.equal(surface.content.getAttribute("aria-busy"), "true");
  assert.match(surface.content.querySelector(".ent-cc-legacy-review-working")?.textContent ?? "", /Undo checkpoint/u);
  assert.equal((surface.content.querySelector("input[type=\"search\"]") as unknown as { disabled: boolean }).disabled, true);

  Notice.messages.length = 0;
  LegacyIndexReviewModal.prototype.close.call(surface.modal);
  assert.equal(surface.closed(), 0);
  assert.match(Notice.messages.join("\n"), /Wait for the current legacy Index action/i);

  release();
  await settleAction();
  assert.equal(surface.closed(), 1);
});

test("an oversized direct conversion defaults to no selection and explains its capacity", () => {
  const plan = reviewPlan(2);
  plan.preserveCapacity = 1;
  const harness = reviewHost(plan);
  const surface = openReviewModal(harness.host, plan);
  assert.match(surface.content.querySelector(".ent-cc-legacy-review-capacity")?.textContent ?? "", /at most 1 more direct member/i);
  assert.match(surface.content.querySelector(".ent-cc-legacy-review-summary")?.textContent ?? "", /0 notes become.*2 notes leave/i);
  assert.equal((button(surface.content, "Select all notes") as unknown as { disabled: boolean }).disabled, true);
});

test("read-only and stale-base guards prevent every membership write", async () => {
  const readOnlyPlan = reviewPlan(1);
  const readOnlyHost = reviewHost(readOnlyPlan);
  readOnlyHost.setReadOnly(true);
  const protectedSurface = openReviewModal(readOnlyHost.host, readOnlyPlan);
  assert.equal((button(protectedSurface.content, "Apply review & unlink") as unknown as { disabled: boolean }).disabled, true);
  assert.equal((button(protectedSurface.content, "Keep linked") as unknown as { disabled: boolean }).disabled, true);
  assert.equal(
    (protectedSurface.content.querySelector(".ent-cc-legacy-review-candidate input[type=\"checkbox\"]") as unknown as { disabled: boolean }).disabled,
    true,
  );

  const stalePlan = reviewPlan(1);
  const staleHost = reviewHost(stalePlan);
  const staleSurface = openReviewModal(staleHost.host, stalePlan);
  confirmSync(staleSurface.content);
  staleHost.replaceData();
  Notice.messages.length = 0;
  button(staleSurface.content, "Apply review & unlink").click();
  await settleAction();
  assert.equal(staleHost.applied.length, 0);
  assert.equal(staleSurface.closed(), 1);
  assert.match(Notice.messages.join("\n"), /data changed/i);
});

test("a plan-refresh exception closes safely without an unhandled write", async () => {
  const plan = reviewPlan(1);
  const harness = reviewHost(plan);
  const surface = openReviewModal(harness.host, plan);
  confirmSync(surface.content);
  harness.host.getLegacyIndexReviewPlans = () => { throw new Error("folder disappeared during Sync"); };
  Notice.messages.length = 0;

  button(surface.content, "Apply review & unlink").click();
  await settleAction();

  assert.equal(harness.applied.length, 0);
  assert.equal(surface.closed(), 1);
  assert.match(Notice.messages.join("\n"), /source changed/iu);
});

test("unavailable folders cannot unlink, while Keep linked and Not now remain safe", async () => {
  const plan = reviewPlan(0);
  plan.sourceFolderAvailable = false;
  const harness = reviewHost(plan);
  const surface = openReviewModal(harness.host, plan);
  assert.match(surface.content.textContent, /not available.*Sync finish/iu);
  assert.equal(surface.content.querySelector(".ent-cc-legacy-review-sync-confirmation"), null);
  assert.equal((button(surface.content, "Apply review & unlink") as unknown as { disabled: boolean }).disabled, true);
  Notice.messages.length = 0;
  button(surface.content, "Apply review & unlink").click();
  await settleAction();
  assert.equal(harness.applied.length, 0);
  assert.match(Notice.messages.join("\n"), /Wait for Obsidian Sync/iu);

  button(surface.content, "Keep linked").click();
  await settleAction();
  assert.deepEqual(harness.kept, [plan]);
});

test("Settings exposes a persistent migration warning until the legacy source is resolved", () => {
  const plan = reviewPlan(2);
  const data = migrateData(null);
  data.indexFolderSources = [{ ...plan.source }];
  const host = {
    app: {
      vault: { configDir: ".obsidian", getAllLoadedFiles: () => [], getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
    },
    data,
    dataCompatibilityWarning: "",
    isDataReadOnly: () => false,
    getKnowledgeBases: () => [{ id: "base-main", data }],
    getActiveKnowledgeBaseId: () => "base-main",
    getDataEpoch: () => 0,
    getExternalChangeGeneration: () => 0,
    getLegacyIndexReviewPlans: () => [plan],
    getIndexRecords: () => [],
    getLibraries: () => [],
    librarySubjectCount: () => 0,
    getTemplateFiles: () => [],
    getIndexGroups: () => [],
    getFollowUpCategories: () => [],
    replaceFollowUpCategories: async () => undefined,
    countOrphanedByPrimaryFolderChange: () => 0,
    countOrphanedByProposalFolderChange: () => 0,
    savePluginData: async () => undefined,
    saveCompensatingRollback: async () => undefined,
    markPersistenceUncertain: () => undefined,
    refreshViews: async () => undefined,
    switchKnowledgeBase: async () => undefined,
    renameKnowledgeBase: async () => undefined,
  };
  const tab = new EntCommandCenterSettingsTab(host.app as never, host as never);
  const warning = tab.getSettingDefinitions().find((definition) => (
    "heading" in definition && definition.heading === "Index migration review required"
  ));
  assert.ok(warning && "items" in warning);
  const warningText = warning.items.flatMap((item) => (
    "desc" in item && typeof item.desc === "string" ? [item.desc] : []
  )).join("\n");
  assert.match(warningText, /2 source-only Markdown notes/u);

  host.getLegacyIndexReviewPlans = () => [];
  assert.equal(tab.getSettingDefinitions().some((definition) => (
    "heading" in definition && definition.heading === "Index migration review required"
  )), false);
});
