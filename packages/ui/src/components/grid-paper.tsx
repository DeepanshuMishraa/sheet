"use client";

import { useId, useState } from "react";
import type React from "react";
import { cn } from "../lib/utils.ts";

const CONTROLS =
  "button, a, input, select, textarea, label, [role='button'], [role='tab'], [role='menuitem'], header, aside";

export interface GridPaperProps extends React.ComponentProps<"div"> {
  /** Cell size in px. */
  cell?: number;
  /** The element drawn: `main` for a page body, `div` otherwise. */
  as?: "div" | "main";
}

/**
 * A page of graph paper behind its content. The grid fades out toward the
 * bottom, and the cell under the pointer takes the accent with corner marks,
 * so a plain page still answers where you are pointing.
 *
 * The highlight is one SVG group that moves by whole cells, so it re-renders
 * only when the pointer crosses a gridline, not on every move.
 */
export function GridPaper({
  cell = 48,
  as: Tag = "div",
  className,
  children,
  onPointerMove,
  onPointerLeave,
  ...props
}: GridPaperProps): React.ReactElement {
  const patternId = `grid-${useId().replace(/:/g, "")}`;
  const [active, setActive] = useState<{ col: number; row: number } | null>(null);

  return (
    <Tag
      className={cn("relative isolate", className)}
      onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
        onPointerMove?.(event);
        // Over a control the cell would only show through it, so it steps aside.
        if (event.target instanceof Element && event.target.closest(CONTROLS)) {
          setActive(null);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const col = Math.floor((event.clientX - rect.left) / cell);
        const row = Math.floor((event.clientY - rect.top) / cell);
        setActive((current) =>
          current && current.col === col && current.row === row ? current : { col, row },
        );
      }}
      onPointerLeave={(event: React.PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(event);
        setActive(null);
      }}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 size-full [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
      >
        <defs>
          <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
            <path d={`M${cell} 0H0V${cell}`} fill="none" stroke="var(--line)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        <g
          className="transition-[transform,opacity] duration-150 ease-smooth motion-reduce:transition-none"
          style={{
            transform: `translate(${(active?.col ?? 0) * cell}px, ${(active?.row ?? 0) * cell}px)`,
            opacity: active ? 1 : 0,
          }}
        >
          <rect width={cell} height={cell} fill="var(--cx-accent)" fillOpacity="0.06" />
          <path
            d={`M0 8V0H8M${cell - 8} 0H${cell}V8M${cell} ${cell - 8}V${cell}H${cell - 8}M8 ${cell}H0V${cell - 8}`}
            fill="none"
            stroke="var(--cx-accent)"
            strokeWidth="1.25"
          />
        </g>
      </svg>
      {children}
    </Tag>
  );
}
