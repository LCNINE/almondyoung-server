import type { ReactNode } from "react"
import type { Layer } from "../lib/document"

export function PhotoEffectsGraphic({
  layer,
  children,
}: {
  layer: Layer
  children: ReactNode
}) {
  const effects = layer.photoEffects ?? {}
  const id = `photo-fx-${layer.id}`
  const level = (key: keyof typeof effects) => (effects[key] ?? 0) / 100
  const soft = level("softFocus")
  const glass = level("glass")
  const gloss = level("gloss")
  const prism = level("prism")
  const grain = level("grain")
  const shimmer = level("shimmer")
  const shadow = level("windowShadow")
  const vignette = level("vignette")
  const radius = Math.min(layer.width, layer.height) * 0.018
  const bounds = {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
  }

  return (
    <>
      <defs>
        {(soft > 0 || glass > 0) && (
          <filter
            id={`${id}-soft`}
            x="-15%"
            y="-15%"
            width="130%"
            height="130%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={radius}
              edgeMode="duplicate"
              result="soft"
            />
            <feComposite
              in="soft"
              in2="SourceGraphic"
              operator="arithmetic"
              k2={soft || 1}
              k3={soft ? 1 - soft : 0}
            />
          </filter>
        )}
        {glass > 0 && (
          <linearGradient id={`${id}-glass`} x2="1" y2="0">
            <stop stopColor="#ffffff" stopOpacity=".38" />
            <stop offset=".46" stopColor="#ffffff" stopOpacity=".06" />
            <stop offset=".48" stopColor="#ffffff" stopOpacity=".48" />
            <stop offset=".5" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        )}
        {gloss > 0 && (
          <linearGradient id={`${id}-gloss`} x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#ffffff" stopOpacity="0" />
            <stop offset=".38" stopColor="#ffffff" stopOpacity="0" />
            <stop offset=".48" stopColor="#ffffff" stopOpacity=".55" />
            <stop offset=".51" stopColor="#ffffff" stopOpacity=".12" />
            <stop offset=".68" stopColor="#ffffff" stopOpacity=".32" />
            <stop offset=".8" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        )}
        {prism > 0 && (
          <linearGradient id={`${id}-prism`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffd4e2" stopOpacity="0" />
            <stop offset=".32" stopColor="#f4d8ed" stopOpacity=".06" />
            <stop offset=".43" stopColor="#b7dded" stopOpacity=".45" />
            <stop offset=".50" stopColor="#e7edce" stopOpacity=".38" />
            <stop offset=".57" stopColor="#f7d7b8" stopOpacity=".4" />
            <stop offset=".68" stopColor="#eac1d9" stopOpacity=".06" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        )}
        {grain > 0 && (
          <filter
            id={`${id}-grain`}
            x="0"
            y="0"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency={75 / layer.width}
              numOctaves="2"
              seed="7"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        )}
        {shimmer > 0 && (
          <pattern
            id={`${id}-shimmer`}
            width="13"
            height="17"
            patternUnits="userSpaceOnUse"
            patternTransform={`scale(${layer.width / 100})`}
          >
            <circle cx="2" cy="3" r=".13" fill="white" opacity=".8" />
            <circle cx="9" cy="12" r=".22" fill="#fff1e0" opacity=".6" />
            <circle cx="6" cy="7" r=".1" fill="white" />
          </pattern>
        )}
        {shadow > 0 && (
          <filter
            id={`${id}-shadow`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="1.3" />
          </filter>
        )}
        {vignette > 0 && (
          <radialGradient id={`${id}-vignette`}>
            <stop offset=".4" stopColor="#231e28" stopOpacity="0" />
            <stop offset="1" stopColor="#231e28" stopOpacity=".7" />
          </radialGradient>
        )}
      </defs>
      <g filter={soft > 0 ? `url(#${id}-soft)` : undefined}>{children}</g>
      {glass > 0 && (
        <>
          <svg
            {...bounds}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ pointerEvents: "none" }}
          >
            <rect
              width="49"
              height="100"
              fill="#f6f5f3"
              opacity={glass * 0.15}
            />
          </svg>
          <rect {...bounds} fill={`url(#${id}-glass)`} opacity={glass} />
        </>
      )}
      {gloss > 0 && (
        <rect {...bounds} fill={`url(#${id}-gloss)`} opacity={gloss} />
      )}
      {prism > 0 && (
        <rect {...bounds} fill={`url(#${id}-prism)`} opacity={prism} />
      )}
      {grain > 0 && (
        <rect {...bounds} filter={`url(#${id}-grain)`} opacity={grain * 0.2} />
      )}
      {shimmer > 0 && (
        <rect {...bounds} fill={`url(#${id}-shimmer)`} opacity={shimmer} />
      )}
      {shadow > 0 && (
        <svg {...bounds} viewBox="0 0 100 100" preserveAspectRatio="none">
          <g
            transform="rotate(-28 50 50)"
            filter={`url(#${id}-shadow)`}
            fill="#1e2330"
            opacity={shadow * 0.32}
          >
            <rect x="20" y="-60" width="7" height="220" />
            <rect x="65" y="-60" width="7" height="220" />
            <rect x="-60" y="43" width="220" height="6" />
          </g>
        </svg>
      )}
      {vignette > 0 && (
        <rect {...bounds} fill={`url(#${id}-vignette)`} opacity={vignette} />
      )}
    </>
  )
}
