import { Notice } from "obsidian";

export interface OpenedBaseGuardHost {
  data: unknown;
  getActiveKnowledgeBaseId(): string;
  getDataEpoch?(): number;
  getExternalChangeGeneration?(): number;
  /** Settled semantic ownership, independent of no-op Sync notifications. */
  getBaseSurfaceVersion?(): string;
  isExternalReloadInProgress?(): boolean;
}

export interface OpenedBaseGuardOptions {
  message: string;
  onStale?: () => void;
  openedBaseId?: string;
  openedDataEpoch?: number;
}

export interface OpenedBaseGuard {
  (): boolean;
  owns(): boolean;
}

/**
 * Presentation ownership is not a write lock. A notification fences writes
 * immediately, but an unchanged, settled reload must not discard a form.
 * Hosts without semantic ownership retain the original conservative checks.
 */
export function createOpenedBaseGuard(host: OpenedBaseGuardHost, options: OpenedBaseGuardOptions): OpenedBaseGuard {
  const openedData = host.data;
  const openedBaseId = options.openedBaseId ?? host.getActiveKnowledgeBaseId();
  const openedDataEpoch = options.openedDataEpoch ?? host.getDataEpoch?.() ?? 0;
  const openedExternalGeneration = host.getExternalChangeGeneration?.() ?? 0;
  // A caller explicitly rendering an older epoch cannot claim current ownership.
  const openedSurfaceVersion = openedDataEpoch === (host.getDataEpoch?.() ?? 0)
    ? host.getBaseSurfaceVersion?.()
    : undefined;
  let noticeShown = false;
  let pendingNoticeShown = false;
  const owns = (): boolean => !host.isExternalReloadInProgress?.()
    && host.getActiveKnowledgeBaseId() === openedBaseId
    && (openedSurfaceVersion !== undefined
      ? host.getBaseSurfaceVersion?.() === openedSurfaceVersion
      : host.data === openedData
        && (host.getDataEpoch?.() ?? 0) === openedDataEpoch
        && (host.getExternalChangeGeneration?.() ?? 0) === openedExternalGeneration);
  const guard = (): boolean => {
    if (host.isExternalReloadInProgress?.()) {
      if (!pendingNoticeShown) {
        new Notice("Checking a synced update. Your draft is still open; try again when the check finishes.");
        pendingNoticeShown = true;
      }
      return false;
    }
    pendingNoticeShown = false;
    if (owns()) return true;
    options.onStale?.();
    if (!noticeShown) {
      noticeShown = true;
      new Notice(options.message, 8000);
    }
    return false;
  };
  return Object.assign(guard, { owns });
}
