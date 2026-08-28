import { SalesDailyPoint } from './sales-table';

/**
 * 매출 숫자를 문장으로 바꾼다. 그래프를 사람이 해석하게 두지 않는 것이 목적이다.
 *
 * 규칙:
 * - **오늘은 비교에 쓰지 않는다.** 아직 안 끝난 하루라 항상 낮게 나와 "하락"으로 오독된다.
 * - 판단 근거가 모자라면 문장을 만들지 않는다(빈 배열). 억지 문장은 신뢰를 깎는다.
 * - 톤은 관측 사실까지만. 원인 추정은 하지 않는다(라운드 12 의 자동 판정 금지와 같은 정신).
 */

export type InsightTone = 'good' | 'bad' | 'neutral';

export interface SalesInsight {
  key: string;
  tone: InsightTone;
  text: string;
}

/** 비교에 쓸 수 있는 "끝난 날"만 남긴다. */
export function completedDays(points: SalesDailyPoint[], today: string): SalesDailyPoint[] {
  return points.filter((point) => point.date < today);
}

/** 마지막 날부터 거슬러 오르며 같은 방향이 몇 일 이어졌나. 부호가 0이면 끊긴다. */
export function trendStreak(values: number[]): { direction: 'up' | 'down' | 'flat'; days: number } {
  if (values.length < 3) return { direction: 'flat', days: 0 };
  const deltas: number[] = [];
  for (let index = values.length - 1; index > 0; index -= 1) {
    deltas.push(values[index] - values[index - 1]);
  }
  const first = deltas[0];
  if (first === 0) return { direction: 'flat', days: 0 };
  const direction = first > 0 ? 'up' : 'down';
  let days = 0;
  for (const delta of deltas) {
    if (direction === 'up' ? delta > 0 : delta < 0) days += 1;
    else break;
  }
  // 2일 연속은 우연이 흔하다 — 3일부터 이야기할 값어치가 있다.
  return days >= 3 ? { direction, days } : { direction: 'flat', days: 0 };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentText(rate: number): string {
  return `${rate > 0 ? '+' : ''}${Math.round(rate * 100)}%`;
}

const STREAK_MIN_DAYS = 3;
/** 평균 대비 이 정도는 일상적인 흔들림이라 말하지 않는다. */
const NOTABLE_RATE = 0.2;
/** 결제가 주문의 이만큼도 안 되면 미입금·결제 이탈을 의심할 값이다. */
const PAYMENT_GAP_RATE = 0.6;
/** 환불이 결제의 이만큼을 넘으면 눈에 띄어야 한다. */
const REFUND_ALERT_RATE = 0.15;

export function buildSalesInsights(points: SalesDailyPoint[], today: string): SalesInsight[] {
  const closed = completedDays(points, today);
  if (closed.length < 4) return [];

  const insights: SalesInsight[] = [];
  const latest = closed[closed.length - 1];
  const priorWindow = closed.slice(Math.max(0, closed.length - 8), closed.length - 1);
  const priorMean = mean(priorWindow.map((point) => point.orderAmount));

  if (priorMean != null && priorMean > 0) {
    const rate = (latest.orderAmount - priorMean) / priorMean;
    if (Math.abs(rate) >= NOTABLE_RATE) {
      insights.push({
        key: 'vs-average',
        tone: rate > 0 ? 'good' : 'bad',
        text: `어제 주문이 직전 ${priorWindow.length}일 평균보다 ${percentText(rate)}입니다`,
      });
    }
  }

  const streak = trendStreak(closed.map((point) => point.orderAmount));
  if (streak.days >= STREAK_MIN_DAYS) {
    insights.push({
      key: 'streak',
      tone: streak.direction === 'up' ? 'good' : 'bad',
      text: `주문이 ${streak.days}일 연속 ${streak.direction === 'up' ? '늘고' : '줄고'} 있습니다`,
    });
  }

  const window = closed.slice(Math.max(0, closed.length - 7));
  const orderSum = window.reduce((sum, point) => sum + point.orderAmount, 0);
  const paidSum = window.reduce((sum, point) => sum + point.paidAmount, 0);
  const refundSum = window.reduce((sum, point) => sum + point.refundAmount, 0);

  if (orderSum > 0 && paidSum / orderSum < PAYMENT_GAP_RATE) {
    insights.push({
      key: 'payment-gap',
      tone: 'bad',
      text: `최근 ${window.length}일 결제액이 주문액의 ${Math.round((paidSum / orderSum) * 100)}%입니다 — 미입금·결제 이탈을 확인하세요`,
    });
  }

  if (paidSum > 0 && refundSum / paidSum >= REFUND_ALERT_RATE) {
    insights.push({
      key: 'refund',
      tone: 'bad',
      text: `최근 ${window.length}일 환불이 결제액의 ${Math.round((refundSum / paidSum) * 100)}%입니다`,
    });
  }

  if (insights.length === 0) {
    insights.push({ key: 'steady', tone: 'neutral', text: `최근 ${window.length}일 매출이 평소 범위 안에서 움직이고 있습니다` });
  }
  return insights;
}
