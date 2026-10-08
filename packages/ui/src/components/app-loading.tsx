import { Loader } from './loader.tsx'
import { cn } from '../lib/utils.ts'

/**
 * A full-area loading state: the loader, centred. For blank screens — route transitions, boot, a canvas
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
      className={cn(
        // `h-full` centres against the flex-determined route outlet; the
        // minimum keeps the mark visible where the outlet has no height yet.
        'grid h-full min-h-64 w-full place-items-center bg-cx-canvas p-4',
        className,
      )}
    >
      <Loader label={label ?? 'Loading'} />
    </div>
  )
}
