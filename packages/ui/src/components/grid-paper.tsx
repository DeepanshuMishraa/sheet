import { useId } from "react";
import type React from "react";
import { cn } from "../lib/utils.ts";

export interface GridPaperProps extends React.ComponentProps<"div"> {
  /** Cell size in px. */
  cell?: number;
  /** The element drawn: `main` for a page body, `div` otherwise. */
  as?: "div" | "main";
}

/**
 * A page of graph paper behind its content: faint lines that fade out toward
 * the bottom. It is only a ground. Nothing on it reacts to the pointer.
 */
export function GridPaper({
  cell = 48,
  as: Tag = "div",
  className,
  children,
  ...props
}: GridPaperProps): React.ReactElement {
  const patternId = `grid-${useId().replace(/:/g, "")}`;

  return (
    <Tag className={cn("relative isolate", className)} {...props}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 size-full opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      >
        <defs>
          <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
            <path d={`M${cell} 0H0V${cell}`} fill="none" stroke="var(--line)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {children}
    </Tag>
  );
}
