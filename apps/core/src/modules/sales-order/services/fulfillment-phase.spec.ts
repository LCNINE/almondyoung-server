import {
  deriveFulfillmentPhase,
  isPickingStarted,
  isReturnEligible,
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

describe('deriveFulfillmentPhase — 인쇄 외주 행도 이행 단위', () => {
  it('인쇄만: 전량 delivered → delivered', () => {
    const r = deriveFulfillmentPhase(input({ foCount: 0, printStatuses: ['delivered', 'delivered'] }));
    expect(r).toEqual({ phase: 'delivered', progress: { total: 2, shipped: 2, delivered: 2 } });
  });
  it('인쇄만: 하나라도 shipped → shipping', () => {
    expect(deriveFulfillmentPhase(input({ foCount: 0, printStatuses: ['shipped', 'submitted'] })).phase).toBe(
      'shipping',
    );
  });
  it('인쇄 + 창고: 창고 delivered 이어도 인쇄가 제작 중(submitted)이면 delivered 가 아니다', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered'], printStatuses: ['submitted'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 1, delivered: 1 });
  });
  it('인쇄 + 창고: 둘 다 delivered → delivered', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered'], printStatuses: ['delivered'] }));
    expect(r.phase).toBe('delivered');
  });
  it('인쇄 + 창고: 창고에 상자가 아직 없으면 인쇄가 delivered 여도 delivered 가 아니다', () => {
    const r = deriveFulfillmentPhase(input({ printStatuses: ['delivered'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 1, shipped: 1, delivered: 1 });
  });
  it('인쇄 + 디지털(FO 없음): 인쇄 submitted → preparing (not_created 아님)', () => {
    const r = deriveFulfillmentPhase(input({ foCount: 0, printStatuses: ['submitted'] }));
    expect(r).toEqual({ phase: 'preparing', progress: { total: 1, shipped: 0, delivered: 0 } });
  });
  it('일반 상품만 취소된 혼합 주문(FO 전부 canceled) — 인쇄가 살아 있으면 canceled 가 아니라 인쇄를 따른다', () => {
    expect(deriveFulfillmentPhase(input({ allFoCanceled: true, printStatuses: ['submitted'] })).phase).toBe(
      'preparing',
    );
    expect(deriveFulfillmentPhase(input({ allFoCanceled: true, printStatuses: ['delivered'] })).phase).toBe(
      'delivered',
    );
  });
  it('창고만(인쇄 없음): 기존과 같다', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered'] })).phase).toBe('delivered');
    expect(deriveFulfillmentPhase(input({ foCount: 0 })).phase).toBe('not_created');
    expect(deriveFulfillmentPhase(input({ allFoCanceled: true })).phase).toBe('canceled');
    expect(deriveFulfillmentPhase(input()).phase).toBe('preparing');
  });
});

describe('isReturnEligible', () => {
  it('창고 몫이 모두 배송완료면 택배로 shipped 에 머무는 인쇄 행이 있어도 연다', () => {
    expect(isReturnEligible(input({ activeShipmentStatuses: ['delivered'], printStatuses: ['shipped'] }))).toBe(true);
  });
  it('인쇄 행이 아직 발송 전이면 열지 않는다', () => {
    expect(isReturnEligible(input({ activeShipmentStatuses: ['delivered'], printStatuses: ['submitted'] }))).toBe(
      false,
    );
  });
  it('창고 몫이 아직 배송 중이면 열지 않는다', () => {
    expect(isReturnEligible(input({ activeShipmentStatuses: ['in_transit'], printStatuses: ['delivered'] }))).toBe(
      false,
    );
  });
  it('인쇄만 남은 주문은 고를 줄이 없어 열지 않는다', () => {
    expect(isReturnEligible(input({ foCount: 0, printStatuses: ['delivered'] }))).toBe(false);
    expect(isReturnEligible(input({ allFoCanceled: true, printStatuses: ['delivered'] }))).toBe(false);
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
