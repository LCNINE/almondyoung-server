import type { AlmondEditor } from "../../hooks/use-almond-editor"

export function CanvasGuides({ editor }: { editor: AlmondEditor }) {
  const { design, showRuler, showCutline, showSafety, spec, zoom, canvasFit } =
    editor
  const cutlineInset = 0.3
  return (
    <g id="print-guides" pointerEvents="none">
      {showCutline && (
        <rect
          x={cutlineInset}
          y={cutlineInset}
          width={design.widthMm - 2 * cutlineInset}
          height={design.heightMm - 2 * cutlineInset}
          fill="none"
          stroke="#f03838"
          strokeWidth={1 / (canvasFit * zoom)}
        />
      )}
      {showSafety && (
        <rect
          x={spec.safetyMm}
          y={spec.safetyMm}
          width={Math.max(0, design.widthMm - 2 * spec.safetyMm)}
          height={Math.max(0, design.heightMm - 2 * spec.safetyMm)}
          fill="none"
          stroke="#31b991"
          strokeWidth={1 / (canvasFit * zoom)}
          strokeDasharray={`${12 / (canvasFit * zoom)} ${8 / (canvasFit * zoom)}`}
        />
      )}
      {showRuler && (
        <g fill="#666" stroke="#777" strokeWidth={0.5 / (canvasFit * zoom)}>
          {Array.from(
            {
              length:
                Math.floor(
                  design.widthMm / (design.widthMm >= 300 ? 100 : 10)
                ) + 1,
            },
            (_, i) => {
              const v = i * (design.widthMm >= 300 ? 100 : 10)
              return (
                <g key={`x${i}`}>
                  <line
                    x1={v}
                    y1={0}
                    x2={v}
                    y2={Math.min(8, design.heightMm * 0.03)}
                  />
                  <text
                    x={v + 1}
                    y={Math.min(16, design.heightMm * 0.07)}
                    fontSize={Math.min(10, design.widthMm * 0.025)}
                    stroke="none"
                  >
                    {v}
                  </text>
                </g>
              )
            }
          )}
          {Array.from(
            {
              length:
                Math.floor(
                  design.heightMm / (design.heightMm >= 300 ? 100 : 10)
                ) + 1,
            },
            (_, i) => {
              const v = i * (design.heightMm >= 300 ? 100 : 10)
              return (
                <g key={`y${i}`}>
                  <line
                    x1={0}
                    y1={v}
                    x2={Math.min(8, design.widthMm * 0.03)}
                    y2={v}
                  />
                  <text
                    x={Math.min(9, design.widthMm * 0.04)}
                    y={v + Math.min(7, design.heightMm * 0.025)}
                    fontSize={Math.min(10, design.widthMm * 0.025)}
                    stroke="none"
                  >
                    {v}
                  </text>
                </g>
              )
            }
          )}
        </g>
      )}
      {showCutline &&
        design.kind === "pet" &&
        [
          [0, 0],
          [design.widthMm - 40, 0],
          [0, design.heightMm - 40],
          [design.widthMm - 40, design.heightMm - 40],
        ].map(([x, y], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width="40"
            height="40"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1"
          />
        ))}
      {showCutline &&
        design.kind === "mini" &&
        [
          [10, 10],
          [design.widthMm - 10, 10],
          [10, design.heightMm - 10],
          [design.widthMm - 10, design.heightMm - 10],
        ].map(([x, y], i) => (
          <g key={`mini-hole-${i}`} stroke="#111" strokeWidth={0.5}>
            <line x1={x - 2} y1={y} x2={x + 2} y2={y} />
            <line x1={x} y1={y - 2} x2={x} y2={y + 2} />
          </g>
        ))}
    </g>
  )
}
