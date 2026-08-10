import type { Command } from "obsidian";

/**
 * Obsidian protocol actions are registered individually. Keeping the allowlist
 * explicit makes it difficult for a future route to start accepting data by
 * accident.
 */
export const QUICK_ENTRY_PROTOCOL_ACTIONS = ["kbcc-quick-entry"] as const;
export type QuickEntryProtocolAction = typeof QUICK_ENTRY_PROTOCOL_ACTIONS[number];

/**
 * Quick Entry URLs are intentionally action-only. Titles, paths, note content,
 * patient data, and every other query value are ignored rather than retained or
 * forwarded into a form.
 */
export const QUICK_ENTRY_PROTOCOL_ALLOWED_PARAMETER_KEYS = ["action"] as const;

export interface PrivacySafeQuickEntryRequest {
  openHub: boolean;
  rejectedParameterKeys: string[];
}

export function privacySafeQuickEntryRequest(
  parameters: Readonly<Record<string, string>>,
): PrivacySafeQuickEntryRequest {
  const rejectedParameterKeys = Object.keys(parameters)
    .filter((key) => key !== "action")
    .sort();
  return {
    // `action` is supplied by Obsidian itself. Any additional query field—or a
    // mismatched action—fails closed and never opens a form.
    openHub: parameters.action === QUICK_ENTRY_PROTOCOL_ACTIONS[0]
      && rejectedParameterKeys.length === 0
      && Object.keys(parameters).length === 1,
    rejectedParameterKeys,
  };
}

export interface QuickEntryCommandHandlers {
  openHub: () => void;
  createSubject: () => void;
  createHeading: () => void;
  createSubheading: () => void;
  createNote: () => void;
  addCurrentNote: () => void;
  addExistingNote: () => void;
}

/**
 * Commands deliberately omit default hotkeys. Obsidian users can assign their
 * preferred combinations in Settings -> Hotkeys without plugin conflicts.
 */
export function createQuickEntryCommands(handlers: QuickEntryCommandHandlers): Command[] {
  return [
    { id: "quick-entry", name: "Quick entry…", icon: "zap", callback: handlers.openHub },
    { id: "quick-create-subject", name: "Quick entry: Create subject without a note…", icon: "bookmark-plus", callback: handlers.createSubject },
    { id: "quick-create-heading", name: "Quick entry: Create heading…", icon: "folder-plus", callback: handlers.createHeading },
    { id: "quick-create-subheading", name: "Quick entry: Create subheading…", icon: "list-tree", callback: handlers.createSubheading },
    { id: "quick-create-note", name: "Quick entry: Create note…", icon: "file-plus-2", callback: handlers.createNote },
    { id: "quick-add-current-note", name: "Quick entry: Add current note…", icon: "panel-top", callback: handlers.addCurrentNote },
    { id: "quick-add-existing-note", name: "Quick entry: Add existing note…", icon: "list-plus", callback: handlers.addExistingNote },
  ];
}
