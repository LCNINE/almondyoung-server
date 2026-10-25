import { isPickingStarted, shipmentProgressOf, FulfillmentPhaseInput } from './fulfillment-phase';

function input(over: Partial<FulfillmentPhaseInput> = {}): FulfillmentPhaseInput {
  return {
    foCount: 1,
    allFoCanceled: false,
    activeShipmentStatuses: [],
    supplierShipmentStages: [],
    ...over,
  };
}

describe('shipmentProgressOf — 진행 요약은 단계가 아니라 소포 수', () => {
  const empty = { total: 0, shipped: 0, delivered: 0 };
  it('창고 몫도 인쇄 몫도 없으면 비어 있다', () => {
    expect(shipmentProgressOf(input({ foCount: 0 }))).toEqual(empty);
    expect(shipmentProgressOf(input({ allFoCanceled: true }))).toEqual(empty);
    expect(shipmentProgressOf(input())).toEqual(empty);
  });
  it('분할: A shipped·B preparing → {2,1,0}', () => {
    expect(shipmentProgressOf(input({ activeShipmentStatuses: ['shipped', 'planned'] }))).toEqual({
      total: 2,
      shipped: 1,
      delivered: 0,
    });
  });
  it('분할: A delivered·B shipped → {2,2,1}', () => {
    expect(shipmentProgressOf(input({ activeShipmentStatuses: ['delivered', 'shipped'] }))).toEqual({
      total: 2,
      shipped: 2,
      delivered: 1,
    });
  });
  it('전량 배송완료 → {2,2,2}', () => {
    expect(shipmentProgressOf(input({ activeShipmentStatuses: ['delivered', 'delivered'] }))).toEqual({
      total: 2,
      shipped: 2,
      delivered: 2,
    });
  });
  it('혼합: 창고 draft + 입점사 상자 forwarded → {2,1,0}', () => {
    expect(
      shipmentProgressOf(input({ activeShipmentStatuses: ['draft'], supplierShipmentStages: ['forwarded'] })),
    ).toEqual({ total: 2, shipped: 1, delivered: 0 });
  });
  it('입점사 상자 pending·forwarded·shipped + 창고 delivered → {4,3,2} — 발송된 입점사 상자는 «배송 완료»로 센다(스펙 §4.6)', () => {
    expect(
      shipmentProgressOf(
        input({ activeShipmentStatuses: ['delivered'], supplierShipmentStages: ['pending', 'forwarded', 'shipped'] }),
      ),
    ).toEqual({ total: 4, shipped: 3, delivered: 2 });
  });
  it('FO 가 전부 취소되면 입점사 상자도 세지 않는다', () => {
    expect(shipmentProgressOf(input({ allFoCanceled: true, supplierShipmentStages: ['shipped'] }))).toEqual(empty);
  });
  it('인쇄만: 전량 delivered → {2,2,2}', () => {
    expect(shipmentProgressOf(input({ foCount: 0, printStatuses: ['delivered', 'delivered'] }))).toEqual({
      total: 2,
      shipped: 2,
      delivered: 2,
    });
  });
  it('인쇄 + 창고: 창고 delivered·인쇄 submitted → {2,1,1}', () => {
    expect(shipmentProgressOf(input({ activeShipmentStatuses: ['delivered'], printStatuses: ['submitted'] }))).toEqual({
      total: 2,
      shipped: 1,
      delivered: 1,
    });
  });
  it('인쇄 + 창고: 창고에 상자가 아직 없으면 인쇄 몫만 센다 → {1,1,1}', () => {
    expect(shipmentProgressOf(input({ printStatuses: ['delivered'] }))).toEqual({ total: 1, shipped: 1, delivered: 1 });
  });
  it('인쇄 + 디지털(FO 없음): 인쇄 submitted → {1,0,0}', () => {
    expect(shipmentProgressOf(input({ foCount: 0, printStatuses: ['submitted'] }))).toEqual({
      total: 1,
      shipped: 0,
      delivered: 0,
    });
  });
  it('FO 가 전부 취소되면 창고 상자는 세지 않고 인쇄 몫만 센다', () => {
    expect(
      shipmentProgressOf(
        input({ allFoCanceled: true, activeShipmentStatuses: ['shipped'], printStatuses: ['delivered'] }),
      ),
    ).toEqual({ total: 1, shipped: 1, delivered: 1 });
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
