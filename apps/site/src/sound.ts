import { bind, play, setEnabled } from 'cuelume'

/** Things that answer a hover with a soft tick. */
const HOVERABLE = [
  '.button',
  '.nav nav a',
  '.theme-toggle',
  '.replay',
  '.agent',
  '.platform-tabs button',
  '.footer a',
].join(',')

/** Delegates every `data-cuelume-*` attribute on the page. Sound is always on. */
export function startSound() {
  setEnabled(true)
  bind()

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return
    const target = event.target.closest(HOVERABLE)
    if (!target) return
    // Moving between children of the same control is not a new hover.
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
    play('tap', { emphasis: 'subtle' })
  })
}
