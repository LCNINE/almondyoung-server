import type { RecurringBillingFinanceMonth } from '@/lib/types/dto/wallet';

export interface FinanceTile {
  key: 'billed' | 'paid' | 'collectionRate' | 'inProgress' | 'lost';
  label: string;
  value: string;
  hint: string;
}

const count = (n: number) => `${n.toLocaleString('ko-KR')}건`;
/** 이 화면의 다른 금액(표·상세)과 같은 「원」 표기 */
export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const formatRate = (r: number | null) => (r == null ? '-' : `${(r * 100).toFixed(1)}%`);

/** 한 달치 요약 → 상단 «돈» 타일. 정의 문구는 wallet `summarizeFinance` 와 같은 뜻으로 쓴다. */
export function financeTiles(m: RecurringBillingFinanceMonth): FinanceTile[] {
  const lostAmount = m.uncollectible.amount + m.mandateRejected.amount;
  return [
    {
      key: 'billed',
      label: '청구액',
      value: formatWon(m.billed.amount),
      hint: `${count(m.billed.invoices)} · 첫 출금 예정일이 이 달인 청구`,
    },
    { key: 'paid', label: '수금액', value: formatWon(m.paid.amount), hint: count(m.paid.invoices) },
    {
      key: 'collectionRate',
      label: '수금률',
      value: formatRate(m.collectionRate),
      hint:
        m.collectionRate == null
          ? '끝난 청구가 아직 없습니다'
          : `끝난 청구 기준 · 진행 중 ${formatWon(m.inProgress.amount)} 제외`,
    },
    {
      key: 'inProgress',
      label: '아직 진행 중',
      value: formatWon(m.inProgress.amount),
      hint: `${count(m.inProgress.invoices)} · 출금 대기·재시도 중`,
    },
    {
      key: 'lost',
      label: '못 걷은 돈',
      value: formatWon(lostAmount),
      hint: `출금 최종 실패 ${formatWon(m.uncollectible.amount)} · 계좌 심사 거절 ${formatWon(m.mandateRejected.amount)}`,
    },
  ];
}

export interface FinanceChartRow {
  label: string;
  month: string;
  paid: number;
  inProgress: number;
  lost: number;
}

export function financeChartRows(months: RecurringBillingFinanceMonth[]): FinanceChartRow[] {
  return months.map((m) => ({
    label: `${Number(m.month.slice(5))}월`,
    month: m.month,
    paid: m.paid.amount,
    inProgress: m.inProgress.amount,
    lost: m.uncollectible.amount + m.mandateRejected.amount,
  }));
}

/** 기준 달부터 과거로 12달 — 월 선택 목록 */
export function monthOptions(anchor: string): { value: string; label: string }[] {
  const [year, month] = anchor.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    return { value: `${y}-${String(mo).padStart(2, '0')}`, label: `${y}년 ${mo}월` };
  });
}

/** 한국 시간 기준 이번 달 'YYYY-MM' */
export function currentKstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}
