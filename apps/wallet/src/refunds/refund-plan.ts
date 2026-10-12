/**
 * intent 하나의 환불 요청액을 charge(leg) 들에 나눈다 — **남은 금액(remaining) 비례**.
 *
 * 기존 정책(원금 비례 · `Math.round` · 마지막 leg 가 나머지를 흡수)을 «원금» 대신 «남은 금액» 에 적용한
 * 일반화다. 앞선 환불이 모두 비례였다면 남은 금액의 비율이 원금의 비율과 같아 결과도 같다.
 *
 * `Math.round` 몫과 마지막 leg 의 나머지는 정수 KRW 라 leg 의 남은 금액을 넘거나(4-way 이상에서 앞 leg 들이
 * 내림될 때) 음수가 될 수 있다(앞 leg 들이 올림될 때 — 옛 코드는 음수 leg 를 건너뛰어 요청보다 더 환불했다).
 * 그래서 각 몫을 `[0, remaining]` 으로 자른 뒤 어긋난 차이를 결정적으로 옮긴다:
 * - 모자라면 앞(분할 순서)에서부터 여유가 있는 leg 에 더한다
 * - 넘치면 뒤에서부터 몫이 있는 leg 에서 덜어낸다
 *
 * 전제: 모든 `remaining > 0`(정수), `0 ≤ amount ≤ Σ remaining`(정수). 결과는 입력과 같은 순서의 몫 배열이고
 * 합은 정확히 `amount`, 각 몫은 `0 ≤ share ≤ remaining` 이다. 전제가 깨지면 던진다 — 돈을 움직이기 전이다.
 */
export function splitRefundOverRemaining(legs: ReadonlyArray<{ remaining: number }>, amount: number): number[] {
  const totalRemaining = legs.reduce((sum, leg) => sum + leg.remaining, 0);
  if (!Number.isInteger(amount) || amount < 0 || amount > totalRemaining) {
    throw new Error(`REFUND_SPLIT_INVALID: amount=${amount} totalRemaining=${totalRemaining}`);
  }
  if (legs.length === 0) return [];

  // 1) 기존 정책: Math.round 비례 몫, 마지막 leg 가 나머지
  let assigned = 0;
  const raw = legs.map((leg, i) => {
    if (i === legs.length - 1) return amount - assigned;
    const share = Math.round(amount * (leg.remaining / totalRemaining));
    assigned += share;
    return share;
  });

  // 2) [0, remaining] 으로 자르고 차이를 옮긴다
  const shares = raw.map((share, i) => Math.min(Math.max(share, 0), legs[i].remaining));
  let diff = amount - shares.reduce((sum, s) => sum + s, 0);
  for (let i = 0; diff > 0 && i < shares.length; i++) {
    const add = Math.min(diff, legs[i].remaining - shares[i]);
    shares[i] += add;
    diff -= add;
  }
  for (let i = shares.length - 1; diff < 0 && i >= 0; i--) {
    const sub = Math.min(-diff, shares[i]);
    shares[i] -= sub;
    diff += sub;
  }
  if (diff !== 0) throw new Error(`REFUND_SPLIT_UNBALANCED: amount=${amount} shares=${shares.join(',')}`);
  return shares;
}
