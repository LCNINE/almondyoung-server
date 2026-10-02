import { FinanceStatusRow, lastMonths, summarizeFinance } from './recurring-billing-finance';

const row = (month: string, status: string, amount: number, invoices: number, recovered = 0): FinanceStatusRow => ({
  month,
  status,
  amount,
  invoices,
  recovered,
});

describe('lastMonths', () => {
  it('기준 달을 포함해 거꾸로 N달, 해를 넘긴다', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('summarizeFinance', () => {
  it('달마다 상태를 수금·진행 중·최종 실패·계좌 거절로 나누고, 수금률은 끝난 청구만 분모로 쓴다', () => {
    const rows: FinanceStatusRow[] = [
      row('2026-09', 'PAID', 90_000, 18, 3),
      row('2026-09', 'PAST_DUE', 10_000, 2),
      row('2026-09', 'OPEN', 5_000, 1),
      row('2026-09', 'UNCOLLECTIBLE', 5_000, 1),
      row('2026-09', 'MANDATE_REJECTED', 5_000, 1),
    ];

    const [month] = summarizeFinance(rows, ['2026-09']);

    expect(month).toEqual({
      month: '2026-09',
      billed: { amount: 115_000, invoices: 23 },
      paid: { amount: 90_000, invoices: 18 },
      inProgress: { amount: 15_000, invoices: 3 },
      uncollectible: { amount: 5_000, invoices: 1 },
      mandateRejected: { amount: 5_000, invoices: 1 },
      collectionRate: 90_000 / 100_000,
      retryRecovery: { recovered: 3, lost: 1, rate: 3 / 4 },
    });
  });

  it('끝난 청구가 없는 달은 수금률을 0 이 아니라 null 로 둔다', () => {
    const [month] = summarizeFinance([row('2026-10', 'OPEN', 5_000, 1)], ['2026-10']);
    expect(month.collectionRate).toBeNull();
    expect(month.retryRecovery.rate).toBeNull();
    expect(month.inProgress).toEqual({ amount: 5_000, invoices: 1 });
  });

  it('행이 없는 달도 0 으로 채워 순서대로 돌려준다', () => {
    const result = summarizeFinance([row('2026-09', 'PAID', 1_000, 1)], ['2026-08', '2026-09']);
    expect(result.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(result[0].billed).toEqual({ amount: 0, invoices: 0 });
    expect(result[0].collectionRate).toBeNull();
  });

  it('VOID·DRAFT 는 청구액에 넣지 않는다', () => {
    const [month] = summarizeFinance(
      [row('2026-09', 'VOID', 5_000, 1), row('2026-09', 'DRAFT', 5_000, 1), row('2026-09', 'PAID', 1_000, 1)],
      ['2026-09'],
    );
    expect(month.billed).toEqual({ amount: 1_000, invoices: 1 });
  });
});
