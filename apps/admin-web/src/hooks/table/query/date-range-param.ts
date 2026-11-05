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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 날짜만 적힌 범위(`yyyy-MM-dd`, 필터 상자가 URL 에 남기는 꼴)를 KST 하루 경계 시각으로 바꾼다.
 * 백엔드는 이 값을 `new Date()` 로 읽어 시각으로 비교하므로, 날짜만 보내면 UTC 자정이 되어
 * 「오늘」(from = to)이 길이 0 인 구간이 되고 다른 기간도 끝 날이 빠진다. 이미 시각이면 그대로 둔다.
 */
export function toDayBoundInstants(range: { from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  return {
    from: range.from && DATE_ONLY.test(range.from) ? `${range.from}T00:00:00.000+09:00` : range.from,
    to: range.to && DATE_ONLY.test(range.to) ? `${range.to}T23:59:59.999+09:00` : range.to,
  };
}
