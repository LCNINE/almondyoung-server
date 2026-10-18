import { badgeKindOf, toShipmentPhase, shipmentPhaseLabel, type ShipmentPhase } from './shipment-phase.shape';

describe('shipment-phase shape', () => {
  const PHASES: ShipmentPhase[] = [
    'pending',
    'preparing',
    'shipping',
    'delivered',
    'external_shipped',
    'cancelled',
  ];

  it.each(PHASES)('toShipmentPhase: 서버가 주는 값 %s 는 그대로 통과한다', (phase) => {
    expect(toShipmentPhase(phase)).toBe(phase);
  });

  it.each([undefined, null, '', 'stock_deducted', 'READY', 3, {}, []])(
    'toShipmentPhase: 모르는 값·옛 응답(%p)은 null',
    (v) => {
      expect(toShipmentPhase(v)).toBeNull();
    },
  );

  it('shipmentPhaseLabel: 단계마다 운영자 문구', () => {
    expect(shipmentPhaseLabel('pending')).toBe('결제대기');
    expect(shipmentPhaseLabel('preparing')).toBe('준비중');
    expect(shipmentPhaseLabel('shipping')).toBe('배송중');
    expect(shipmentPhaseLabel('delivered')).toBe('배송완료');
    expect(shipmentPhaseLabel('external_shipped')).toBe('외부 출고');
    expect(shipmentPhaseLabel('cancelled')).toBe('취소');
  });

  it('shipmentPhaseLabel: null 은 빈 문자열(옛 응답에선 배지를 그리지 않는다)', () => {
    expect(shipmentPhaseLabel(null)).toBe('');
  });

  it('badgeKindOf: 나간 주문은 미매칭이어도 단계를 보인다', () => {
    expect(badgeKindOf('external_shipped', false)).toBe('phase');
    expect(badgeKindOf('shipping', false)).toBe('phase');
    expect(badgeKindOf('delivered', false)).toBe('phase');
    expect(badgeKindOf('cancelled', false)).toBe('phase');
  });

  it('badgeKindOf: 안 나간 주문의 미매칭은 «매칭 대기» 가 먼저', () => {
    expect(badgeKindOf('pending', false)).toBe('unmatched');
    expect(badgeKindOf('preparing', false)).toBe('unmatched');
    expect(badgeKindOf(null, false)).toBe('unmatched');
  });

  it('badgeKindOf: 매칭됐으면 단계, 단계를 모르면 배지 없음', () => {
    expect(badgeKindOf('preparing', true)).toBe('phase');
    expect(badgeKindOf('pending', true)).toBe('phase');
    expect(badgeKindOf(null, true)).toBe('none');
  });
});
