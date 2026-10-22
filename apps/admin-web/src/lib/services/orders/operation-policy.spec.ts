import {
  FULFILLMENT_SCOPES,
  canRecallShipment,
  canShowFulfillmentAction,
  isRecoverableOperation,
} from './operation-policy';

describe('fulfillment admin operation policy', () => {
  it('hides privileged actions without treating visibility as authorization', () => {
    const scopes = [FULFILLMENT_SCOPES.operate];
    expect(canShowFulfillmentAction('split', scopes)).toBe(true);
    expect(canShowFulfillmentAction('recall', scopes)).toBe(false);
    expect(canShowFulfillmentAction('consolidate', scopes)).toBe(false);
    expect(canShowFulfillmentAction('forceDispatch', scopes)).toBe(false);
  });

  it('미처리 취소는 화면 액션이 아니다 (K6 D1)', () => {
    // 상자 미처리분은 판매주문 취소로만 줄어든다 — 운영자 라우트와 버튼을 지웠다.
    const action = 'cancelOutstanding';
    const scopes = [FULFILLMENT_SCOPES.operate];
    // @ts-expect-error — 'cancelOutstanding' 은 FulfillmentAdminAction 에서 빠졌다
    const visible = canShowFulfillmentAction(action, scopes);
    expect(visible).toBe(false);
  });

  it('only marks durable non-terminal states recoverable', () => {
    expect(isRecoverableOperation('pending')).toBe(true);
    expect(isRecoverableOperation('in_progress')).toBe(true);
    expect(isRecoverableOperation('recovery_required')).toBe(true);
    expect(isRecoverableOperation('completed')).toBe(false);
    expect(isRecoverableOperation('succeeded')).toBe(false);
  });

  it('only offers recall for a shipped shipment with a dispatched attempt', () => {
    expect(canRecallShipment('shipped', ['dispatched'])).toBe(true);
    expect(canRecallShipment('delivered', ['dispatched'])).toBe(false);
    expect(canRecallShipment('shipped', ['delivered'])).toBe(false);
    expect(canRecallShipment('in_transit', ['dispatched'])).toBe(false);
  });
});
