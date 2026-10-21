import type { ReactNode } from "react";

/**
 * Inline inverted pill -- background is the current message's accent; dark
 * cutout text is in an inner span (`.term-tag-label`) so glyph blur matches
 * the role badge, without blurring the box.
 */
export function TerminalTag({ children }: { children: ReactNode }) {
  return (
    <span className="term-tag">
      <span className="term-tag-label">{children}</span>
    </span>
  );
}
