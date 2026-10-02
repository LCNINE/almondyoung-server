import type { RecurringBillingFinanceMonth } from '@/lib/types/dto/wallet';
import { financeChartRows, financeTiles, monthOptions } from './finance-view';

const money = (amount: number, invoices: number) => ({ amount, invoices });

const month = (over: Partial<RecurringBillingFinanceMonth> = {}): RecurringBillingFinanceMonth => ({
  month: '2026-09',
  billed: money(115_000, 23),
  paid: money(90_000, 18),
  inProgress: money(15_000, 3),
  uncollectible: money(5_000, 1),
  mandateRejected: money(5_000, 1),
  collectionRate: 0.9,
  retryRecovery: { recovered: 3, lost: 1, rate: 0.75 },
  ...over,
});

describe('financeTiles', () => {
  it('수금률에는 진행 중 금액을 빼고 계산했다는 뜻을 붙인다', () => {
    const tiles = financeTiles(month());
    const rate = tiles.find((t) => t.key === 'collectionRate');
    expect(rate?.value).toBe('90.0%');
    expect(rate?.hint).toBe('끝난 청구 기준 · 진행 중 15,000원 제외');
  });

  it('끝난 청구가 없으면 0% 가 아니라 «아직 없음»으로 보여준다', () => {
    const rate = financeTiles(month({ collectionRate: null })).find((t) => t.key === 'collectionRate');
    expect(rate?.value).toBe('-');
    expect(rate?.hint).toBe('끝난 청구가 아직 없습니다');
  });

  it('못 걷은 돈은 최종 실패와 계좌 거절을 합치고 둘을 나눠 적는다', () => {
    const lost = financeTiles(month()).find((t) => t.key === 'lost');
    expect(lost?.value).toBe('10,000원');
    expect(lost?.hint).toBe('출금 최종 실패 5,000원 · 계좌 심사 거절 5,000원');
  });
});

describe('financeChartRows', () => {
  it('달 이름을 «9월»로 줄이고 못 걷은 돈을 합친다', () => {
    expect(financeChartRows([month()])).toEqual([
      { label: '9월', month: '2026-09', paid: 90_000, inProgress: 15_000, lost: 10_000 },
    ]);
  });
});

describe('monthOptions', () => {
  it('기준 달부터 과거로 12달, 해를 넘긴다', () => {
    const options = monthOptions('2026-02');
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ value: '2026-02', label: '2026년 2월' });
    expect(options[2]).toEqual({ value: '2025-12', label: '2025년 12월' });
  });
});
