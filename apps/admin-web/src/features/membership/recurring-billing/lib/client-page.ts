/** 한 번에 전체를 주는 목록을 화면에서만 나눈다. page 가 범위를 넘으면 마지막 쪽으로 붙인다. */
export function pageSlice<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}
