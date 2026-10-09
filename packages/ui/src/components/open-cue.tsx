"use client";

import { play } from "cuelume";
import { useEffect } from "react";

/**
 * Renders nothing. Mount it inside a portal that only exists while its surface
 * is open: it plays the open cue on arrival and the close cue on the way out.
 * `normal` is for surfaces that take over the screen; menus and popovers stay
 * `subtle`, since they open hundreds of times a day.
 */
export function OpenCue({
  emphasis = "normal",
}: {
  emphasis?: "subtle" | "normal" | "strong";
}): null {
  useEffect(() => {
    play("open", { emphasis });
    return () => play("close", { emphasis });
  }, [emphasis]);
  return null;
}
