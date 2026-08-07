import { addDays } from 'date-fns';

/**
 * 절약 내역을 끊어 보는 단위 = **결제 주기**.
 *
 * 달력 월이 아니다. 환불 가능 여부가 결제 주기 기준으로 판정되므로, 고객이 화면에서 본 금액과
 * 환불 판정 근거가 같으려면 화면도 같은 경계로 끊어야 한다. 월초 가입자가 달력 월로 보면
 * 가입 전 기간이 섞이고, 연간 계약은 경계가 아예 맞지 않는다.
 */
export interface BillingPeriod {
  contractId: string;
  /** 계약 내 몇 번째 주기인지 (1부터) */
  periodNumber: number;
  start: Date;
  /** 주기 종료(배타적). 이 시각 미만의 주문이 이 주기에 속한다. */
  end: Date;
  /** 아직 진행 중인 주기인지 */
  isCurrent: boolean;
}

export interface ContractPeriodSource {
  contractId: string;
  /** 이 계약의 첫 결제일(=주기 기준점) */
  start: Date;
  /** 이용이 끝난(또는 끝날) 시각. 진행 중이면 미래 날짜. */
  end: Date;
  durationDays: number;
}

/** 주기 길이가 비정상(0 이하)인 계약이 무한 루프를 만들지 않게 하는 하한. */
const MIN_DURATION_DAYS = 1;
/** 한 계약이 만들 수 있는 주기 수 상한. 데이터 이상으로 주기가 폭주해도 응답이 죽지 않게 한다. */
const MAX_PERIODS_PER_CONTRACT = 240;

/**
 * 계약 하나를 결제 주기들로 쪼갠다.
 *
 * 마지막 주기는 계약 종료일에서 잘린다 — 중도해지한 계약의 마지막 주기가 실제 이용 기간보다
 * 길게 보이면 "그 기간에 얼마 아꼈나"가 부풀어 보인다.
 */
export function deriveBillingPeriods(source: ContractPeriodSource, now: Date): BillingPeriod[] {
  const duration = Math.max(MIN_DURATION_DAYS, source.durationDays);
  // 아직 시작하지 않은 계약(무료체험 중 선등록 등)은 보여줄 주기가 없다.
  if (source.start > now) return [];

  const limit = source.end < now ? source.end : now;
  const periods: BillingPeriod[] = [];

  let cursor = source.start;
  let periodNumber = 1;
  while (cursor <= limit && periods.length < MAX_PERIODS_PER_CONTRACT) {
    const naturalEnd = addDays(cursor, duration);
    const end = naturalEnd < source.end ? naturalEnd : source.end;
    periods.push({
      contractId: source.contractId,
      periodNumber,
      start: cursor,
      end,
      isCurrent: cursor <= now && now < end,
    });
    cursor = naturalEnd;
    periodNumber += 1;
  }

  return periods;
}

/**
 * 주문 단위 할인 이벤트를 주기별로 나눠 담는다.
 *
 * 어느 주기에도 속하지 않는 주문(가입 전, 계약 사이 공백기)은 어떤 주기에도 더하지 않는다 —
 * 멤버십이 없던 기간의 할인을 멤버십 절약액으로 세면 안 된다.
 */
export function bucketDiscountsByPeriod<T extends { orderDate: Date; discountAmount: number }>(
  periods: BillingPeriod[],
  events: T[],
): Map<BillingPeriod, T[]> {
  const buckets = new Map<BillingPeriod, T[]>(periods.map((p) => [p, [] as T[]]));

  for (const event of events) {
    const period = periods.find((p) => event.orderDate >= p.start && event.orderDate < p.end);
    if (period) buckets.get(period)!.push(event);
  }

  return buckets;
}
