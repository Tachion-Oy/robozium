import type { ReactNode } from "react";

/**
 * Inline emphasis for words you want to pop: brighter color + stronger glow,
 * keyed off the enclosing message's accent. Purely presentational wrapper
 * around the `.term-emph` class.
 */
export function TerminalEmphasis({ children }: { children: ReactNode }) {
  return <span className="term-emph">{children}</span>;
}
