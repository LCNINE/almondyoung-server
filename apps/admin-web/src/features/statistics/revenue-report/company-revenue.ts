import type { ExternalRevenueRow } from './model';

/** Monthly uploads remain separate from daily facts; they cannot establish daily pace or product margins. */
export function companyRevenueRows(
  rows: ExternalRevenueRow[],
  today: string,
  hasIntegratedChannels: boolean,
  coverageStart: string | null = null
) {
  const groups = new Map<string, number>();
  const current = rows.filter(
    (row) =>
      row.month.startsWith(today.slice(0, 4)) && row.month <= today.slice(0, 7)
  );

  for (const row of current) {
    const key = JSON.stringify([row.channel, row.account, row.month]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  const reviewed = current.map((row) => {
    const key = JSON.stringify([row.channel, row.account, row.month]);
    let reason = '';

    const beforeCoverage = Boolean(
      coverageStart &&
      /^\d{4}-\d{2}-\d{2}$/.test(coverageStart) &&
      row.month < coverageStart.slice(0, 7)
    );

    if (hasIntegratedChannels) reason = '자동 수집 채널과 중복 확인 필요';
    else if ((groups.get(key) ?? 0) > 1)
      reason = '같은 계정·월의 매출 기준이 여러 개';
    else if (row.channel === 'cafe24') {
      if (row.originalStatus !== 'confirmed') reason = '카페24 원본 확인 필요';
      else if (!['paid', 'tax_report', 'operational_net'].includes(row.basis))
        reason = '합산 가능한 매출 기준 확인 필요';
      else if (!beforeCoverage && row.duplicateStatus !== 'confirmed')
        reason = '자사몰 집계와 겹치는 기간 · 이관 주문 대조 필요';
    } else if (row.channel === 'phone') {
      if (
        row.originalStatus !== 'confirmed' ||
        row.duplicateStatus !== 'confirmed'
      )
        reason = '자사몰·셀메이트·다른 채널과 중복 대조 필요';
      else if (!['paid', 'tax_report'].includes(row.basis))
        reason = '합산 가능한 매출 기준 확인 필요';
    } else if (!['naver', 'coupang'].includes(row.channel))
      reason = '지원하지 않는 판매 채널';
    else if (!['purchase_confirmed', 'paid', 'tax_report'].includes(row.basis))
      reason = '합산 가능한 매출 기준 확인 필요';

    return {
      ...row,
      included: !reason,
      reason:
        reason ||
        (row.channel === 'cafe24' && beforeCoverage
          ? '일별 집계 시작 전 월 · 수기 누적액 대신 반영'
          : '잠정 합산 · 중복·정산 확인 상태는 원자료 참조'),
    };
  });
  const included = reviewed.filter((row) => row.included);

  return {
    rows: reviewed,
    amount: included.reduce((sum, row) => sum + row.amount, 0),
    currentMonthAmount: included
      .filter((row) => row.month === today.slice(0, 7))
      .reduce((sum, row) => sum + row.amount, 0),
    includedCount: included.length,
    excludedCount: reviewed.length - included.length,
  };
}

export const REVENUE_CHANNELS = {
  all: '전체',
  own_mall: '자사몰',
  naver: '스마트스토어',
  coupang: '쿠팡',
  phone: '전화 주문',
  membership: '멤버십',
  other: '기타 채널',
} as const;
export type RevenueChannel = keyof typeof REVENUE_CHANNELS;

/** One annual ledger for the headline, channel selector, chart and export. */
export function annualCompanyRevenue(input: {
  today: string;
  coverageStart: string | null;
  hasIntegratedChannels: boolean;
  daily: Array<{ date: string; ownMall: number; allChannels: number }>;
  refunds: Map<string, number> | null;
  external: ExternalRevenueRow[];
  membership?: Array<{ bucket: string; amount: number }> | null;
}) {
  const year = input.today.slice(0, 4);
  const currentMonth = input.today.slice(0, 7);
  const imported = companyRevenueRows(
    input.external,
    input.today,
    input.hasIntegratedChannels,
    input.coverageStart
  );
  const monthly = Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    own_mall: 0,
    naver: 0,
    coupang: 0,
    phone: 0,
    membership: 0,
    other: 0,
    all: 0,
  }));
  const byMonth = new Map(monthly.map((row) => [row.month, row]));
  let dailyAmount = 0;

  for (const day of input.daily) {
    if (day.date < `${year}-01-01` || day.date >= input.today) continue;
    const month = byMonth.get(day.date.slice(0, 7));
    if (!month) continue;

    month.own_mall += day.ownMall - (input.refunds?.get(day.date) ?? 0);
    month.other += day.allChannels - day.ownMall;
    dailyAmount += day.allChannels - (input.refunds?.get(day.date) ?? 0);
  }

  for (const row of imported.rows) {
    if (!row.included) continue;
    const month = byMonth.get(row.month);
    if (!month) continue;
    const channel = row.channel === 'cafe24' ? 'own_mall' : row.channel;
    if (
      channel === 'own_mall' ||
      channel === 'naver' ||
      channel === 'coupang' ||
      channel === 'phone'
    )
      month[channel] += row.amount;
  }

  for (const day of input.membership ?? []) {
    if (day.bucket < `${year}-01-01` || day.bucket >= input.today) continue;
    const month = byMonth.get(day.bucket.slice(0, 7));
    if (month) month.membership += day.amount;
  }

  const totals = {
    own_mall: 0,
    naver: 0,
    coupang: 0,
    phone: 0,
    membership: 0,
    other: 0,
    all: 0,
  };
  for (const month of monthly) {
    month.all =
      month.own_mall +
      month.naver +
      month.coupang +
      month.phone +
      month.membership +
      month.other;
    for (const channel of Object.keys(totals) as RevenueChannel[])
      totals[channel] += month[channel];
  }

  // Refund lookup failure is not zero refunds. Do not expose a partial total as a company result.
  return {
    imported,
    monthly,
    currentMonth,
    totals: input.refunds === null || input.membership === null ? null : totals,
    dailyAmount: input.refunds === null ? null : dailyAmount,
  };
}

export function companyMonthlyRows(
  revenue: ReturnType<typeof annualCompanyRevenue>,
  coverageStart: string | null
) {
  return revenue.monthly.map((month) => {
    const included = revenue.imported.rows.filter(
      (row) => row.included && row.month === month.month
    );
    const cafe = included
      .filter((row) => row.channel === 'cafe24')
      .reduce((sum, row) => sum + row.amount, 0);
    const collected = (channel: string) =>
      included.some((row) => row.channel === channel);
    const active = month.month <= revenue.currentMonth;
    return {
      month: month.month,
      medusa:
        active &&
        (month.own_mall !== cafe ||
          (coverageStart && month.month >= coverageStart.slice(0, 7)))
          ? month.own_mall - cafe
          : null,
      cafe24: collected('cafe24') ? cafe : null,
      naver: collected('naver') ? month.naver : null,
      coupang: collected('coupang') ? month.coupang : null,
      phone: collected('phone') ? month.phone : null,
      membership: active ? month.membership : null,
      other: active && month.other !== 0 ? month.other : null,
      all: active ? month.all : null,
    };
  });
}
