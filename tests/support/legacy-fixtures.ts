import type { PluginData } from "../../src/model.ts";

/**
 * Raw-input contracts for tests. Historical (or deliberately future) payloads carry a
 * numeric `version` other than the current literal; they are fed to migrate/parse code
 * exactly as stored and are never re-stamped as current data. These helpers return the
 * same object viewed through a raw-input type so a fixture can be edited in place.
 */
export type RawVersionDraft<T extends { version: number }> = Omit<T, "version"> & { version: number };

export function asRawVersionDraft<T extends { version: number }>(value: T): RawVersionDraft<T> {
  return value;
}

/** A plugin-data draft whose portable index is raw input (older version, newer keys possibly absent). */
export type RawPortableIndexDraft = Omit<PluginData, "portableIndex"> & { portableIndex: object };

export function asRawPortableIndexDraft(data: PluginData): RawPortableIndexDraft {
  return data;
}
