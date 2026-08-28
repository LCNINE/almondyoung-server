// 추세 기반 단순 예측 — 최소제곱 선형회귀 + 예측구간. DB 없이 테스트할 수 있게 순수 함수로 둔다.

export interface ForecastInputPoint {
  /** YYYY-MM-DD */
  bucket: string;
  value: number;
}

export interface ForecastPoint {
  bucket: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  points: ForecastPoint[];
  /** 회귀에 실제로 쓰인 관측일 수 */
  basisCount: number;
  /** 하루당 변화량 */
  slopePerDay: number;
  /** 예측 구간 합계와 그 범위 */
  total: number;
  totalLower: number;
  totalUpper: number;
}

export interface ForecastOptions {
  /** 오늘(KST 로컬 달력). 이 날짜의 관측은 하루가 안 끝나 과소집계라 회귀에서 뺀다. */
  today: string;
  /** 추세를 뽑을 근거 기간 */
  basisDays: number;
  /** 며칠 앞까지 예측할지 */
  horizonDays: number;
}

/** 95% 예측구간의 정규근사 계수. 관측일이 적어 t 분포를 쓰는 게 더 정확하지만, 표는 참조표가 필요하다. */
const Z_95 = 1.96;

const DAY_MS = 86_400_000;

function toDayNumber(bucket: string): number {
  return Date.parse(`${bucket}T00:00:00Z`) / DAY_MS;
}

function toBucket(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 최근 basisDays 일의 관측으로 추세선을 그어 horizonDays 일 앞까지 예측한다.
 * 관측이 3일 미만이면(분산 추정에 최소 n-2 = 1 이 필요) 예측하지 않고 null 을 준다 —
 * 근거가 없는 선을 그리느니 안 그리는 게 맞다.
 */
export function forecastDaily(
  series: ForecastInputPoint[],
  { today, basisDays, horizonDays }: ForecastOptions,
): ForecastResult | null {
  const todayNumber = toDayNumber(today);
  const earliest = todayNumber - basisDays;

  const observations = series
    .map((point) => ({ x: toDayNumber(point.bucket), y: point.value }))
    .filter((point) => point.x >= earliest && point.x < todayNumber);

  const n = observations.length;
  if (n < 3) {
    return null;
  }

  const meanX = observations.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = observations.reduce((sum, p) => sum + p.y, 0) / n;
  const sxx = observations.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  const sxy = observations.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  const sse = observations.reduce((sum, p) => sum + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const residualSd = Math.sqrt(sse / (n - 2));

  const points: ForecastPoint[] = [];
  for (let step = 0; step < horizonDays; step += 1) {
    const x = todayNumber + step + 1;
    const value = intercept + slope * x;
    const standardError = residualSd * Math.sqrt(1 + 1 / n + (x - meanX) ** 2 / sxx);
    const halfWidth = Z_95 * standardError;
    points.push({
      bucket: toBucket(x),
      value: Math.round(value),
      lower: Math.round(value - halfWidth),
      upper: Math.round(value + halfWidth),
    });
  }

  return {
    points,
    basisCount: n,
    slopePerDay: slope,
    total: points.reduce((sum, p) => sum + p.value, 0),
    totalLower: points.reduce((sum, p) => sum + p.lower, 0),
    totalUpper: points.reduce((sum, p) => sum + p.upper, 0),
  };
}

/** 추이 차트 한 행 — 실적 칸과 예측 칸이 한 행에 같이 있는 건 실선·점선을 잇는 마지막 실적 점뿐이다. */
export interface TrendChartRow {
  bucket: string;
  netRevenue?: number;
  estimatedMargin?: number;
  netRevenueForecast?: number;
  estimatedMarginForecast?: number;
  netRevenueBand?: [number, number];
  estimatedMarginBand?: [number, number];
}

export interface TrendChartSeriesPoint {
  bucket: string;
  netRevenue: number;
  estimatedMargin: number;
}

export interface TrendChart {
  rows: TrendChartRow[];
  revenue: ForecastResult | null;
  margin: ForecastResult | null;
}

/**
 * 실적 시리즈 뒤에 예측 구간을 이어 붙인 차트 데이터를 만든다.
 * 실적 행의 기존 값은 절대 건드리지 않는다 — 예측은 칸을 더할 뿐이다.
 */
export function buildTrendChart(series: TrendChartSeriesPoint[], options: ForecastOptions): TrendChart {
  const revenue = forecastDaily(
    series.map((point) => ({ bucket: point.bucket, value: point.netRevenue })),
    options,
  );
  const margin = forecastDaily(
    series.map((point) => ({ bucket: point.bucket, value: point.estimatedMargin })),
    options,
  );

  const rows: TrendChartRow[] = series.map((point) => ({
    bucket: point.bucket,
    netRevenue: point.netRevenue,
    estimatedMargin: point.estimatedMargin,
  }));

  if (revenue && margin) {
    // 마지막 실적 점에 같은 값을 예측 칸으로도 넣어야 실선과 점선이 끊기지 않는다
    const anchor = rows[rows.length - 1];
    anchor.netRevenueForecast = anchor.netRevenue;
    anchor.netRevenueBand = [anchor.netRevenue!, anchor.netRevenue!];
    anchor.estimatedMarginForecast = anchor.estimatedMargin;
    anchor.estimatedMarginBand = [anchor.estimatedMargin!, anchor.estimatedMargin!];

    revenue.points.forEach((point, index) => {
      const marginPoint = margin.points[index];
      rows.push({
        bucket: point.bucket,
        netRevenueForecast: point.value,
        netRevenueBand: [point.lower, point.upper],
        estimatedMarginForecast: marginPoint.value,
        estimatedMarginBand: [marginPoint.lower, marginPoint.upper],
      });
    });
  }

  return { rows, revenue, margin };
}
