/**
 * 계획 도우미(바텀업) — 세 축 가정에서 연매출을 계산한다.
 *   연매출 = 그 해 일수 × (하루 방문 × 주문 전환율 × 객단가 + 외부 채널 하루 순매출)
 * 위에서 정한 목표(하향식)와 이 계산(상향식)의 차이가 «무엇을 얼마나 바꿔야 하나»다.
 */

export interface PlanAssumptions {
  dailySessions: number;
  orderConversionRate: number;
  averageOrderValue: number;
  externalDailyRevenue: number;
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function annualFromAssumptions(year: number, a: PlanAssumptions): number {
  const ownDaily = a.dailySessions * a.orderConversionRate * a.averageOrderValue;
  return Math.round(daysInYear(year) * (ownDaily + a.externalDailyRevenue));
}

/** 하향식 목표를 맞추려면 자사몰(방문×전환×객단가)이 몇 배가 돼야 하나. 외부 채널은 가정값 고정. */
export function requiredOwnMallMultiplier(year: number, target: number, a: PlanAssumptions): number | null {
  const ownDaily = a.dailySessions * a.orderConversionRate * a.averageOrderValue;
  if (ownDaily <= 0) return null;
  const neededOwnDaily = target / daysInYear(year) - a.externalDailyRevenue;
  return neededOwnDaily / ownDaily;
}

/**
 * 연간 목표를 월 일수에 비례해 나눈다 — 서버(`revenue-goal.service.ts` 의 `allocateByDays`)와 같은 공식.
 * 반올림 오차는 12월에 몰아 합이 정확히 목표와 같다. 화면은 미리보기만 하고, 저장은 서버가 같은 식으로 한다.
 */
export function allocateByDays(year: number, annualTarget: number): number[] {
  const days = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(year, i + 1, 0)).getUTCDate());
  const total = days.reduce((a, b) => a + b, 0);
  const months = days.map((d) => Math.floor((annualTarget * d) / total));
  months[11] += annualTarget - months.reduce((a, b) => a + b, 0);
  return months;
}

/**
 * 계획 연매출. 올해 계획이면 이미 지나간 날은 «실제 실적»이고 남은 날만 가정으로 채운다 —
 * 올해를 «일수 × 하루 매출»로 연환산하면 지나간 아홉 달의 실제 숫자를 무시하게 된다.
 * 내년 이후는 그 해 전체를 가정으로 채운다.
 */
export function plannedAnnual(input: { year: number; today: string; dailyTotal: number; actualToYesterday: number }): number {
  const currentYear = Number(input.today.slice(0, 4));
  if (input.year !== currentYear) return Math.round(daysInYear(input.year) * input.dailyTotal);
  const end = Date.parse(`${input.year}-12-31T00:00:00Z`);
  const start = Date.parse(`${input.today}T00:00:00Z`);
  const remainingDays = Math.max(Math.round((end - start) / 86_400_000) + 1, 0);
  return Math.round(input.actualToYesterday + remainingDays * input.dailyTotal);
}
