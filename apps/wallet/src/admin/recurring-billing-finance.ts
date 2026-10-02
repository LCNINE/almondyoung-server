/**
 * 정기결제 «돈» 요약 — 멤버십 인보이스를 최초 출금 예정일(due_date)의 달로 묶는다.
 *
 * 귀속 축이 due_date 인 이유: 「이번 달에 청구한 돈이 얼마나 걷혔나」를 묻는 화면이다. 수금 시각(finalized_at)
 * 으로 묶으면 지난달 청구가 이번 달 재시도로 걷힌 돈이 섞여, 같은 달의 청구·수금·실패가 서로 다른 모수가 된다.
 * 매출 인식 기준(수금일)은 통계 화면의 `getMembershipRevenue` 가 따로 쓴다.
 */

/** 청구로 치지 않는 상태 — 발행 전 초안과 취소분 */
const NOT_BILLED = new Set(['DRAFT', 'VOID']);
/** 아직 끝나지 않은 청구. 수금률 분모에서 빼고 따로 보여준다(0 으로 뭉개지 않는다). */
const IN_PROGRESS = new Set(['OPEN', 'MANDATE_PENDING', 'ATTEMPTING', 'PAST_DUE']);

export interface FinanceStatusRow {
  /** KST 기준 'YYYY-MM' */
  month: string;
  status: string;
  amount: number;
  invoices: number;
  /** 한 번 이상 실패한 뒤 수금된 건수(PAID 행에서만 의미가 있다) */
  recovered: number;
}

export interface MoneyBucket {
  amount: number;
  invoices: number;
}

export interface FinanceMonth {
  month: string;
  billed: MoneyBucket;
  paid: MoneyBucket;
  inProgress: MoneyBucket;
  /** 재시도를 다 쓰고 걷지 못한 청구 */
  uncollectible: MoneyBucket;
  /** 자동이체 계좌 심사 거절로 걷지 못한 청구 */
  mandateRejected: MoneyBucket;
  /** 끝난 청구(수금 + 최종 실패 + 계좌 거절) 금액 중 수금 비율. 끝난 청구가 없으면 null */
  collectionRate: number | null;
  /** 한 번 이상 실패한 청구 중 결국 수금된 비율. 대상이 없으면 null */
  retryRecovery: { recovered: number; lost: number; rate: number | null };
}

const empty = (): MoneyBucket => ({ amount: 0, invoices: 0 });

const add = (bucket: MoneyBucket, row: FinanceStatusRow) => {
  bucket.amount += row.amount;
  bucket.invoices += row.invoices;
};

/** 기준 달을 포함해 과거로 `count` 달('YYYY-MM', 오래된 순). */
export function lastMonths(anchor: string, count: number): string[] {
  const [year, month] = anchor.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function summarizeFinance(rows: FinanceStatusRow[], months: string[]): FinanceMonth[] {
  return months.map((month) => {
    const result: FinanceMonth = {
      month,
      billed: empty(),
      paid: empty(),
      inProgress: empty(),
      uncollectible: empty(),
      mandateRejected: empty(),
      collectionRate: null,
      retryRecovery: { recovered: 0, lost: 0, rate: null },
    };

    for (const row of rows) {
      if (row.month !== month || NOT_BILLED.has(row.status)) continue;
      add(result.billed, row);
      if (row.status === 'PAID') {
        add(result.paid, row);
        result.retryRecovery.recovered += row.recovered;
      } else if (row.status === 'UNCOLLECTIBLE') {
        add(result.uncollectible, row);
        result.retryRecovery.lost += row.invoices;
      } else if (row.status === 'MANDATE_REJECTED') {
        add(result.mandateRejected, row);
      } else if (IN_PROGRESS.has(row.status)) {
        add(result.inProgress, row);
      }
    }

    const finished = result.paid.amount + result.uncollectible.amount + result.mandateRejected.amount;
    result.collectionRate = finished > 0 ? result.paid.amount / finished : null;
    const retried = result.retryRecovery.recovered + result.retryRecovery.lost;
    result.retryRecovery.rate = retried > 0 ? result.retryRecovery.recovered / retried : null;
    return result;
  });
}
