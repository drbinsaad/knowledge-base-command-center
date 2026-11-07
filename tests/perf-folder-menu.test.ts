import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile, TFolder } from "./support/obsidian-stub.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";

/**
 * E05 follow-up 2: choosing the file/files context menu must not enumerate the
 * whole vault before an action is chosen. Counters on the synthetic vault, no
 * timing. Red tests carry node:test `todo` until the implementation lands.
 */
const PENDING = { todo: "E05 implementation pending" } as const;
const SELECTION_CAP = 5_000;
const CANDIDATE_CAP = 250_000;

interface MenuAction { title: string; enabled: boolean; click: () => void }

interface MenuHost {
  enumerations: () => number;
  metadataReads: () => number;
  opened: Array<{ paths: readonly string[]; source: string }>;
  callbacks: Map<string, (...args: never[]) => void>;
  openMenu(event: "file-menu" | "files-menu", target: unknown): MenuAction[];
  openEditorMenu(file: TFile): MenuAction[];
  vaultFiles: TFile[];
}

function menuHost(vaultFiles: TFile[], extra: Array<TFile | TFolder> = []): MenuHost {
  let enumerations = 0;
  let metadataReads = 0;
  const lookup = (path: string): unknown => vaultFiles.find((file) => file.path === path)
    ?? extra.find((item) => item.path === path) ?? null;
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => { enumerations += 1; return [...vaultFiles]; },
      getAbstractFileByPath: lookup,
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => { metadataReads += 1; return { frontmatter: {} }; }, resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: (): unknown => null,
    saveLocalStorage: (): void => {},
  };
  const callbacks = new Map<string, (...args: never[]) => void>();
  Object.assign(app.workspace, { on: (event: string, callback: (...args: never[]) => void) => { callbacks.set(event, callback); return {}; } });
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as unknown as {
    openNoteOrganizer: (paths?: readonly string[], source?: string) => void;
    registerNoteOrganizerContextMenus: () => void;
  };
  const opened: MenuHost["opened"] = [];
  plugin.openNoteOrganizer = (paths = [], source = "command") => { opened.push({ paths, source }); };
  plugin.registerNoteOrganizerContextMenus();
  const surface = (): { menu: unknown; actions: MenuAction[] } => {
    const actions: MenuAction[] = [];
    const menu = {
      addSeparator: () => {},
      addItem: (build: (item: unknown) => void) => {
        const action: MenuAction = { title: "", enabled: true, click: () => {} };
        const item = {
          setTitle: (title: string) => { action.title = title; return item; },
          setIcon: () => item,
          setDisabled: (disabled: boolean) => { action.enabled = !disabled; return item; },
          onClick: (click: () => void) => { action.click = click; return item; },
        };
        build(item);
        actions.push(action);
      },
    };
    return { menu, actions };
  };
  return {
    enumerations: () => enumerations,
    metadataReads: () => metadataReads,
    opened,
    callbacks,
    vaultFiles,
    openMenu(event, target) {
      const { menu, actions } = surface();
      callbacks.get(event)?.(menu as never, target as never);
      return actions;
    },
    openEditorMenu(file) {
      const { menu, actions } = surface();
      callbacks.get("editor-menu")?.(menu as never, {} as never, { file } as never);
      return actions;
    },
  };
}

/** 30 direct + 20 nested notes in "Subtree", plus outside, non-Markdown and protected neighbours. */
function subtreeFixture() {
  const direct = Array.from({ length: 30 }, (_, index) => new TFile(`Subtree/Note ${String(index).padStart(2, "0")}.md`));
  const nested = Array.from({ length: 20 }, (_, index) => new TFile(`Subtree/Nested/Deep ${String(index).padStart(2, "0")}.md`));
  const image = new TFile("Subtree/figure.png");
  const protectedNote = new TFile("05 Sources/_books/Book.md");
  const outside = Array.from({ length: 200 }, (_, index) => new TFile(`Outside/Other ${index}.md`));
  const sibling = new TFile("Subtreeish/Not inside.md");
  const nestedFolder = new TFolder("Subtree/Nested", nested);
  const folder = new TFolder("Subtree", [...direct, nestedFolder, image]);
  const vaultFiles = [...outside, sibling, protectedNote, ...direct, ...nested];
  const expected = [...direct, ...nested].map((file) => file.path).sort();
  return { folder, nestedFolder, direct, nested, vaultFiles, expected, outside };
}

const organize = (actions: MenuAction[]): MenuAction | undefined => actions.find((action) => /Organize/iu.test(action.title));

test("opening the single-folder menu performs no whole-vault expansion or metadata projection", PENDING, () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  const actions = host.openMenu("file-menu", fx.folder);
  assert.ok(actions.length >= 1, "the Organize entry is still offered");
  assert.equal(host.enumerations(), 0, "no getMarkdownFiles enumeration before an action is chosen");
  assert.equal(host.metadataReads(), 0);
  assert.equal(host.opened.length, 0, "opening the menu opens nothing");
});

test("opening a mixed folder/files menu performs no whole-vault expansion", PENDING, () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  host.openMenu("files-menu", [fx.folder, fx.outside[0]]);
  assert.equal(host.enumerations(), 0);
  assert.equal(host.metadataReads(), 0);
  assert.equal(host.opened.length, 0);
});

