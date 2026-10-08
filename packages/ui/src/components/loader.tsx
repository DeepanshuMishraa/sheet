"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { cn } from "../lib/utils.ts";

/** Diagonal order of the nine cells, so the glow travels corner to corner. */
const CELL_DELAYS = [0, 1, 2, 1, 2, 3, 2, 3, 4] as const;

function LoaderGrid({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 grid-cols-3 gap-[2px]", className)}
    >
      {CELL_DELAYS.map((step, index) => (
        <i
          key={index}
          className="cx-loader-cell size-[6px] rounded-[1.5px] bg-current"
          style={{ animationDelay: `${step * 110}ms` }}
        />
      ))}
    </span>
  );
}

/** Seconds since mount, to a tenth, ticking while the loader is on screen. */
function useElapsed(enabled: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setSeconds((performance.now() - startedAt) / 1000);
    }, 100);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return seconds;
}

export interface LoaderProps extends React.ComponentProps<"div"> {
  /** The word beside the grid. `null` draws the grid alone. */
  label?: string | null;
  /** Show how long the wait has lasted. */
  elapsed?: boolean;
}

/**
 * The app's loading mark: a nine-cell grid that glows corner to corner, a label
 * whose letters light up in turn, and the time spent waiting.
 */
export function Loader({
  label = "Loading",
  elapsed = true,
  className,
  ...props
}: LoaderProps): React.ReactElement {
  const seconds = useElapsed(elapsed && label !== null);

  return (
    <div
      role="status"
      aria-label={label ?? "Loading"}
      aria-busy="true"
      className={cn("inline-flex items-center gap-[10px] text-foreground", className)}
      {...props}
    >
      <LoaderGrid />
      {label === null ? null : <span className="sr-only">{label}</span>}
      {label === null ? null : (
        <>
          <span aria-hidden="true" className="flex text-[12px] leading-none">
            {[...label].map((letter, index) => (
              <span
                key={index}
                className="cx-loader-letter"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                {letter}
              </span>
            ))}
          </span>
          {elapsed ? (
            <span
              aria-hidden="true"
              className="min-w-[3ch] text-[12px] leading-none tabular-nums text-muted-foreground/70"
            >
              {seconds.toFixed(1)}s
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
