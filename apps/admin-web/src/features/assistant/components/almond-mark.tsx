/** 아몬드영 파비콘의 아몬드 마크. 어두운 노브 위에 올라간다. */
export function AlmondMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g transform="rotate(28 12 12)">
        <ellipse cx="12" cy="12" rx="6" ry="8.8" fill="#fff" />
        <ellipse
          cx="12"
          cy="12"
          rx="6"
          ry="8.8"
          fill="none"
          stroke="#E9A63C"
          strokeWidth="2.4"
        />
        <line
          x1="12"
          y1="7.2"
          x2="12"
          y2="16.8"
          stroke="#6B4A2F"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
