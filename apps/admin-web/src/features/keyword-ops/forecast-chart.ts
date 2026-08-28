// 빈손 검색(결과 0건으로 끝난 검색) 횟수의 추세 예측 차트 데이터.
//
// 예측 자체는 이익 탭이 쓰는 forecastDaily 를 그대로 쓴다 — 회귀·예측구간 규칙(날짜 간격
// 기준, 오늘 관측 제외, 관측 3일 미만이면 예측 없음)을 두 벌로 두지 않기 위해서다.

import { forecastDaily, type ForecastOptions, type ForecastResult } from '../statistics/forecast';

export interface KeywordTrendPoint {
  bucket: string;
  count: number;
  zeroCount: number;
}

/** 실적 칸과 예측 칸이 한 행에 같이 있는 건 실선·점선을 잇는 마지막 실적 점뿐이다. */
export interface KeywordTrendRow {
  bucket: string;
  count?: number;
  zeroCount?: number;
  zeroForecast?: number;
  zeroBand?: [number, number];
}

export interface KeywordTrendChart {
  rows: KeywordTrendRow[];
  zero: ForecastResult | null;
}

/**
 * 실적 시리즈 뒤에 빈손 검색 예측 구간을 이어 붙인다.
 * 실적 행의 기존 값은 건드리지 않는다 — 예측은 칸을 더할 뿐이다.
 */
export function buildKeywordTrendChart(
  series: KeywordTrendPoint[],
  options: ForecastOptions,
): KeywordTrendChart {
  const zero = forecastDaily(
    series.map((point) => ({ bucket: point.bucket, value: point.zeroCount })),
    options,
  );

  const rows: KeywordTrendRow[] = series.map((point) => ({
    bucket: point.bucket,
    count: point.count,
    zeroCount: point.zeroCount,
  }));

  if (zero && rows.length > 0) {
    // 마지막 실적 점에 같은 값을 예측 칸으로도 넣어야 실선과 점선이 끊기지 않는다
    const anchor = rows[rows.length - 1];
    anchor.zeroForecast = anchor.zeroCount;
    anchor.zeroBand = [anchor.zeroCount!, anchor.zeroCount!];

    for (const point of zero.points) {
      rows.push({
        bucket: point.bucket,
        zeroForecast: point.value,
        // 검색 횟수는 음수가 될 수 없다 — 회귀 하단이 음수로 내려가면 0 에서 자른다
        zeroBand: [Math.max(0, point.lower), Math.max(0, point.upper)],
      });
    }
  }

  return { rows, zero };
}
