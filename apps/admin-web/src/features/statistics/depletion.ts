/**
 * 재고 소진일수 — 레포에 재고회전·재고일수 개념이 없어서 두 축(재고 수량·기간 판매수량)에서 유도한다.
 *
 *   소진일수 = 현재 재고수량 ÷ (기간 판매수량 ÷ 기간 일수)
 *
 * 🔴 근사치다. "앞으로의 판매 속도가 조회 기간과 같다"를 가정하며 시즌성·프로모션·품절 기간을
 * 반영하지 않는다. 화면이 그렇게 밝혀야 한다.
 *
 * 판매가 0이면 계산하지 않는다 — 0으로 나눠 무한대를 만들거나 "999일"로 뭉개면 "안 팔린다"는
 * 사실이 "재고가 아주 오래 간다"로 둔갑한다. 사유별로 분리해 돌려준다.
 */
export type DepletionEstimate =
  | { status: 'ok'; days: number; dailyVelocity: number }
  | { status: 'no-sales' }
  | { status: 'no-stock' }
  | { status: 'unknown' };

/** 양끝 포함 일수. 뒤집힌 구간은 0 이다(호출부가 계산을 포기하게 만든다). */
export function inclusiveRangeDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  return days > 0 ? days : 0;
}

export function estimateDepletion(
  onHandQuantity: number | null | undefined,
  quantitySold: number | null | undefined,
  rangeDays: number,
): DepletionEstimate {
  if (onHandQuantity == null || rangeDays <= 0) return { status: 'unknown' };
  if (onHandQuantity <= 0) return { status: 'no-stock' };
  if (quantitySold == null || quantitySold <= 0) return { status: 'no-sales' };

  const dailyVelocity = quantitySold / rangeDays;
  return { status: 'ok', days: onHandQuantity / dailyVelocity, dailyVelocity };
}
