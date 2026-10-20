import { AmbientEffect } from "./ambient-effect"
import type { Layer } from "../lib/document"
import { PhotoEffectsGraphic } from "./photo-effects"

export function EffectLayerGraphic({ layer }: { layer: Layer }) {
  const kind = layer.effectKind
  const id = `overlay-${layer.id}`
  if (
    [
      "aurora",
      "pearl",
      "lightLeak",
      "caustics",
      "bokeh",
      "stardust",
      "reflection",
      "ripple",
    ].includes(kind ?? "")
  )
    return <AmbientEffect layer={layer} />
  if (kind === "glow" || kind === "halo")
    return (
      <>
        <defs>
          <radialGradient id={id}>
            <stop
              offset="0"
              stopColor={layer.fill}
              stopOpacity={kind === "glow" ? 0.85 : 0}
            />
            <stop
              offset={kind === "glow" ? ".35" : ".48"}
              stopColor={layer.fill}
              stopOpacity={kind === "glow" ? 0.45 : 0.05}
            />
            <stop
              offset=".64"
              stopColor={layer.fill}
              stopOpacity={kind === "halo" ? 0.65 : 0.15}
            />
            <stop offset="1" stopColor={layer.fill} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse
          cx={layer.x + layer.width / 2}
          cy={layer.y + layer.height / 2}
          rx={layer.width / 2}
          ry={layer.height / 2}
          fill={`url(#${id})`}
        />
      </>
    )
  if (kind === "glitter")
    return (
      <svg
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {Array.from(
          { length: Math.round(12 + (layer.effectDensity ?? 45) * 1.2) },
          (_, i) => {
            const x = (i * 37 + 11) % 100,
              y = (i * 53 + 7) % 100
            const r = i % 7 === 0 ? 0.8 : 0.15 + (i % 4) * 0.08
            return (
              <g key={i} fill={layer.fill} opacity={0.3 + (i % 6) * 0.12}>
                <circle cx={x} cy={y} r={r} />
                {i % 11 === 0 && (
                  <path
                    d={`M${x - 2} ${y} Q${x} ${y - 0.2} ${x} ${y - 2} Q${x + 0.2} ${y} ${x + 2} ${y} Q${x} ${y + 0.2} ${x} ${y + 2} Q${x - 0.2} ${y} ${x - 2} ${y}`}
                  />
                )}
              </g>
            )
          }
        )}
      </svg>
    )
  return (
    <PhotoEffectsGraphic
      layer={{ ...layer, photoEffects: kind ? { [kind]: 100 } : {} }}
    >
      {null}
    </PhotoEffectsGraphic>
  )
}
