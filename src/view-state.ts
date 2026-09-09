/** Stable focus identities survive replacement of a rendered subtree. */
export interface ViewFocusSnapshot {
  key: string;
  id: string;
  label: string;
  tag: string;
}

export function captureViewFocus(root: HTMLElement | undefined): ViewFocusSnapshot | null {
  const active = root?.ownerDocument?.activeElement as HTMLElement | null;
  if (!root) return null;
  if (!active || !root.contains(active)) return null;
  return {
    key: active.getAttribute("data-kbcc-focus") ?? "",
    id: active.getAttribute("id") ?? "",
    label: active.getAttribute("aria-label") ?? active.getAttribute("title") ?? active.textContent ?? "",
    tag: active.tagName.toLowerCase(),
  };
}

export function restoreViewFocus(root: HTMLElement, snapshot: ViewFocusSnapshot | null): boolean {
  if (!snapshot) return false;
  // Compare values rather than interpolating vault text into CSS selectors.
  const candidates = root.querySelectorAll<HTMLElement>(snapshot.tag);
  for (const candidate of Array.from(candidates)) {
    const matches = snapshot.key ? candidate.getAttribute("data-kbcc-focus") === snapshot.key
      : snapshot.id ? candidate.getAttribute("id") === snapshot.id
        : snapshot.label && (candidate.getAttribute("aria-label") ?? candidate.getAttribute("title") ?? candidate.textContent) === snapshot.label;
    if (matches && !candidate.hasAttribute("disabled")) {
      candidate.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

export function readableStatus(value: string): string {
  const text = value.trim().replace(/[_-]+/gu, " ");
  return text ? `${text[0]?.toLocaleUpperCase() ?? ""}${text.slice(1)}` : "Not recorded";
}

export function recordAvailabilitySummary(records: readonly { isPlaceholder?: boolean }[]): string {
  const placeholders = records.filter((record) => record.isPlaceholder).length;
  const linked = records.length - placeholders;
  return `${records.length} ${records.length === 1 ? "entry" : "entries"} · ${linked} linked ${linked === 1 ? "note" : "notes"} · ${placeholders} ${placeholders === 1 ? "placeholder" : "placeholders"}`;
}

export function relativeUpdatedTime(mtime: number, now = Date.now()): string {
  if (!Number.isFinite(mtime) || mtime <= 0) return "Update time unavailable";
  const minutes = Math.max(0, Math.floor((now - mtime) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} ${days === 1 ? "day" : "days"} ago`;
}
