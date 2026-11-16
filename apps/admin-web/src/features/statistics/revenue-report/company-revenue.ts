import type { ExternalRevenueRow } from './model';

/** Monthly uploads remain separate from daily facts; they cannot establish daily pace or product margins. */
export function companyRevenueRows(
  rows: ExternalRevenueRow[],
  today: string,
  hasIntegratedChannels: boolean
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

    if (!['naver', 'coupang'].includes(row.channel))
      reason = '기존 누적·이관 매출과 중복 확인 필요';
    else if (hasIntegratedChannels) reason = '자동 수집 채널과 중복 확인 필요';
    else if ((groups.get(key) ?? 0) > 1)
      reason = '같은 계정·월의 매출 기준이 여러 개';
    else if (!['purchase_confirmed', 'paid', 'tax_report'].includes(row.basis))
      reason = '합산 가능한 매출 기준 확인 필요';

    return {
      ...row,
      included: !reason,
      reason: reason || '잠정 합산 · 중복·정산 확인 상태는 원자료 참조',
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
