import type { Layer } from "../lib/document"

export function AmbientEffect({ layer }: { layer: Layer }) {
  const kind = layer.effectKind
  const id = `ambient-${layer.id}`
  const density = layer.effectDensity ?? 45
  const color = layer.fill
  return (
    <svg
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={kind === "bokeh" ? 1.2 : 5} />
        </filter>
        <linearGradient id={`${id}-spectrum`} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#c4d9ee" />
          <stop offset=".35" stopColor="#e0cbe5" />
          <stop offset=".65" stopColor="#f7dfcd" />
          <stop offset="1" stopColor="#cfe4d8" />
        </linearGradient>
        <radialGradient id={`${id}-orb`}>
          <stop stopColor={color} stopOpacity="0" />
          <stop offset=".68" stopColor={color} stopOpacity=".12" />
          <stop offset=".87" stopColor={color} stopOpacity=".48" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-leak`} cx="0" cy=".5" r="1">
          <stop stopColor={color} stopOpacity=".8" />
          <stop offset=".3" stopColor={color} stopOpacity=".4" />
          <stop offset=".8" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-line`}>
          <stop stopColor={color} stopOpacity="0" />
          <stop offset=".48" stopColor={color} stopOpacity=".15" />
          <stop offset=".5" stopColor={color} stopOpacity=".9" />
          <stop offset=".54" stopColor={color} stopOpacity=".1" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {kind === "aurora" && (
        <g
          filter={`url(#${id}-soft)`}
          fill="none"
          stroke={`url(#${id}-spectrum)`}
          opacity=".65"
        >
          <path d="M-20 85 C20 10 55 115 120 5" strokeWidth="18" />
          <path d="M-20 50 C45 -25 65 90 120 30" strokeWidth="7" />
        </g>
      )}
      {kind === "pearl" && (
        <>
          <ellipse cx="46" cy="48" rx="39" ry="43" fill={`url(#${id}-orb)`} />
          <g
            filter={`url(#${id}-soft)`}
            fill="none"
            stroke={`url(#${id}-spectrum)`}
            opacity=".5"
          >
            <path
              d="M12 63 C16 8 77 2 85 46 C92 77 38 96 19 65"
              strokeWidth="11"
            />
          </g>
        </>
      )}
      {kind === "lightLeak" && (
        <rect width="100" height="100" fill={`url(#${id}-leak)`} />
      )}
      {kind === "caustics" && (
        <g fill="none" stroke={color} opacity=".55">
          {Array.from({ length: 7 }, (_, i) => (
            <path
              key={i}
              d={`M-10 ${8 + i * 14} C25 ${-8 + i * 9} 30 ${45 + i * 9} 65 ${18 + i * 10} S100 ${20 + i * 12} 112 ${8 + i * 14}`}
              strokeWidth={i % 2 ? 0.25 : 0.65}
            />
          ))}
          <g opacity=".35" filter={`url(#${id}-soft)`}>
            <path d="M-10 50 Q25 10 48 48 T110 52" strokeWidth="8" />
          </g>
        </g>
      )}
      {kind === "bokeh" && (
        <g filter={`url(#${id}-soft)`}>
          {Array.from({ length: Math.round(3 + density * 0.15) }, (_, i) => (
            <circle
              key={i}
              cx={(i * 41 + 13) % 100}
              cy={(i * 67 + 17) % 100}
              r={5 + (i % 4) * 3}
              fill={`url(#${id}-orb)`}
              opacity={0.4 + (i % 3) * 0.2}
            />
          ))}
        </g>
      )}
      {kind === "stardust" && (
        <g fill={color}>
          {Array.from({ length: Math.round(20 + density * 2) }, (_, i) => {
            const x = (i * 37.43 + 11) % 100,
              y = 50 + Math.sin(i * 2.1) * ((i % 9) + 2)
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={0.07 + (i % 7) * 0.045}
                opacity={0.2 + (i % 6) * 0.12}
              />
            )
          })}
        </g>
      )}
      {kind === "reflection" && (
        <g transform="rotate(18 50 50)">
          <rect
            x="28"
            y="-30"
            width="17"
            height="160"
            fill={`url(#${id}-line)`}
          />
          <rect
            x="55"
            y="-30"
            width="6"
            height="160"
            fill={`url(#${id}-line)`}
            opacity=".65"
          />
        </g>
      )}
      {kind === "ripple" && (
        <g fill="none" stroke={color}>
          {Array.from({ length: 5 }, (_, i) => (
            <ellipse
              key={i}
              cx="50"
              cy="50"
              rx={12 + i * 8}
              ry={8 + i * 6}
              strokeWidth={i % 2 ? 0.25 : 0.7}
              opacity={0.65 - i * 0.1}
              transform="rotate(-20 50 50)"
            />
          ))}
        </g>
      )}
    </svg>
  )
}
