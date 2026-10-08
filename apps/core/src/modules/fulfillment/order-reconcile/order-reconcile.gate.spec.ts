// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { stillInSituation } from './order-reconcile.gate';
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
