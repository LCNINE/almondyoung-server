import { addDays, differenceInDays } from 'date-fns';

/**
 * 주문일이 속한 30일 주기의 시작일을 계산
 *
 * @param billingDate - 구독 최초 결제일 (구독 시작일)
 * @param orderDate - 주문 발생일
 * @returns 해당 주문이 속한 주기의 시작일
 *
 * @example
 * billingDate: 2025-01-15
 * orderDate: 2025-10-28
 *
 * 계산 과정:
 * 1. 경과일: 286일
 * 2. 주기 번호: Math.floor(286 / 30) = 9 (10번째 주기)
 * 3. 시작일: 2025-01-15 + (9 * 30일) = 2025-10-15
 */
export function calculateCycleStart(billingDate: Date, orderDate: Date): Date {
  const daysSinceStart = differenceInDays(orderDate, billingDate);
  const cycleNumber = Math.floor(daysSinceStart / 30);
  return addDays(billingDate, cycleNumber * 30);
}

/**
 * 주기 번호 계산 (1부터 시작)
 * @param billingDate - 구독 최초 결제일
 * @param cycleStartDate - 주기 시작일
 * @returns 주기 번호 (첫 번째 주기 = 1)
 */
export function calculateCycleNumber(
  billingDate: Date,
  cycleStartDate: Date,
): number {
  const daysSinceStart = differenceInDays(cycleStartDate, billingDate);
  return Math.floor(daysSinceStart / 30) + 1;
}

/**
 * 주기 종료일 계산 (시작일 + 29일)
 * @param cycleStartDate - 주기 시작일
 * @returns 주기 종료일 (30일 주기의 마지막 날)
 */
export function calculateCycleEnd(cycleStartDate: Date): Date {
  return addDays(cycleStartDate, 29);
}

/**
 * 주기 완료 여부 판단
 * @param cycleEndDate - 주기 종료일
 * @returns true면 완료된 주기, false면 진행 중인 주기
 */
export function isCycleCompleted(cycleEndDate: Date): boolean {
  return cycleEndDate < new Date();
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환
 * @param date - 변환할 날짜 객체
 * @returns YYYY-MM-DD 형식 문자열
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
