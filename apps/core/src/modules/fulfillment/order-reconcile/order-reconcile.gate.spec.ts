// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { shouldRecordGateOut, stillInSituation } from './order-reconcile.gate';
import { OrderReconcileSituation } from './order-reconcile.rule';

type Judged = Pick<JudgedRow, 'stage' | 'state' | 'outcome'>;
const awaiting: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };
const judged = (over: Partial<Judged> = {}): Judged => ({
  stage: 'fo',
  state: 'awaiting_matching',
  outcome: null,
  ...over,
});

describe('stillInSituation — 실행 직전 재판정 게이트(스펙 D12)', () => {
  it('지금 판정이 같은 단계·세부 상태면 통과한다', () => {
    expect(stillInSituation(awaiting, judged())).toBe(true);
  });

  it('칸의 세부 상태가 여럿이면 그중 하나여도 통과한다', () => {
    const either: OrderReconcileSituation = { stage: 'fo', states: ['pending', 'failed'] };
    expect(stillInSituation(either, judged({ state: 'failed' }))).toBe(true);
  });

  it('같은 단계의 다른 세부 상태(막 깨워 pending)면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ state: 'pending' }))).toBe(false);
  });

  it('다음 단계로 넘어갔으면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ stage: 'reserve', state: 'created' }))).toBe(false);
  });

  it('종료(셀메이트 외부 출고)면 막는다 — 투영이 아직 fo 여도', () => {
    expect(stillInSituation(awaiting, judged({ stage: null, state: null, outcome: 'external_shipped' }))).toBe(false);
  });

  it('채널 취소 요청이 끼어들었으면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ stage: 'cancel_request', state: 'cancel_requested' }))).toBe(false);
  });

  it('판정 결과가 없으면(주문이 사라짐) 막는다', () => {
    expect(stillInSituation(awaiting, undefined)).toBe(false);
  });

  it('세부 상태가 null 이면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ state: null }))).toBe(false);
  });
});

describe('shouldRecordGateOut — 게이트에 걸린 후보를 기록할지', () => {
  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  it('기록이 없으면 not_needed 로 남겨 10분 물러난다 — 안 쓰면 투영이 멈췄을 때 매분 맨 앞 50칸을 차지한다', () => {
    expect(shouldRecordGateOut(null, NOW)).toBe(true);
  });

  it('직전 결과가 not_needed·would_act 면 덮어도 잃을 것이 없다', () => {
    expect(shouldRecordGateOut({ lastResult: 'not_needed', updatedAt: minAgo(1) }, NOW)).toBe(true);
    expect(shouldRecordGateOut({ lastResult: 'would_act', updatedAt: minAgo(1) }, NOW)).toBe(true);
  });

  it('막 acted·error 한 행(유예 안)은 덮지 않는다 — 덮으면 떠남 유예가 풀려 횟수가 리셋된다', () => {
    expect(shouldRecordGateOut({ lastResult: 'acted', updatedAt: minAgo(1) }, NOW)).toBe(false);
    expect(shouldRecordGateOut({ lastResult: 'error', updatedAt: minAgo(9) }, NOW)).toBe(false);
  });

  it('유예가 지난 acted 행은 deleteDeparted 도 지우므로 덮어도 된다 — 경계(정확히 10분)는 지난 것으로 본다', () => {
    expect(shouldRecordGateOut({ lastResult: 'acted', updatedAt: minAgo(10) }, NOW)).toBe(true);
    expect(shouldRecordGateOut({ lastResult: 'error', updatedAt: minAgo(30) }, NOW)).toBe(true);
  });
});

describe('OrderReconcileSituation 타입 — npm run type-check 가 검사한다', () => {
  it('단계에 없는 세부 상태·다른 단계의 세부 상태는 컴파일 에러다', () => {
    // @ts-expect-error 오타
    const typo: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matchin'] };
    // @ts-expect-error plan 단계의 세부 상태를 fo 에 붙임
    const crossed: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_plan'] };
    const ok: OrderReconcileSituation = { stage: 'plan', states: ['awaiting_plan'] };
    expect([typo, crossed, ok]).toHaveLength(3);
  });
});
