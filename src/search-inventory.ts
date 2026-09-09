export type SearchCheckpoint = () => boolean | Promise<boolean>;

/**
 * Keep cheap scan steps synchronous, but yield an actual browser task before
 * preparation grows and whenever a 4 ms work slice expires. A fixed default
 * item count causes thousands of clamped timers in large, inexpensive scans.
 * Explicit yieldEvery remains count-driven for deterministic callers/tests.
 */
export function createSearchCheckpoint(cancelled: () => boolean, yieldEvery?: number): SearchCheckpoint {
  const workLimit = Math.max(1, Math.floor(yieldEvery ?? Number.POSITIVE_INFINITY));
  let firstYield = yieldEvery === undefined;
  let workSinceYield = 0;
  let sliceStartedAt = performance.now();
  return () => {
    if (cancelled()) return false;
    workSinceYield += 1;
    if (!firstYield && workSinceYield < workLimit
      && (yieldEvery !== undefined || performance.now() - sliceStartedAt < 4)) return true;
    firstYield = false;
    workSinceYield = 0;
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined") queueMicrotask(resolve);
      else window.activeWindow.setTimeout(resolve, 0);
    }).then(() => {
      sliceStartedAt = performance.now();
      return !cancelled();
    });
  };
}

/** Sort a large inventory in bounded runs, yielding during preparation and merge. */
export async function sortSearchInventory<T extends { path: string }>(
  input: readonly T[],
  checkpoint: SearchCheckpoint,
): Promise<T[] | null> {
  const runSize = 512;
  let runs: T[][] = [];
  for (let start = 0; start < input.length; start += runSize) {
    runs.push(input.slice(start, start + runSize).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const ready = checkpoint();
    if (ready === false || (ready !== true && !await ready)) return null;
  }
  while (runs.length > 1) {
    const mergedRuns: T[][] = [];
    for (let run = 0; run < runs.length; run += 2) {
      const left = runs[run] ?? [];
      const right = runs[run + 1];
      if (!right) { mergedRuns.push(left); continue; }
      const merged: T[] = [];
      let a = 0;
      let b = 0;
      while (a < left.length || b < right.length) {
        if (b >= right.length || a < left.length && left[a].path <= right[b].path) merged.push(left[a++]);
        else merged.push(right[b++]);
        if (merged.length % runSize === 0) {
          const ready = checkpoint();
          if (ready === false || (ready !== true && !await ready)) return null;
        }
      }
      mergedRuns.push(merged);
      const ready = checkpoint();
      if (ready === false || (ready !== true && !await ready)) return null;
    }
    runs = mergedRuns;
  }
  return runs[0] ?? [];
}
