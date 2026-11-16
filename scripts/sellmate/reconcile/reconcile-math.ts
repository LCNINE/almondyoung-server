/**
 * 저녁 맞추기 정본 산식 (DB 없음, 순수 함수).
 * 설계 문서 «계산» 과 같다. 이 파일이 산식의 단일 출처이고 적용·점검 코드는 여기만 부른다.
 */

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} 은 정수여야 한다: ${value}`);
  }
}

/** 셀메이트 가용 = 현재재고 − 미발송주문수. 음수도 그대로 돌린다. */
export function sellmateAvail(current: number, unshipped: number): number {
  assertInteger('current', current);
  assertInteger('unshipped', unshipped);
  return current - unshipped;
}

/** init 시점 기준값·이월. 음수 재고는 기준값을 음수 그대로 두고 같은 양을 이월로 둔다. */
export function initState(s: number): { baseline: number; carry: number } {
  assertInteger('s', s);
  return { baseline: s, carry: Math.max(0, -s) };
}

export type ItemFigures = {
  s: number;
  baseline: number;
  carry: number;
  onHand: number;
  reservedAll: number;
  reservedHandedOver: number;
  unshipped: number;
};

export type ApplyResult = {
  delta: number;
  carryAfter: number;
  uploadAvail: number;
  uploadCurrent: number;
};

/**
 * 한 품목 한 회의 적용값을 계산한다.
 * - A = 넘기지 않은 가용 재고 = onHand − (reservedAll − reservedHandedOver)
 * - R = 자사몰 예약을 깎지 않고 내릴 수 있는 여유 = max(0, onHand − reservedAll)
 * - net = 셀메이트 변화량 − 남은 이월
 * - net ≥ 0 이면 core 에 더하고, 음수면 여유 R 안에서 내리고 나머지는 이월로 넘긴다.
 */
export function planApply(f: ItemFigures): ApplyResult {
  assertInteger('s', f.s);
  assertInteger('baseline', f.baseline);
  assertInteger('carry', f.carry);
  assertInteger('onHand', f.onHand);
  assertInteger('reservedAll', f.reservedAll);
  assertInteger('reservedHandedOver', f.reservedHandedOver);
  assertInteger('unshipped', f.unshipped);

  const available = f.onHand - (f.reservedAll - f.reservedHandedOver);
  const room = Math.max(0, f.onHand - f.reservedAll);
  const net = f.s - f.baseline - f.carry;

  let delta: number;
  let carryAfter: number;
  if (net >= 0) {
    delta = net;
    carryAfter = 0;
  } else {
    const down = Math.min(-net, room);
    delta = 0 - down; // -down 은 down=0 일 때 -0 이 된다. 출력이 -0 이 되지 않게 뺄셈으로 쓴다.
    carryAfter = -net - down;
  }

  const uploadAvail = Math.max(0, available + delta - carryAfter);
  const uploadCurrent = uploadAvail + f.unshipped;
  return { delta, carryAfter, uploadAvail, uploadCurrent };
}

/**
 * 새로 짝지어진(또는 얼었다 풀린) 품목의 시작 상태: 기준값 = S, 이월 = 미발송주문수.
 * 그 품목의 core 재고는 셀메이트 미발송 마켓 주문과 한 번도 상계된 적이 없다. 그 주문이 나가도 셀메이트 S 는 그대로라
 * (현재·미발송이 같이 준다) 차이로는 영영 잡히지 않는다 — 그래서 미발송 전부를 이월로 두고 같은 회의 planApply 가
 * 여유 R 안에서 바로 뺀다. init 은 sync-stock 이 이미 상계했으므로 initState 를 쓴다.
 */
export function freshState(s: number, unshipped: number): { baseline: number; carry: number } {
  assertInteger('s', s);
  assertInteger('unshipped', unshipped);
  if (unshipped < 0) throw new Error(`unshipped 는 0 이상이어야 한다: ${unshipped}`);
  return { baseline: s, carry: unshipped };
}
