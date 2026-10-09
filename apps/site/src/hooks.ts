import { useEffect, useRef, useState } from 'react'

/** True once the element has scrolled into view; never goes back to false. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, seen] as const
}

export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Writes the pointer position into `--mx`/`--my` on the element, with no re-render. */
export function trackPointer(event: React.PointerEvent<HTMLElement>) {
  const target = event.currentTarget
  const rect = target.getBoundingClientRect()
  target.style.setProperty('--mx', `${event.clientX - rect.left}px`)
  target.style.setProperty('--my', `${event.clientY - rect.top}px`)
}
