import { isValidLibraryId, libraryIdFromTab, type MainTab } from "./model";

export const KBCC_RETURN_NAVIGATION_VERSION = 1;
export const MAX_KBCC_RETURN_ROUTES = 24;
export const MAX_KBCC_RETURN_BROWSE_LIMIT = 10_000;
export const MAX_KBCC_RETURN_STATE_BYTES = 256 * 1024;
const MAX_ROUTE_PATH_LENGTH = 4_096;
const MAX_ROUTE_QUERY_LENGTH = 10_000;
const MAX_ROUTE_SCROLL = 1_000_000_000;

/** Volatile Command Center UI state needed to return to the exact prior page. */
export interface KbccReturnViewState {
  activeTab: MainTab;
  selectedPath: string;
  query: string;
  detailVisible: boolean;
  browseRowLimit: number;
  browseStructureLimit: number;
  listScrollTop: number;
  detailScrollTop: number;
}

/** Latest saved destination for one note path; not per-editor navigation history. */
export interface KbccReturnRoute {
  notePath: string;
  baseId: string;
  capturedAt: number;
  view: KbccReturnViewState;
}

/** Stored through App.saveLocalStorage, never through synced plugin data. */
export interface KbccReturnNavigationState {
  version: typeof KBCC_RETURN_NAVIGATION_VERSION;
  vaultId: string;
  routes: KbccReturnRoute[];
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("KBCC return navigation is not serializable.");
  return new TextEncoder().encode(serialized).byteLength;
}

function strictText(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string"
    || value.length > maxLength
    || (!allowEmpty && value.length === 0)
    || /\p{Cc}/u.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  // Vault paths are opaque identifiers supplied by Obsidian. In particular,
  // macOS may expose decomposed Unicode; normalizing here would break exact
  // lookup, rename, and delete matching after restart.
  return value;
}

function strictStableId(value: unknown, label: string): string {
  if (!isValidLibraryId(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function strictMainTab(value: unknown, label: string): MainTab {
  if (value === "curriculum" || value === "inbox" || value === "collections" || value === "queues") return value;
  const libraryId = libraryIdFromTab(value);
  if (libraryId) return `library:${libraryId}`;
  throw new Error(`${label} is malformed.`);
}

function strictScroll(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_ROUTE_SCROLL) {
    throw new Error(`${label} is malformed.`);
  }
  return Math.round(value);
}

function strictBrowseLimit(value: unknown, label: string): number {
  if (typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_KBCC_RETURN_BROWSE_LIMIT) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function strictPath(value: unknown, label: string, allowEmpty = false): string {
  const path = strictText(value, label, MAX_ROUTE_PATH_LENGTH, allowEmpty);
  if (path && (path.startsWith("/") || path.endsWith("/") || path.includes("\\"))) {
    throw new Error(`${label} is malformed.`);
  }
  return path;
}

function parseViewState(input: unknown, label: string): KbccReturnViewState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${label} is malformed.`);
  const value = input as Record<string, unknown>;
  if (typeof value.detailVisible !== "boolean") throw new Error(`${label} is malformed.`);
  return {
    activeTab: strictMainTab(value.activeTab, `${label} active tab`),
    selectedPath: strictPath(value.selectedPath, `${label} selected path`, true),
    query: strictText(value.query, `${label} query`, MAX_ROUTE_QUERY_LENGTH, true),
    detailVisible: value.detailVisible,
    browseRowLimit: strictBrowseLimit(value.browseRowLimit, `${label} row limit`),
    browseStructureLimit: strictBrowseLimit(value.browseStructureLimit, `${label} structure limit`),
    listScrollTop: strictScroll(value.listScrollTop, `${label} list scroll`),
    detailScrollTop: strictScroll(value.detailScrollTop, `${label} detail scroll`),
  };
}

export function parseKbccReturnRoute(input: unknown, label = "KBCC return route"): KbccReturnRoute {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${label} is malformed.`);
  const value = input as Record<string, unknown>;
  const capturedAt = value.capturedAt;
  if (typeof capturedAt !== "number" || !Number.isSafeInteger(capturedAt) || capturedAt < 0) {
    throw new Error(`${label} capture time is malformed.`);
  }
  const notePath = strictPath(value.notePath, `${label} note path`);
  if (!/\.md$/iu.test(notePath)) throw new Error(`${label} does not identify a Markdown note.`);
  return {
    notePath,
    baseId: strictStableId(value.baseId, `${label} knowledge base`),
    capturedAt,
    view: parseViewState(value.view, `${label} view`),
  };
}

/** Strictly parse bounded, vault-scoped return history. Malformed state is disposable. */
export function parseKbccReturnNavigationState(input: unknown): KbccReturnNavigationState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("KBCC return navigation is malformed.");
  }
  if (serializedBytes(input) > MAX_KBCC_RETURN_STATE_BYTES) {
    throw new Error("KBCC return navigation is too large.");
  }
  const value = input as Record<string, unknown>;
  if (value.version !== KBCC_RETURN_NAVIGATION_VERSION
    || !Array.isArray(value.routes)
    || value.routes.length > MAX_KBCC_RETURN_ROUTES) {
    throw new Error("KBCC return navigation has an unsupported or malformed shape.");
  }
  const seenPaths = new Set<string>();
  const routes = value.routes.map((route, index) => {
    const parsed = parseKbccReturnRoute(route, `KBCC return route ${index + 1}`);
    if (seenPaths.has(parsed.notePath)) throw new Error("KBCC return navigation contains duplicate note paths.");
    seenPaths.add(parsed.notePath);
    return parsed;
  });
  return {
    version: KBCC_RETURN_NAVIGATION_VERSION,
    vaultId: strictStableId(value.vaultId, "KBCC return navigation vault"),
    routes,
  };
}

