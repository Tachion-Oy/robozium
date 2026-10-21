import type { KeyboardEvent, ReactNode } from "react";
import { logRoleToRowLabel, StreamLogRole } from "@/lib/robozium/view-model";

type TerminalMessageProps = {
  role: StreamLogRole;
  children: ReactNode;
  /** Override the label inside the badge (default comes from the role). */
  label?: string;
  /** Enables click and keyboard expansion for a truncated history row. */
  interactive?: boolean;
  /** Enables the visual hover treatment without making the row actionable. */
  hoverable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

/**
 * One message row: a role badge in a fixed left gutter (filled inverted pill
 * for agent / tool / error; same footprint with border-only + amber text for
 * system) and wrapped content. Role -> color/glow via CSS on the row (see
 * globals.css), which also feed TerminalTag / TerminalEmphasis inside the
 * content.
 */
export function TerminalMessage({
  role,
  children,
  label,
  interactive = false,
  hoverable = false,
  expanded = false,
  onToggle,
}: TerminalMessageProps) {
  const text = label ?? logRoleToRowLabel[role];
  const isExpandable = interactive && onToggle !== undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isExpandable) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };

  return (
    <div
      className={`term-msg grid grid-cols-[4.75rem_1fr] gap-x-[0.9rem] items-baseline mt-[1.1rem] first:mt-0${
        isExpandable ? " term-msg--interactive" : ""
      }${hoverable ? " term-msg--hoverable" : ""}${
        isExpandable && expanded ? " term-msg--expanded" : ""
      }${isExpandable && !expanded ? " term-msg--collapsed" : ""}`}
      data-role={role}
      role={isExpandable ? "button" : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      aria-expanded={isExpandable ? expanded : undefined}
      onClick={isExpandable ? onToggle : undefined}
      onKeyDown={isExpandable ? onKeyDown : undefined}
    >
      <span className="term-msg-badge">
        <span className="term-msg-badge-label">{text}</span>
      </span>
      <div className="term-msg-content">{children}</div>
    </div>
  );
}
