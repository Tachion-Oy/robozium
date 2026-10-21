import type { ReactNode } from "react";

type TerminalFrameProps = {
  children: ReactNode;
};

/**
 * Terminal surface.
 *
 * The CRT effects (scanlines + vignette + bloom) live on the <body> now so
 * they cover the whole page uniformly -- the nav sits on top of the same
 * raster instead of having a seam against it. This component is just the
 * flex cell that holds the scrollable log.
 */
export function TerminalFrame({ children }: TerminalFrameProps) {
  return (
    <div className="term-frame font-terminal relative flex flex-1 min-h-0 w-full overflow-hidden">
      <div className="relative z-0 flex flex-1 w-full">{children}</div>
    </div>
  );
}
