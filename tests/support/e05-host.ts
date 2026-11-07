import { TFile } from "./obsidian-stub.ts";
import EntVaultCommandCenterPlugin from "../../src/main.ts";
import { VIEW_TYPE } from "../../src/view.ts";
import type { PluginData, PluginStore } from "../../src/model.ts";

/**
 * Synthetic E05 host: a started plugin (real onload, real registered event
 * callbacks) whose vault and metadata cache count the work production code does.
 * Counters, never wall-clock time, are what the E05 tests assert on.
 */
export type ResolvedLinks = Record<string, Record<string, number>>;

export interface E05Counters {
  /** getMarkdownFiles calls (whole-vault enumerations). */
  enumerations: number;
  /** getFileCache calls (metadata projection reads). */
  metadataReads: number;
  /** Object.keys/entries over the resolvedLinks root (whole-graph scans). */
  resolvedRootEnumerations: number;
  /** Property reads of one source's edge map through resolvedLinks. */
  resolvedSourceReads: number;
}

export interface E05Host {
  plugin: EntVaultCommandCenterPlugin;
  app: {
    vault: { getMarkdownFiles(): TFile[]; getAbstractFileByPath(path: string): unknown };
    workspace: { getLeavesOfType(type: string): unknown[] };
    metadataCache: { resolvedLinks: ResolvedLinks; getFileCache(file: TFile): unknown };
  };
  files: TFile[];
  frontmatter: Record<string, Record<string, unknown>>;
  /** Raw graph: mutate this to simulate Obsidian updating resolvedLinks. */
  resolvedLinks: ResolvedLinks;
  /** Swap the whole resolvedLinks object, as Obsidian can after a full resolve. */
  replaceResolvedLinks(next: ResolvedLinks): void;
  counters: E05Counters;
  resetCounters(): void;
  /** Dispatch to every callback the plugin registered for a metadataCache event. */
  emitMetadata(name: "changed" | "resolve" | "resolved", ...args: unknown[]): void;
  /** Dispatch to every callback the plugin registered for a vault event. */
  emitVault(name: "create" | "delete" | "rename" | "modify", ...args: unknown[]): void;
  /** Records scheduleRefresh(invalidateRecords) calls made by the plugin. */
  scheduledRefreshes: boolean[];
  /** Number of registered callbacks per metadataCache event name. */
  metadataListenerCount(name: string): number;
}

export interface E05HostOptions {
  data: PluginData | PluginStore;
  files: TFile[];
  frontmatter?: Record<string, Record<string, unknown>>;
  resolvedLinks?: ResolvedLinks;
  /** A Command Center view is open (outside notes then schedule a refresh). */
  viewOpen?: boolean;
}

interface PluginTestSeam {
  loadedData: unknown;
  scheduleRefresh: (invalidateRecords?: boolean) => void;
  registerObsidianProtocolHandler: () => void;
  manifest: { id: string; name: string; version: string };
}

export async function startE05Host(options: E05HostOptions): Promise<E05Host> {
  const files = options.files;
  const frontmatter = options.frontmatter ?? {};
  let rawLinks: ResolvedLinks = options.resolvedLinks ?? {};
  const counters: E05Counters = { enumerations: 0, metadataReads: 0, resolvedRootEnumerations: 0, resolvedSourceReads: 0 };
  const metadataListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const vaultListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const scheduledRefreshes: boolean[] = [];
  let deviceState: unknown = null;

  const countedLinks = (): ResolvedLinks => new Proxy({} as ResolvedLinks, {
    ownKeys: () => { counters.resolvedRootEnumerations += 1; return Reflect.ownKeys(rawLinks); },
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(rawLinks, key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    has: (_target, key) => Reflect.has(rawLinks, key),
    get: (_target, key) => {
      if (typeof key === "string") counters.resolvedSourceReads += 1;
      return Reflect.get(rawLinks, key);
    },
  });

  const forbidden = (): never => { throw new Error("E05 host: a vault mutation was attempted."); };
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: (): TFile[] => { counters.enumerations += 1; return files; },
      getAbstractFileByPath: (path: string): unknown => files.find((file) => file.path === path) ?? null,
      on: (name: string, callback: (...args: unknown[]) => void): unknown => {
        vaultListeners.set(name, [...(vaultListeners.get(name) ?? []), callback]);
        return { unsubscribe: () => {} };
      },
      modify: forbidden, process: forbidden, create: forbidden, delete: forbidden, rename: forbidden,
    },
    workspace: {
      onLayoutReady: (callback: () => void): void => { layoutReady = callback; },
      getLeavesOfType: (type: string): unknown[] => (type === VIEW_TYPE && options.viewOpen !== false ? [{}] : []),
    },
    metadataCache: {
      getFileCache: (file: TFile): unknown => {
        counters.metadataReads += 1;
        return { frontmatter: frontmatter[file.path] ?? {} };
      },
      on: (name: string, callback: (...args: unknown[]) => void): unknown => {
        metadataListeners.set(name, [...(metadataListeners.get(name) ?? []), callback]);
        return { unsubscribe: () => {} };
      },
      resolvedLinks: countedLinks(),
    },
    fileManager: { renameFile: forbidden, processFrontMatter: forbidden },
    loadLocalStorage: (): unknown => structuredClone(deviceState),
    saveLocalStorage: (_key: string, value: unknown): void => { deviceState = structuredClone(value); },
  };
  let layoutReady: (() => void) | null = null;

  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  const seam = plugin as unknown as PluginTestSeam;
  seam.loadedData = options.data;
  seam.manifest = { id: "ent-vault-command-center", name: "Knowledge Base Command Center", version: "0.26.0" };
  seam.registerObsidianProtocolHandler = () => {};
  seam.scheduleRefresh = (invalidateRecords = true) => { scheduledRefreshes.push(invalidateRecords); };
  await plugin.onload();
  if (!layoutReady) throw new Error("E05 host: plugin did not defer listeners to layout readiness.");
  (layoutReady as () => void)();

  const emit = (listeners: Map<string, Array<(...args: unknown[]) => void>>, name: string, args: unknown[]): void => {
    for (const callback of listeners.get(name) ?? []) callback(...args);
  };
  const host: E05Host = {
    plugin,
    app: app as never,
    files,
    frontmatter,
    get resolvedLinks(): ResolvedLinks { return rawLinks; },
    replaceResolvedLinks(next: ResolvedLinks): void { rawLinks = next; },
    counters,
    resetCounters(): void {
      counters.enumerations = 0;
      counters.metadataReads = 0;
      counters.resolvedRootEnumerations = 0;
      counters.resolvedSourceReads = 0;
    },
    emitMetadata: (name, ...args) => emit(metadataListeners, name, args),
    emitVault: (name, ...args) => emit(vaultListeners, name, args),
    scheduledRefreshes,
    metadataListenerCount: (name) => metadataListeners.get(name)?.length ?? 0,
  };
  // Obsidian's final resolution fence: the initial `resolved` repair happens once.
  host.emitMetadata("resolved");
  scheduledRefreshes.length = 0;
  host.resetCounters();
  return host;
}
