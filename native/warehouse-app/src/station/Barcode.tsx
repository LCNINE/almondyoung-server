/** Code128 최소 조용한 여백(10모듈). */
const QUIET = 10;

/** 모듈 비트열을 SVG 막대로 그린다. 인쇄에서 막대가 번지지 않게 crispEdges. */
export function Barcode({
  bits,
  label,
  moduleWidth = 2,
  height = 64,
}: {
  bits: string;
  label: string;
  moduleWidth?: number;
  height?: number;
}) {
  const bars: { x: number; width: number }[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (j < bits.length && bits[j] === '1') j++;
    bars.push({ x: QUIET + i, width: j - i });
    i = j;
  }
  const modules = bits.length + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={modules * moduleWidth}
      height={height}
      viewBox={`0 0 ${modules} ${height}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={height} fill="#fff" />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}
