export function OrderIcon({
  position,
}: {
  position: "top" | "up" | "down" | "bottom"
}) {
  const active = { top: 0, up: 1, down: 2, bottom: 3 }[position]
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      {[3, 2, 1, 0].map((index) => {
        const y = 1 + index * 4
        return (
          <polygon
            key={index}
            points={`12,${y} 21,${y + 4} 12,${y + 8} 3,${y + 4}`}
            fill={active === index ? "#333" : "white"}
            stroke="#333"
            strokeWidth="1.2"
          />
        )
      })}
    </svg>
  )
}
