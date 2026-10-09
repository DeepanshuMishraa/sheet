import { SHADERS, SHADER_NAMES, type ShaderName } from '@sheet/canvas/web-shaders'

export function ShadersList({ onInsert }: { onInsert: (name: ShaderName) => void }) {
  return (
    <section className="shrink-0 space-y-2 border-b border-line p-3">
      <div className="cx-label cx-bracket">Shaders</div>
      <div className="grid grid-cols-2 gap-1.5">
        {SHADER_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={`Insert ${SHADERS[name].label} shader`}
            title={SHADERS[name].description}
            className="min-w-0 truncate rounded-md border border-line px-2 py-1.5 text-left text-xs text-foreground hover:border-cx-accent hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onInsert(name)}
          >
            {SHADERS[name].label}
          </button>
        ))}
      </div>
    </section>
  )
}
