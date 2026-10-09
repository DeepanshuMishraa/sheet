"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { cn } from "../lib/utils.ts";

/** Nine ruler ticks; every fourth is a long one, like a scale's major mark. */
const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * A ruler that something slides across: ticks rise and fall in a wave, the one
 * under the "playhead" taking the accent.
 */
function LoaderTicks({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 14"
      className={cn("h-[14px] w-[32px] shrink-0 overflow-visible", className)}
    >
      {TICKS.map((index) => (
        <rect
          key={index}
          className="cx-loader-cell"
          x={index * 4}
          y={index % 4 === 0 ? 0 : 5}
          width="1.5"
          height={index % 4 === 0 ? 14 : 9}
          rx="0.75"
          fill="currentColor"
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </svg>
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
      <LoaderTicks />
      {label === null ? null : <span className="sr-only">{label}</span>}
      {label === null ? null : (
        <>
          <span
            aria-hidden="true"
            className="flex text-[10px] uppercase leading-none tracking-[0.14em]"
          >
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
