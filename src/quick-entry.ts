import type { Command } from "obsidian";

/**
 * Obsidian protocol actions are registered individually. Keeping the allowlist
 * explicit makes it difficult for a future route to start accepting data by
 * accident.
 */
export const QUICK_ENTRY_PROTOCOL_ACTIONS = ["kbcc-quick-entry"] as const;
export type QuickEntryProtocolAction = typeof QUICK_ENTRY_PROTOCOL_ACTIONS[number];
export const QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS = [
  "kbcc-create-subject",
  "kbcc-create-heading",
  "kbcc-create-subheading",
  "kbcc-create-note",
  "kbcc-add-current-note",
  "kbcc-add-existing-note",
] as const;
export type QuickEntryFocusedProtocolAction = typeof QUICK_ENTRY_FOCUSED_PROTOCOL_ACTIONS[number];
export const QUICK_APPEND_PROTOCOL_ACTIONS = ["kbcc-quick-append-current", "kbcc-quick-append-existing"] as const;
export type QuickAppendProtocolAction = typeof QUICK_APPEND_PROTOCOL_ACTIONS[number];
export const ATTACHMENT_PROTOCOL_ACTIONS = ["kbcc-attach-current"] as const;
export type AttachmentProtocolAction = typeof ATTACHMENT_PROTOCOL_ACTIONS[number];

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

export function privacySafeFixedActionRequest(
  parameters: Readonly<Record<string, string>>,
  expectedAction: string,
): boolean {
  return parameters.action === expectedAction
    && Object.keys(parameters).length === 1
    && Object.prototype.hasOwnProperty.call(parameters, "action");
}

export interface QuickEntryCommandHandlers {
  openHub: () => void;
  createSubject: () => void;
  createHeading: () => void;
  createSubheading: () => void;
  createNote: () => void;
  addCurrentNote: () => void;
  addExistingNote: () => void;
  appendCurrentNote: () => void;
  appendExistingNote: () => void;
}

type QuickEntryFocusedHandlerName =
  | "createSubject"
  | "createHeading"
  | "createSubheading"
  | "createNote"
  | "addCurrentNote"
  | "addExistingNote";

const QUICK_ENTRY_FOCUSED_PROTOCOL_HANDLER_BY_ACTION: Readonly<
  Record<QuickEntryFocusedProtocolAction, QuickEntryFocusedHandlerName>
> = Object.freeze({
  "kbcc-create-subject": "createSubject",
  "kbcc-create-heading": "createHeading",
  "kbcc-create-subheading": "createSubheading",
  "kbcc-create-note": "createNote",
  "kbcc-add-current-note": "addCurrentNote",
  "kbcc-add-existing-note": "addExistingNote",
});

/**
 * Dispatch one fixed Quick Entry action through the same guarded handler used
 * by its Command Palette and mobile-toolbar command. The route carries no
 * title, path, content, or other user data.
 */
export function runQuickEntryFocusedProtocolAction(
  action: QuickEntryFocusedProtocolAction,
  handlers: QuickEntryCommandHandlers,
): void {
  handlers[QUICK_ENTRY_FOCUSED_PROTOCOL_HANDLER_BY_ACTION[action]]();
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
    { id: "quick-append-current-note", name: "Quick Append: Add to current note…", icon: "list-end", callback: handlers.appendCurrentNote },
    { id: "quick-append-existing-note", name: "Quick Append: Choose a note…", icon: "file-input", callback: handlers.appendExistingNote },
  ];
}
