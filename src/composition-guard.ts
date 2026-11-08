/**
 * Tracks IME composition on a text input so a filter can wait for the composed
 * text instead of re-rendering (and replacing) the input mid-composition.
 *
 * `onCommit` runs on compositionend; callers apply the query there. Engines
 * differ on whether a final input event follows compositionend, so callers
 * should make "apply" idempotent (skip when the value already matches).
 */
export interface CompositionGuard {
  /** True while a composition is open, or the given event reports it. */
  isComposing(event?: Event): boolean;
}

export function guardComposition(input: HTMLInputElement, onCommit: () => void): CompositionGuard {
  let composing = false;
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    onCommit();
  });
  return {
    isComposing: (event) => composing || (event as InputEvent | undefined)?.isComposing === true,
  };
}
