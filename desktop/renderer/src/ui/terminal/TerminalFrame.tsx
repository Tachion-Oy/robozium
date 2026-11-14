import type { ReactNode } from "react";

type TerminalFrameProps = {
  children: ReactNode;
};

/**
 * The flex cell that holds the scrollable log, below the title row. The CRT
 * effects live on the backdrop, so the title sits on the same raster.
 */
export function TerminalFrame({ children }: TerminalFrameProps) {
  return (
    <div className="term-frame font-terminal relative flex flex-1 min-h-0 w-full overflow-hidden">
      <div className="relative z-0 flex flex-1 w-full">{children}</div>
    </div>
  );
}
