import type { Layer } from "../lib/document"

export function MotionMaskGraphic({ layer, id }: { layer: Layer; id: string }) {
  const mask = layer.imageMotionMask
  if (!mask || mask.shape === "full") return null
  const x = layer.x + (layer.width * mask.x) / 100
  const y = layer.y + (layer.height * mask.y) / 100
  const width = (layer.width * mask.width) / 100
  const height = (layer.height * mask.height) / 100
  return (
    <defs>
      <filter id={`${id}-feather`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation={Math.min(width, height) * 0.06} />
      </filter>
      <mask
        id={id}
        maskUnits="userSpaceOnUse"
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
      >
        <g fill="white" filter={`url(#${id}-feather)`}>
          {mask.shape === "ellipse" ? (
            <ellipse
              cx={x + width / 2}
              cy={y + height / 2}
              rx={width / 2}
              ry={height / 2}
            />
          ) : mask.shape === "scratch" ? (
            <>
              {[0, 0.2, 0.46, 0.72].map((position, i) => (
                <path
                  key={i}
                  d={`M${x + width * ((i % 2) * 0.04)} ${y + height * position} L${x + width} ${y + height * (position + 0.03)} L${x + width * 0.93} ${y + height * (position + 0.15)} L${x} ${y + height * (position + 0.11)} Z`}
                />
              ))}
            </>
          ) : (
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={
                mask.shape === "softRect" ? Math.min(width, height) * 0.12 : 0
              }
            />
          )}
        </g>
      </mask>
    </defs>
  )
}
