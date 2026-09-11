/**
 * 자동 리뷰 자격 발급 판정 — 「배송이 끝났을 법한 주문」을 고르는 규칙만 모은 순수 함수.
 *
 * **왜 구매확정이 아니라 자격 발급인가.** 이 쇼핑몰은 결제 «매입»(capture)이 체크아웃에서 끝난다
 * (라이브 실측: 주문→캡처 지연 중앙값 1.2초, 96%가 10분 이내, 90일 미캡처 4건). 그래서 Medusa 의
 * 구매확정 워크플로가 전제하는 「주문 시 승인 → 배송 후 매입」 모델은 여기서 남는 일이 없고,
 * step 1(캡처)은 실질 no-op 이다. 남은 실질은 리뷰 자격 하나라 **결제 경로를 아예 타지 않는다.**
 * 그 덕에 「자격 생성 실패가 결제 롤백으로 번진다」는 위험 자체가 사라진다.
 * 업계 관행도 자격을 구매확정과 묶지 않는다 — 쿠팡·네이버 모두 구매확정 전에 리뷰를 쓸 수 있다.
 *
 * **왜 세 단인가.** 기산점의 정본은 배송완료지만, 그 값은 택배사 트래킹이 core 로 들어와야 차고
 * 지금은 실물 출고가 셀메이트에서 이뤄져 core 의 dispatch 경로가 돌지 않는다. 그래서 라이브에서
 * `coreShipmentAttempts` 를 가진 주문이 **0 / 3,760** 이다(2026-09-11 실측). 물류연동이 붙으면
 * 투영이 차면서 위 단이 저절로 인수한다 — 그때까지 3단이 기능을 살려 둔다.
 *
 * 판정을 컨테이너 없이 테스트할 수 있게 여기 모아둔 것은 `entrance-password-purge.ts` 선례를 따른 것이다.
 */

/**
 * 1단 — 배송완료가 찍힌 주문. 쿠팡의 자동 구매확정이 배송완료 +7일이고 네이버가 ≈8일이다.
 */
export const ELIGIBILITY_DELIVERED_DAYS = readDays('ELIGIBILITY_DELIVERED_DAYS', 7);

/**
 * 2단 — 배송완료 없이 출고 투영만 있는 주문. 출고 → 배송완료가 보통 2~3일이라 1단과 거의 같은
 * 시점에 걸리게 둔다.
 */
export const ELIGIBILITY_SHIPPED_DAYS = readDays('ELIGIBILITY_SHIPPED_DAYS', 10);

/**
 * 3단 — 배송 정보가 «아예 없을» 때, 주문일 기준.
 *
 * 🔴 이 값의 근거는 감이 아니라 표준이다. 네이버 스마트스토어는 「배송 추적이 불가능한 주문」에
 * 대해 **발송처리일 기준 28일째 자동 구매확정**한다 — 우리 상황이 정확히 그 경우다. 다만 우리
 * 기산점은 발송처리일이 아니라 그보다 «이른» 주문일이라, 그대로 28 을 쓰면 표준보다 느슨해진다.
 * 발송 소요만큼 더해 30 으로 둔다.
 *
 * 길다고 느껴지면 그건 이 단이 «배송을 확인할 수 없는 상태»의 값이기 때문이다. 물류연동이 붙어
 * 1단이 인수하면 7일로 내려간다.
 */
export const ELIGIBILITY_ORDER_AGE_DAYS = readDays('ELIGIBILITY_ORDER_AGE_DAYS', 30);

/**
 * 🔴 **기간 창(일).** 기준 시각이 「유예 + 이 값」보다 오래된 주문은 후보로 보지 않는다.
 *
 * 창이 없으면 첫 실행이 과거 주문 전체에 자격을 만든다. 창 밖은 사람이 판단할 몫이다 —
 * 과거분을 일부러 밀어 주려면 이 값을 크게 준 채 `medusa exec` 로 한 번 돌리면 된다
 * (발급은 `source_event_id` unique 로 멱등이라 몇 번을 돌려도 결과가 같다).
 */
export const ELIGIBILITY_WINDOW_DAYS = readDays('ELIGIBILITY_WINDOW_DAYS', 30);

/** 한 틱에 처리하는 주문 수 상한. 넘친 분은 다음 틱이 가져간다. */
export const ELIGIBILITY_BATCH = readDays('ELIGIBILITY_BATCH', 50);

/**
 * 잡이 실제로 발급까지 하는지. 기본은 **꺼짐**이다 — 처음 켜는 순간 창 안의 주문이 한꺼번에
 * 자격을 받으므로, 운영자가 먼저 건수를 보고 켜야 한다. 끄면 후보를 세고 로그만 남긴다.
 */
export const eligibilityIssuingEnabled = (): boolean => process.env.ELIGIBILITY_AUTO_ISSUE === 'true';

