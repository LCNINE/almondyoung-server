export function BrushTraveller({
  x,
  y,
  width,
  height,
  stroke,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  stroke?: string;
}) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={stroke} />
      <line x1={centerX - 2} y1={centerY - 5} x2={centerX - 2} y2={centerY + 5} stroke="#fff" strokeWidth={1.5} />
      <line x1={centerX + 2} y1={centerY - 5} x2={centerX + 2} y2={centerY + 5} stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}