function routeWithoutSelectedDetail(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const route = input as Record<string, unknown>;
  if (!route.view || typeof route.view !== "object" || Array.isArray(route.view)) return input;
  return {
    ...route,
    view: {
      ...(route.view as Record<string, unknown>),
      selectedPath: "",
      detailVisible: false,
      detailScrollTop: 0,
    },
  };
}

function parseRouteFailOpen(input: unknown): KbccReturnRoute | null {
  try {
    return parseKbccReturnRoute(input);
  } catch {
    // A folder rename can make only a selected-record path exceed the route
    // bound while the note's own return destination is still usable. Retain
    // that page without its stale detail route; any other malformed route is
    // disposable device-local convenience state.
    try {
      return parseKbccReturnRoute(routeWithoutSelectedDetail(input));
    } catch {
      return null;
    }
  }
}

/**
 * Rebuild route history through the same strict parser and byte budget used
 * at capture time. Rename maintenance uses this after replacing path prefixes
 * so one grown/invalid route cannot make every unrelated route unreadable on
 * the next restart.
 */
export function rebuildBoundedKbccReturnNavigationState(
  vaultId: string,
  inputs: readonly unknown[],
): KbccReturnNavigationState {
  const cleanVaultId = strictStableId(vaultId, "KBCC return navigation vault");
  const routes = inputs
    .map((input) => parseRouteFailOpen(input))
    .filter((route): route is KbccReturnRoute => route !== null);
  // Array order is the authoritative recency order. Wall clocks can move
  // backwards or repeat a millisecond, so sorting by capturedAt could evict the
  // route the user just opened when a full history is rebuilt. Every writer
  // supplies newest-first input; rename maintenance preserves that order.
  const seenPaths = new Set<string>();
  const uniqueRoutes = routes.filter((route) => {
    if (seenPaths.has(route.notePath)) return false;
    seenPaths.add(route.notePath);
    return true;
  }).slice(0, MAX_KBCC_RETURN_ROUTES);
  const next: KbccReturnNavigationState = {
    version: KBCC_RETURN_NAVIGATION_VERSION,
    vaultId: cleanVaultId,
    routes: uniqueRoutes,
  };
  // Queries are the only large field that can be discarded without changing
  // the route's base/tab identity. Preserve newer routes exactly and compact
  // older searches first, then drop only the oldest whole routes if needed.
  for (let index = next.routes.length - 1;
    index >= 0 && serializedBytes(next) > MAX_KBCC_RETURN_STATE_BYTES;
    index -= 1) {
    const candidate = next.routes[index];
    if (candidate) candidate.view.query = "";
  }
  while (next.routes.length > 0 && serializedBytes(next) > MAX_KBCC_RETURN_STATE_BYTES) {
    next.routes.pop();
  }
  return next;
}

/** Replace or add one note route and keep only the newest bounded history. */
export function rememberKbccReturnRoute(
  current: KbccReturnNavigationState | null,
  vaultId: string,
  route: KbccReturnRoute,
): KbccReturnNavigationState {
  const cleanVaultId = strictStableId(vaultId, "KBCC return navigation vault");
  const cleanRoute = parseKbccReturnRoute(route);
  const retained = current?.vaultId === cleanVaultId
    ? current.routes.filter((candidate) => candidate.notePath !== cleanRoute.notePath)
    : [];
  const next = rebuildBoundedKbccReturnNavigationState(cleanVaultId, [cleanRoute, ...retained]);
  if (serializedBytes(next) > MAX_KBCC_RETURN_STATE_BYTES) {
    throw new Error("The KBCC return destination is too large to preserve safely.");
  }
  return next;
}

export function kbccReturnRouteForNote(
  state: KbccReturnNavigationState | null,
  vaultId: string,
  notePath: string,
): KbccReturnRoute | null {
  if (!state || state.vaultId !== vaultId) return null;
  return state.routes.find((route) => route.notePath === notePath) ?? null;
}