function readDays(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 발급이 끝난 주문에 남기는 표식. 이게 있으면 다음 틱이 그 주문을 다시 집지 않는다. */
export const ELIGIBILITY_ISSUED_METADATA_KEY = 'reviewEligibilityIssuedAt';

/** `order.metadata.coreShipmentAttempts` 한 항목. channel-adapter 가 core 이벤트로 채운다. */
export interface ShipmentAttempt {
  status?: unknown;
  deliveredAt?: unknown;
  dispatchedAt?: unknown;
}

export interface EligibilityCandidate {
  id: string;
  created_at: Date | string;
  attempts: ShipmentAttempt[] | null;
}

export type EligibilityVerdict =
  | { eligible: true; orderId: string; basis: 'delivered' | 'shipped' | 'order_age'; basisAt: Date }
  | { eligible: false; orderId: string; reason: string };

const parseTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const ms = new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

/**
 * 한 주문에 자격을 발급해도 되는지.
 *
 * 보수적으로 판정한다:
 * - 회수(`recalled`)된 시도가 있으면 **건드리지 않는다.** 출고가 되돌려진 주문은 무슨 일이 있었던
 *   것이고, 자동으로 「배송이 끝났다」고 볼 자리가 아니다.
 * - 상자가 여럿이면 **가장 늦은** 시도를 기준으로, 하나라도 배송완료가 아니면 전체를 2단으로 본다.
 * - 배송 정보가 아예 없으면 3단(주문일)으로 내려간다. 정보가 «있는데 시각을 못 읽는» 경우는
 *   3단으로 내려보내지 않는다 — 그건 데이터 이상이지 「정보 없음」이 아니다.
 */
export function judgeEligibility(candidate: EligibilityCandidate, now: Date): EligibilityVerdict {
  const { id } = candidate;
  const attempts = Array.isArray(candidate.attempts) ? candidate.attempts : [];

  if (attempts.some((attempt) => attempt?.status === 'recalled')) {
    return { eligible: false, orderId: id, reason: 'recalled_attempt' };
  }

  if (!attempts.length) {
    const orderedAt = parseTime(candidate.created_at);
    if (orderedAt === undefined) return { eligible: false, orderId: id, reason: 'no_order_time' };
    return decide(id, orderedAt, 'order_age', ELIGIBILITY_ORDER_AGE_DAYS, now);
  }

  let latest: number | undefined;
  let allDelivered = true;

  for (const attempt of attempts) {
    const delivered = attempt?.status === 'delivered' ? parseTime(attempt.deliveredAt) : undefined;
    const dispatched = parseTime(attempt?.dispatchedAt);
    const at = delivered ?? dispatched;

    if (at === undefined) return { eligible: false, orderId: id, reason: 'attempt_without_timestamp' };
    if (delivered === undefined) allDelivered = false;
    if (latest === undefined || at > latest) latest = at;
  }

  return allDelivered
    ? decide(id, latest as number, 'delivered', ELIGIBILITY_DELIVERED_DAYS, now)
    : decide(id, latest as number, 'shipped', ELIGIBILITY_SHIPPED_DAYS, now);
}

function decide(
  orderId: string,
  basisMs: number,
  basis: 'delivered' | 'shipped' | 'order_age',
  graceDays: number,
  now: Date,
): EligibilityVerdict {
  const age = now.getTime() - basisMs;
  if (age < graceDays * DAY_MS) return { eligible: false, orderId, reason: 'within_grace' };
  if (age > (graceDays + ELIGIBILITY_WINDOW_DAYS) * DAY_MS) {
    // 창 밖 — 조용히 넘기지 않고 사유를 남긴다.
    return { eligible: false, orderId, reason: 'outside_window' };
  }
  return { eligible: true, orderId, basis, basisAt: new Date(basisMs) };
}

/**
 * 후보 조회.
 *
 * 판정은 위 순수 함수가 한다. SQL 은 **명백히 대상이 아닌 것을 싸게 쳐낸다**: 취소·삭제·초안 주문,
 * 무통장 입금 대기 주문(아직 결제가 안 끝났다), 그리고 **이미 자격을 발급한 주문**.
 *
 * 🔴 발급 여부를 주문 metadata 표식으로 보는 이유: ugc 의 자격 표는 다른 서비스의 DB 라 여기서
 * 조인할 수 없다. 표식이 없으면 창 안의 모든 주문을 매일 다시 보내게 된다(발급 자체는 멱등이라
 * 결과는 같지만, 매일 수백 번의 왕복이 헛돈다).
 *
 * `order by created_at asc` — 오래된 것부터. 배치 상한에 걸려도 굶는 주문이 없다.
 */
export const ELIGIBILITY_CANDIDATE_SQL = `
  select o.id, o.created_at, o.metadata->'coreShipmentAttempts' as attempts
  from "order" o
  where o.deleted_at is null
    and o.canceled_at is null
    and o.is_draft_order = false
    and coalesce(o.metadata->>'bank_transfer_status', '') <> 'awaiting_deposit'
    and o.metadata->>'${ELIGIBILITY_ISSUED_METADATA_KEY}' is null
    and o.created_at >= ?
  order by o.created_at asc
  limit ?
`;

/**
 * SQL 창의 하한 — **판정 창과 정확히 같은 지점**이어야 한다.
 *
 * 판정의 세 단 중 **가장 이른 기산점이 주문일**이므로 창도 주문일로 잡는다. 배송완료·출고는 주문
 * «뒤»에 오니 그 둘의 유예는 이 창 안에 이미 들어온다 — 3단 기준으로 잡아야 셋 다 안전하다.
 *
 * 🔴 **여기에 여유를 «더하면» 안 된다.** 후보 SQL 이 `order by created_at asc` 라 창의 가장 오래된
 * 쪽이 먼저 뽑히는데, 판정 창 밖은 전부 `outside_window` 로 버려지고 **표식도 안 남아 다음 틱에
 * 또 온다.** 창이 하루 넓으면 하루치 주문(라이브 실측 ~39건)이 배치 상한 50의 대부분을 차지해
 * 실제 발급이 굶는다 — 유입이 처리량을 넘겨 백로그가 영원히 안 줄어든다.
 * 여유가 사는 것이 없다: 창 밖 판정의 결과는 언제나 「버린다」뿐이다.
 */
export function candidateWindowStart(now: Date): Date {
  const maxGrace = Math.max(ELIGIBILITY_DELIVERED_DAYS, ELIGIBILITY_SHIPPED_DAYS, ELIGIBILITY_ORDER_AGE_DAYS);
  return new Date(now.getTime() - (maxGrace + ELIGIBILITY_WINDOW_DAYS) * DAY_MS);
}
