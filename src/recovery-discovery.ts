/**
 * Recovery-copy discovery (A07). Pure logic over an injected host interface:
 * no adapter, vault or DOM access. File names only nominate candidates; they
 * are never validation. Counts describe the inspected folders only, and an
 * unreadable or missing folder is never reported as proof of anything.
 * Private paths stay inside candidates and are never put in summary text.
 */
import {
  RECOVERY_COPY_LIMITS,
  checkRecoveryCopyDeclaredSize,
  parseRecoveryCopy,
  recoverySourceMatchesExactly,
  type RecoveryCopyParseResult,
  type RecoveryRestoreIntent,
} from "./recovery-copy";

export interface RecoveryHost {
  /** Direct children (file paths) of a folder, or null when it is missing or unreadable. */
  list(folder: string): Promise<readonly string[] | null>;
  /** Size and modified time of a file, or null when it is missing. */
  stat(path: string): Promise<{ size: number; mtime: number | null } | null>;
  /** The file's bytes or text. Callers check stat().size against the cap first. */
  read(path: string): Promise<Uint8Array | string>;
}

export type RecoveryCandidateOrigin = "export-folder" | "legacy-export-folder" | "kept-backup" | "chosen-file";

export interface RecoveryCandidate {
  /** Stable id for this discovery run; safe to show or log. */
  id: string;
  /** Private: only the host and loader use it. Never put it in UI text. */
  path: string;
  /** File name only. */
  displayName: string;
  origin: RecoveryCandidateOrigin;
  size: number | null;
  mtime: number | null;
}

export interface RecoveryDiscoveryInput {
  /** Configured export folders (vault-relative, no leading or trailing slash). */
  exportFolders: readonly string[];
  /** The legacy default export folder, when different. */
  legacyExportFolder?: string | null;
  /** The exact plugin directory holding data.json.bak-kept-* files. */
  pluginDir: string;
}

export interface RecoveryDiscoveryResult {
  candidates: RecoveryCandidate[];
  inspectedFolders: number;
  unreadableFolders: number;
  /** Candidates exist beyond what is listed. */
  truncated: boolean;
  /** Plain-language count; mentions no path. */
  summary: string;
}

export const RECOVERY_DISCOVERY_LIMITS = Object.freeze({
  /** Directory entries examined per folder. */
  maxEntriesPerFolder: 2_000,
  /** Matching files that are stat-ed for ordering. */
  maxStatted: 200,
  /** Candidates shown. */
  maxListed: 50,
});

const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;
const CONFLICT_NAME = new RegExp(`^knowledge-base-command-center-conflict-${STAMP}(?:-\\d+)?\\.json$`, "u");
const KEPT_PREFIX = "data.json.bak-kept-";

function cleanFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/gu, "");
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function directChild(folder: string, path: string): boolean {
  const prefix = folder === "" ? "" : `${folder}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

/** Wording for the counts; deliberately limited to what was inspected. */
export function describeRecoveryDiscovery(
  listed: number,
  inspectedFolders: number,
  unreadableFolders: number,
  partial: boolean,
  moreKnown = false,
): string {
  const folders = `${inspectedFolders} ${inspectedFolders === 1 ? "folder" : "folders"} checked`;
  const plural = listed === 1 ? "file" : "files";
  let found: string;
  if (listed === 0) {
    found = partial
      ? `No candidate files were found in the part of the ${folders} that was examined. The scan was partial, so candidates may exist that were not examined.`
      : `No candidate files were found in the ${folders}.`;
  } else if (moreKnown) {
    found = `Showing ${listed} candidate ${plural} in the ${folders}; more were found than are listed.`;
  } else if (partial) {
    found = `Found ${listed} candidate ${plural} in the part of the ${folders} that was examined. The scan was partial, so more may exist.`;
  } else {
    found = `Found ${listed} candidate ${plural} in the ${folders}.`;
  }
  const notes = [
    "A file name is only a hint: nothing is checked until you open it, and a listed file may not be restorable.",
    "Other folders and older locations are not searched, so this is not a count of every copy that exists.",
  ];
  if (unreadableFolders > 0) {
    notes.push(`${unreadableFolders} ${unreadableFolders === 1 ? "folder" : "folders"} could not be read; that does not mean nothing is there.`);
  }
  return [found, ...notes].join(" ");
}

/**
 * List a bounded, newest-first set of candidate copies. Never reads file
 * contents and never throws for a missing or failing folder.
 */
export async function discoverRecoveryCopies(
  host: RecoveryHost,
  input: RecoveryDiscoveryInput,
): Promise<RecoveryDiscoveryResult> {
  const limits = RECOVERY_DISCOVERY_LIMITS;
  const exportFolders: Array<[string, RecoveryCandidateOrigin]> = [];
  for (const folder of input.exportFolders) exportFolders.push([cleanFolder(folder), "export-folder"]);
  if (input.legacyExportFolder) exportFolders.push([cleanFolder(input.legacyExportFolder), "legacy-export-folder"]);
  const pluginDir = cleanFolder(input.pluginDir);

  const seenFolders = new Set<string>();
  const matches: Array<{ path: string; origin: RecoveryCandidateOrigin }> = [];
  const seenPaths = new Set<string>();
  // Distinct physical folders: one folder scanned under two filename rules counts once.
  const inspectedSet = new Set<string>();
  const unreadableSet = new Set<string>();
  let partialScan = false;
  let matchesBeyondStat = false;

  const scan = async (folder: string, origin: RecoveryCandidateOrigin, isMatch: (name: string) => boolean): Promise<void> => {
    const key = `${origin === "kept-backup" ? "k" : "e"}:${folder}`;
    if (seenFolders.has(key)) return;
    seenFolders.add(key);
    let entries: readonly string[] | null;
    try {
      entries = await host.list(folder);
    } catch {
      entries = null;
    }
    if (entries === null) {
      if (!inspectedSet.has(folder)) unreadableSet.add(folder);
      return;
    }
    inspectedSet.add(folder);
    unreadableSet.delete(folder);
    const bounded = entries.slice(0, limits.maxEntriesPerFolder);
    // Unexamined entries are not evidence of more candidates, only of an incomplete scan.
    if (entries.length > bounded.length) partialScan = true;
    for (const entry of bounded) {
      if (typeof entry !== "string" || !directChild(folder, entry) || seenPaths.has(entry)) continue;
      if (!isMatch(fileName(entry))) continue;
      seenPaths.add(entry);
      if (matches.length >= limits.maxStatted) {
        matchesBeyondStat = true; // a real candidate that was observed but not listed
        continue;
      }
      matches.push({ path: entry, origin });
    }
  };

  for (const [folder, origin] of exportFolders) await scan(folder, origin, (name) => CONFLICT_NAME.test(name));
  await scan(pluginDir, "kept-backup", (name) => name.startsWith(KEPT_PREFIX));

  const statted = await Promise.all(matches.map(async (match) => {
    let info: { size: number; mtime: number | null } | null = null;
    try {
      info = await host.stat(match.path);
    } catch {
      info = null;
    }
    return { ...match, size: info?.size ?? null, mtime: info?.mtime ?? null };
  }));
  statted.sort((left, right) => (right.mtime ?? -1) - (left.mtime ?? -1) || (right.path < left.path ? -1 : right.path > left.path ? 1 : 0));
  const moreKnown = matchesBeyondStat || statted.length > limits.maxListed;
  const truncated = partialScan || moreKnown;
  const inspectedFolders = inspectedSet.size;
  const unreadableFolders = unreadableSet.size;
  const candidates: RecoveryCandidate[] = statted.slice(0, limits.maxListed).map((item, index) => ({
    id: `copy-${index + 1}`,
    path: item.path,
    displayName: fileName(item.path),
    origin: item.origin,
    size: item.size,
    mtime: item.mtime,
  }));
  return {
    candidates,
    inspectedFolders,
    unreadableFolders,
    truncated,
    summary: describeRecoveryDiscovery(candidates.length, inspectedFolders, unreadableFolders, truncated, moreKnown),
  };
}

export type RecoveryCopyLoadResult =
  | { status: "parsed"; result: RecoveryCopyParseResult }
  /** The file is missing or could not be read. No path or error text is carried. */
  | { status: "unreadable" };

export interface LoadRecoveryCopyOptions {
  currentVaultId: string | null;
  now?: number;
}

/**
 * Stat, then read, one selected file and parse it. An oversized declared size
 * is rejected before any read.
 */
export async function loadRecoveryCopy(
  host: RecoveryHost,
  path: string,
  options: LoadRecoveryCopyOptions,
): Promise<RecoveryCopyLoadResult> {
  let info: { size: number; mtime: number | null } | null;
  try {
    info = await host.stat(path);
  } catch {
    return { status: "unreadable" };
  }
  if (info === null) return { status: "unreadable" };
  if (!Number.isFinite(info.size) || info.size < 0 || info.size > RECOVERY_COPY_LIMITS.maxBytes) {
    return { status: "parsed", result: parseRecoveryCopy({ content: "", declaredSize: info.size, currentVaultId: options.currentVaultId, now: options.now }) };
  }
  let content: Uint8Array | string;
  try {
    content = await host.read(path);
  } catch {
    return { status: "unreadable" };
  }
  return {
    status: "parsed",
    result: parseRecoveryCopy({ content, declaredSize: info.size, currentVaultId: options.currentVaultId, now: options.now }),
  };
}

/**
 * Apply-time check: reread the same file (bounded) and require byte-for-byte
 * equality with the bytes retained by the intent. Missing, unreadable,
 * oversized or changed input is false.
 */
export async function recoverySourceUnchanged(
  host: RecoveryHost,
  path: string,
  intent: Pick<RecoveryRestoreIntent, "retainedSource">,
): Promise<boolean> {
  try {
    const info = await host.stat(path);
    if (info === null || !checkRecoveryCopyDeclaredSize(info.size).ok) return false;
    return recoverySourceMatchesExactly(intent, await host.read(path));
  } catch {
    return false;
  }
}
