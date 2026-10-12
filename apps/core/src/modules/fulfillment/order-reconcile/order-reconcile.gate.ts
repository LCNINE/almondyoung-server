// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { ReconcileSituationRef } from './order-reconcile.rule';
import { DEPARTURE_GRACE_MIN, ReconcilePrior } from './order-reconcile.state';

/**
 * 실행 직전 재판정 게이트의 판단(스펙 D12·§11.4-3). 투영은 최대 1분 늦다 — 후보로 고른 뒤 지금 판정이 규칙의 칸을
 * 벗어났으면(외부 출고·채널 취소 요청·반품으로 넘어갔거나 이미 다음 단계) 규칙을 부르지 않는다.
 * 판정 SQL 의 우선순위를 규칙의 check 가 다시 구현하지 않아도 되게 하는 것이 목적이다.
 */
export function stillInSituation(
  situation: ReconcileSituationRef,
  judged: Pick<JudgedRow, 'stage' | 'state' | 'outcome'> | undefined,
): boolean {
  if (!judged || judged.outcome !== null) return false;
  if (judged.stage !== situation.stage || judged.state === null) return false;
  return situation.states.includes(judged.state);
}

/**
 * 게이트에 걸린 후보를 not_needed 로 기록할지(사용자 결정 2026-10-08). 막 acted·error 한 행(떠남 유예 안)만 덮지 않는다 —
 * 덮으면 deleteDeparted 의 유예가 풀려 깨운 backlog 가 pending 인 순간 행이 지워지고 «깨움→되돌아옴» 횟수가 리셋된다.
 * 나머지는 기록해 10분 물러나게 한다. 쓰지 않으면 투영 갱신이 멈췄을 때 같은 후보가 매분 맨 앞 50칸을 차지한다.
 * 유예의 정의는 repository 의 deleteDeparted 와 같다(updated_at 이 now − 유예 이하이면 지난 것).
 */
export function shouldRecordGateOut(
  prior: Pick<ReconcilePrior, 'lastResult' | 'updatedAt'> | null,
  now: Date,
): boolean {
  if (!prior || (prior.lastResult !== 'acted' && prior.lastResult !== 'error')) return true;
  return prior.updatedAt.getTime() <= now.getTime() - DEPARTURE_GRACE_MIN * 60_000;
}
