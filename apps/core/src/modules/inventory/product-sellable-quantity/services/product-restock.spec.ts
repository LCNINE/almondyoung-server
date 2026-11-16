import { resolveRestockSchedule, restockToday } from './product-restock';

const today = '2026-10-14';
const domestic = { expectedArrival: '2026-10-17', approximate: false, source: 'purchase_order' as const };
const foreign = { expectedArrival: '2026-10-20', approximate: true, source: 'purchase_order' as const };

const empty = { inboundDate: null, inboundApproximate: false, inboundSource: null };

describe('재입고 예정일 원천 선택', () => {
  it('유효한 수동 날짜가 발주 날짜보다 우선한다', () => {
    expect(
      resolveRestockSchedule({ restockDate: '2026-10-22', restockApproximate: true }, [domestic], 0, today),
    ).toEqual({ inboundDate: '2026-10-22', inboundApproximate: true, inboundSource: 'manual' });
  });

  it('수동 날짜를 지우면 유효한 발주 중 가장 이른 날짜로 돌아간다', () => {
    expect(resolveRestockSchedule({ restockDate: null }, [foreign, domestic], 0, today)).toEqual({
      inboundDate: domestic.expectedArrival,
      inboundApproximate: false,
      inboundSource: 'purchase_order',
    });
  });

  it('지난 수동/발주 날짜가 미래 발주를 가리지 않는다', () => {
    expect(
      resolveRestockSchedule(
        { restockDate: '2026-10-10' },
        [{ expectedArrival: '2026-09-01', approximate: true, source: 'purchase_order' as const }, domestic],
        0,
        today,
      ),
    ).toEqual({ inboundDate: domestic.expectedArrival, inboundApproximate: false, inboundSource: 'purchase_order' });
  });

  it('가장 이른 날짜의 해외 발주만 대략적인 일정으로 표시한다', () => {
    expect(resolveRestockSchedule(undefined, [foreign, { ...foreign, approximate: false }], 0, today)).toEqual({
      inboundDate: foreign.expectedArrival,
      inboundApproximate: true,
      inboundSource: 'purchase_order',
    });
  });

  it('오늘 날짜도 포함한다', () => {
    expect(resolveRestockSchedule({ restockDate: today }, [], 0, today).inboundDate).toBe(today);
  });

  it('실재고가 있거나 유효한 일정이 없으면 표시를 비운다', () => {
    expect(resolveRestockSchedule({ restockDate: today }, [foreign], 1, today)).toEqual(empty);
    expect(resolveRestockSchedule(undefined, [], 0, today)).toEqual(empty);
    expect(resolveRestockSchedule({ restockDate: '2026-10-13' }, [], 0, today)).toEqual(empty);
  });

  describe('선적 후보', () => {
    const t = '2026-11-20';
    const shipment = (expectedArrival: string) => ({
      expectedArrival,
      approximate: true,
      source: 'inbound_shipment' as const,
    });
    const po = (expectedArrival: string, approximate: boolean) => ({
      expectedArrival,
      approximate,
      source: 'purchase_order' as const,
    });

    it('uses shipment date when it is the only arrival', () => {
      expect(resolveRestockSchedule(undefined, [shipment('2026-12-01')], 0, t)).toEqual({
        inboundDate: '2026-12-01',
        inboundApproximate: true,
        inboundSource: 'inbound_shipment',
      });
    });

    it('earlier purchase order beats later shipment', () => {
      expect(resolveRestockSchedule(undefined, [shipment('2026-12-01'), po('2026-11-25', false)], 0, t)).toEqual({
        inboundDate: '2026-11-25',
        inboundApproximate: false,
        inboundSource: 'purchase_order',
      });
    });

    it('earlier shipment beats later purchase order', () => {
      expect(resolveRestockSchedule(undefined, [po('2026-12-05', false), shipment('2026-12-01')], 0, t)).toEqual({
        inboundDate: '2026-12-01',
        inboundApproximate: true,
        inboundSource: 'inbound_shipment',
      });
    });

    it('same day: approximate if any, source purchase_order first', () => {
      expect(resolveRestockSchedule(undefined, [shipment('2026-12-01'), po('2026-12-01', false)], 0, t)).toEqual({
        inboundDate: '2026-12-01',
        inboundApproximate: true,
        inboundSource: 'purchase_order',
      });
    });

    it('past shipment date is ignored', () => {
      expect(resolveRestockSchedule(undefined, [shipment('2026-12-01')], 0, '2026-12-02')).toEqual(empty);
    });

    it('manual restock date still wins over shipment', () => {
      expect(resolveRestockSchedule({ restockDate: '2026-12-10' }, [shipment('2026-12-01')], 0, t).inboundSource).toBe(
        'manual',
      );
    });
  });

  it('UTC 날짜가 바뀌기 전에도 한국 날짜로 지난 일정을 판정한다', () => {
    expect(restockToday(new Date('2026-10-13T16:00:00Z'))).toBe(today);
  });
});
