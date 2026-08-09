import { getIconIds } from "obsidian";

const FALLBACK_LIBRARY_ICON = "library";

let cachedRegistrySize = -1;
let cachedRegistry = new Set<string>();

/**
 * Resolve a stored Library icon for display without rewriting plugin data.
 *
 * Portable packages intentionally retain syntactically valid icon IDs so a
 * future Obsidian release (or another plugin) can make them available later.
 * At render time, however, an unknown ID must never leave a blank control.
 */
export function resolveLibraryIconId(icon: string): string {
  const candidate = icon.trim();
  if (!candidate) return FALLBACK_LIBRARY_ICON;
  try {
    if (typeof getIconIds !== "function") return FALLBACK_LIBRARY_ICON;
    const registered = getIconIds() as readonly string[];
    if (registered.length === 0) return FALLBACK_LIBRARY_ICON;
    if (cachedRegistrySize !== registered.length || !cachedRegistry.has(candidate)) {
      cachedRegistry = new Set(registered);
      cachedRegistrySize = registered.length;
    }
    return cachedRegistry.has(candidate) ? candidate : FALLBACK_LIBRARY_ICON;
  } catch {
    return FALLBACK_LIBRARY_ICON;
  }
}
