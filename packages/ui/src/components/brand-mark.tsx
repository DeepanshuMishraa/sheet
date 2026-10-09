import type React from "react";
import { cn } from "../lib/utils.ts";

/**
 * Two stacked squares, the ink one behind and the accent one in front. The
 * front square settles into place when the mark mounts and slides off the
 * corner while it is hovered, as if the sheet on top were being lifted.
 */
export function BrandMark({
  className,
  ...props
}: React.ComponentProps<"svg">): React.ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn("cx-brand size-5 shrink-0", className)}
      {...props}
    >
      <rect x="7" y="7" width="12" height="12" fill="currentColor" />
      <rect className="cx-brand-front" x="1" y="1" width="12" height="12" fill="var(--cx-accent)" />
    </svg>
  );
}
