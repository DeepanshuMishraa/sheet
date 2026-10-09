import { useEffect, useRef } from 'react'
import {
  mountShaders,
  parseShaderParams,
  SHADER_NAME_ATTRIBUTE,
  SHADER_PARAMS_ATTRIBUTE,
  SHADERS,
  SHADER_NAMES,
  type ShaderName,
} from '@sheet/canvas/web-shaders'
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from '@sheet/ui/dialog'

type ShaderGroup = { id: string; label: string; names: readonly ShaderName[] }

/** Shaders that move, and shaders that hold one frame, told apart by their default speed. */
function groups(): ShaderGroup[] {
  const moving = SHADER_NAMES.filter((name) => {
    const speed = SHADERS[name].params.speed
    return speed.kind === 'number' && speed.default !== 0
  })
  const still = SHADER_NAMES.filter((name) => !moving.includes(name))
  return [
    { id: 'animated', label: 'Animated', names: moving },
    { id: 'still', label: 'Still', names: still },
  ].filter((group) => group.names.length > 0)
}

/** The shader itself, running small: what you see is what the frame will hold. */
function ShaderThumb({ name }: { name: ShaderName }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    return host ? mountShaders(host) : undefined
  }, [])
  return (
    <div ref={hostRef} className="aspect-[4/3] w-full overflow-hidden bg-cx-canvas shadow-hairline">
      <div
        {...{
          [SHADER_NAME_ATTRIBUTE]: name,
          [SHADER_PARAMS_ATTRIBUTE]: JSON.stringify(parseShaderParams(name, undefined)),
        }}
        className="size-full"
      />
    </div>
  )
}

/**
 * The shader gallery. It opens from the Shaders tool and shows every shader
 * running live; choosing one sets it on the page as a box that can be moved
 * and resized like any frame.
 */
export function ShaderGallery({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (name: ShaderName) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Shaders</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {groups().map((group) => (
            <section key={group.id} className="border-t border-line px-4 py-4 first:border-t-0">
              <h3 className="cx-label cx-bracket mb-3">{group.label}</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {group.names.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Insert ${SHADERS[name].label} shader`}
                    title={SHADERS[name].description}
                    className="cx-press group flex min-w-0 flex-col gap-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      onPick(name)
                      onOpenChange(false)
                    }}
                  >
                    <span className="block transition-shadow duration-150 group-hover:shadow-lift-selected">
                      <ShaderThumb name={name} />
                    </span>
                    <span className="truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                      {SHADERS[name].label}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  )
}
