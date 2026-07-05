/**
 * DataTable `date` 필터가 URL 파라미터에 기록한 JSON(`{$gte,$lte}`)을 파싱한다.
 * 잘못된 값이면 조용히 빈 객체를 반환한다.
 */
export function parseDateRangeParam(raw?: string): {
  from?: string;
  to?: string;
} {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const from =
      '$gte' in parsed && typeof parsed.$gte === 'string'
        ? parsed.$gte
        : undefined;
    const to =
      '$lte' in parsed && typeof parsed.$lte === 'string'
        ? parsed.$lte
        : undefined;
    return { from, to };
  } catch {
    return {};
  }
}
