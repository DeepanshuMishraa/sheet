import { DotMatrixLoader } from './dot-matrix-loader.tsx'
import { cn } from '../lib/utils.ts'

/**
 * A full-area loading state: the dot-matrix mark, centred, with an optional
 * caption underneath. For blank screens — route transitions, boot, a canvas
 * that has not opened yet — where a skeleton would have no shape to mimic.
 */
export function AppLoading({
  label,
  className,
}: {
  /** Screen-reader and visible caption, e.g. `Loading canvas`. */
  label?: string
  className?: string
}): React.ReactElement {
  return (
    <div
      role="status"
      aria-label={label ?? 'Loading'}
      aria-busy="true"
      className={cn(
        // `h-full` centres against the flex-determined route outlet; the
        // minimum keeps the mark visible where the outlet has no height yet.
        'grid h-full min-h-64 w-full place-items-center bg-cx-canvas p-4',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <DotMatrixLoader
          aria-hidden="true"
          rows={3}
          columns={3}
          className="size-8 text-foreground"
        />
        {label ? (
          <p className="text-xs text-muted-foreground">{label}</p>
        ) : null}
      </div>
    </div>
  )
}
