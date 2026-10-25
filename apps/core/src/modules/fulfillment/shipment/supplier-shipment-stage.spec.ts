import { supplierShipmentStage } from './supplier-shipment-stage';

describe('supplierShipmentStage — 입점사 상자 단계 한 벌 (K3 PR4, N6)', () => {
  const box = (status: Parameters<typeof supplierShipmentStage>[0]['status'], supplierHandoffId: string | null) => ({
    id: 'sh-1',
    status,
    supplierHandoffId,
  });

  it('draft, 넘김 없음 → pending', () => {
    expect(supplierShipmentStage(box('draft', null))).toBe('pending');
  });
  it('draft, 넘김 있음 → forwarded', () => {
    expect(supplierShipmentStage(box('draft', 'ho-1'))).toBe('forwarded');
  });
  it('recovery_required(되돌리는 중), 넘김 있음 → forwarded', () => {
    expect(supplierShipmentStage(box('recovery_required', 'ho-1'))).toBe('forwarded');
  });
  it('shipped → shipped', () => {
    expect(supplierShipmentStage(box('shipped', 'ho-1'))).toBe('shipped');
  });
  it('canceled·superseded 는 단계가 없다', () => {
    expect(supplierShipmentStage(box('canceled', null))).toBeNull();
    expect(supplierShipmentStage(box('superseded', 'ho-1'))).toBeNull();
  });
  it('입점사 상자가 쓰지 않는 상태는 상자 id 를 담아 던진다', () => {
    expect(() => supplierShipmentStage(box('planned', null))).toThrow('sh-1');
    for (const status of ['in_transit', 'delivered', 'failed'] as const) {
      expect(() => supplierShipmentStage(box(status, 'ho-1'))).toThrow('sh-1');
    }
  });
  it('넘기지 않은 복구 상자는 생길 수 없다 — 발송 전엔 넘김이 있다', () => {
    expect(() => supplierShipmentStage(box('recovery_required', null))).toThrow('sh-1');
  });
});
