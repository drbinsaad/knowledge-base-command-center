// Typed contracts for the plain .mjs release/guard scripts that tests import.
// Declaration only: no runtime effect, the scripts stay JavaScript.

declare module "*/local-path-pattern.mjs" {
  export const localPathPattern: RegExp;
}

declare module "*/json-export-routes.mjs" {
  /** `sources` is an array of [relative path under src/, content]. Throws an AssertionError on a missing or bypassed route. */
  export function checkJsonExportRoutes(sources: ReadonlyArray<readonly [string, string]>): void;
}

declare module "*/runtime-source-guards.mjs" {
  export interface FoundCommandDefinition {
    id: string | null;
    name: string | null;
  }
  /** Sorted [relativePath, content] pairs for every .ts file under the root. */
  export function discoverRuntimeSources(sourceRoot: string): Promise<Array<[string, string]>>;
  export function checkSafetyPatterns(label: string, content: string): void;
  export function maskSource(content: string): string;
  export function findCommandDefinitions(content: string): FoundCommandDefinition[];
  export function checkCommands(sources: ReadonlyArray<readonly [string, string]>): void;
  export function checkRuntimeSources(sources: ReadonlyArray<readonly [string, string]>): void;
}