test("a deferred folder label does not claim a current-note count before it exists", PENDING, () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  const title = organize(host.openMenu("file-menu", fx.folder))?.title ?? "";
  assert.match(title, /Organize/u);
  assert.doesNotMatch(title, /\d/u, `label must not state a precise count: ${title}`);
});

test("control: file-only and editor menus keep their no-inventory fast path", () => {
  const file = new TFile("Subtree/Note 00.md");
  const host = menuHost([file, new TFile("Outside/Other.md")]);
  const fileActions = host.openMenu("file-menu", file);
  const filesActions = host.openMenu("files-menu", [file]);
  const editorActions = host.openEditorMenu(file);
  assert.ok(organize(fileActions) && organize(filesActions) && organize(editorActions));
  assert.equal(host.enumerations(), 0);
  organize(fileActions)?.click();
  assert.deepEqual(host.opened[0], { paths: [file.path], source: "file-menu" });
});

test("choosing Organize yields exactly the prior contract path set (sorted, restricted and non-Markdown excluded)", () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  const action = organize(host.openMenu("file-menu", fx.folder));
  assert.ok(action?.enabled);
  action.click();
  assert.equal(host.opened.length, 1);
  assert.deepEqual(host.opened[0]?.paths, fx.expected);
  assert.equal(host.opened[0]?.source, "file-menu");
  assert.ok(host.enumerations() <= 1, "at most one expansion, taken for the chosen action");
});

test("choosing Organize on overlapping file and folder selections does not multiply notes", () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  const action = organize(host.openMenu("files-menu", [fx.folder, fx.nestedFolder, fx.direct[3], fx.outside[0]]));
  assert.ok(action?.enabled);
  action.click();
  assert.deepEqual(host.opened[0]?.paths, [...fx.expected, fx.outside[0].path].sort());
});

test("additions and removals before the click are reflected in the one-time chosen snapshot", PENDING, () => {
  const fx = subtreeFixture();
  const host = menuHost(fx.vaultFiles, [fx.folder, fx.nestedFolder]);
  const action = organize(host.openMenu("file-menu", fx.folder));
  assert.ok(action);
  const added = new TFile("Subtree/Added later.md");
  host.vaultFiles.push(added);
  const removedPath = fx.direct[0].path;
  host.vaultFiles.splice(host.vaultFiles.findIndex((file) => file.path === removedPath), 1);
  action.click();
  const expected = [...fx.expected.filter((path) => path !== removedPath), added.path].sort();
  assert.deepEqual(host.opened[0]?.paths, expected, "the snapshot is the vault at click time, not menu-open time");
});

function capFixture(selectedNotes: number, extraOutside: number) {
  const inside = Array.from({ length: selectedNotes }, (_, index) => new TFile(`Big/${index}.md`));
  const outside = Array.from({ length: extraOutside }, (_, index) => new TFile(`Out/${index}.md`));
  const folder = new TFolder("Big", inside);
  return { folder, vaultFiles: [...inside, ...outside], inside };
}

/** Open, click if enabled, and report whether an Organizer was opened plus the explanation shown. */
function chooseOrganize(host: MenuHost, folder: TFolder): { opened: boolean; explanation: string } {
  Notice.messages.length = 0;
  const actions = host.openMenu("file-menu", folder);
  const disabledTitles = actions.filter((action) => !action.enabled).map((action) => action.title).join(" | ");
  const chosen = organize(actions);
  if (chosen?.enabled) chosen.click();
  return { opened: host.opened.length > 0, explanation: `${disabledTitles} ${Notice.messages.join(" | ")}` };
}

test("control: a folder at exactly the selected-note cap opens; cap+1 opens no partial Organizer", () => {
  const atCap = capFixture(SELECTION_CAP, 0);
  const atHost = menuHost(atCap.vaultFiles, [atCap.folder]);
  assert.equal(chooseOrganize(atHost, atCap.folder).opened, true);
  assert.equal(atHost.opened[0]?.paths.length, SELECTION_CAP);

  const over = capFixture(SELECTION_CAP + 1, 0);
  const overHost = menuHost(over.vaultFiles, [over.folder]);
  const result = chooseOrganize(overHost, over.folder);
  assert.equal(result.opened, false, "no partial Organizer");
  assert.match(result.explanation, /5,000|too large|reviewable/iu, "the established explanation is shown");
});

test("control: the 250,000-candidate cap holds at the cap and refuses at cap+1 with no partial Organizer", () => {
  const atCap = capFixture(3, CANDIDATE_CAP - 3);
  const atHost = menuHost(atCap.vaultFiles, [atCap.folder]);
  assert.equal(chooseOrganize(atHost, atCap.folder).opened, true);
  assert.equal(atHost.opened[0]?.paths.length, 3);

  const over = capFixture(3, CANDIDATE_CAP - 2);
  const overHost = menuHost(over.vaultFiles, [over.folder]);
  const result = chooseOrganize(overHost, over.folder);
  assert.equal(result.opened, false, "no partial Organizer");
  assert.match(result.explanation, /too large|250,000|snapshot|Narrow/iu, "the established explanation is shown");
});
