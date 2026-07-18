import {
  deriveFulfillmentPhase,
  isPickingStarted,
  hasShippedEvidence,
  FulfillmentPhaseInput,
} from './fulfillment-phase';

function input(over: Partial<FulfillmentPhaseInput> = {}): FulfillmentPhaseInput {
  return {
    foCount: 1,
    allFoCanceled: false,
    activeShipmentStatuses: [],
    dropShipStatuses: [],
    anyFoiShipped: false,
    ...over,
  };
}

describe('deriveFulfillmentPhase', () => {
  it('FO 없음 → not_created', () => {
    expect(deriveFulfillmentPhase(input({ foCount: 0 })).phase).toBe('not_created');
  });
  it('모든 FO canceled → canceled', () => {
    expect(deriveFulfillmentPhase(input({ allFoCanceled: true })).phase).toBe('canceled');
  });
  it('FO 있고 활성 유닛 0 → preparing', () => {
    expect(deriveFulfillmentPhase(input()).phase).toBe('preparing');
  });
  it('단일 상자 draft → preparing', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['draft'] })).phase).toBe('preparing');
  });
  it('단일 상자 shipped → shipping', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['shipped'] })).phase).toBe('shipping');
  });
  it('단일 상자 delivered → delivered', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered'] })).phase).toBe('delivered');
  });
  it('분할: A shipped·B preparing → shipping + progress{2,1,0}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['shipped', 'planned'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 1, delivered: 0 });
  });
  it('분할: A delivered·B shipped → shipping + progress{2,2,1}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered', 'shipped'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 2, delivered: 1 });
  });
  it('전량 배송완료 → delivered + progress{2,2,2}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered', 'delivered'] }));
    expect(r.phase).toBe('delivered');
    expect(r.progress).toEqual({ total: 2, shipped: 2, delivered: 2 });
  });
  it('recovery_required 상자는 준비중으로 숨김', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['recovery_required'] })).phase).toBe('preparing');
  });
  it('직배 forwarded → shipping', () => {
    expect(deriveFulfillmentPhase(input({ dropShipStatuses: ['forwarded'] })).phase).toBe('shipping');
  });
  it('직배 completed → delivered', () => {
    expect(deriveFulfillmentPhase(input({ dropShipStatuses: ['completed'] })).phase).toBe('delivered');
  });
  it('혼합: 창고 preparing + 직배 forwarded → shipping', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['draft'], dropShipStatuses: ['forwarded'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 1, delivered: 0 });
  });
});

describe('isPickingStarted', () => {
  it('FO processing 있으면 true', () => {
    expect(isPickingStarted([{ status: 'ready' }, { status: 'processing' }])).toBe(true);
  });
  it('processing 없으면 false', () => {
    expect(isPickingStarted([{ status: 'ready' }, { status: 'partially_reserved' }])).toBe(false);
  });
});

describe('hasShippedEvidence', () => {
  it('상자 이동(shipped) → true', () => {
    expect(hasShippedEvidence(input({ activeShipmentStatuses: ['shipped'], anyFoiShipped: true }))).toBe(true);
  });
  it('직배 forwarded → true', () => {
    expect(hasShippedEvidence(input({ dropShipStatuses: ['forwarded'] }))).toBe(true);
  });
  it('anyFoiShipped=true → true', () => {
    expect(hasShippedEvidence(input({ anyFoiShipped: true }))).toBe(true);
  });
  it('준비중만 → false', () => {
    expect(hasShippedEvidence(input({ activeShipmentStatuses: ['draft', 'planned'] }))).toBe(false);
  });
});
