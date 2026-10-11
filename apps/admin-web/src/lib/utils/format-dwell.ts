// 체류 시간 표기 — 보드 shape 와 취소 요청 shape 가 함께 쓴다(서로 import 하면 순환이라 여기 둔다).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDwell(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}일`;
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${Math.floor(ms / MIN)}분`;
}
