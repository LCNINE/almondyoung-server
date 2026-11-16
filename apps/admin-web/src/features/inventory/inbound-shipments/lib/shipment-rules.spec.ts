import { box, line, shipment } from './fixtures.spec-helper';
import {
  boxDispositionEditable,
  confirmReadiness,
  defaultShipmentName,
  defaultWarehouseId,
  normalizeCloseReason,
  forwardBoxes,
  shipmentActions,
  skuLineCountInBox,
} from './shipment-rules';

describe('forwardBoxes', () => {
  it('전달용만 sortKey 순', () => {
    const s = shipment({
      boxes: [
        box({ id: 'b3', label: 'C', sortKey: 3, disposition: 'forward' }),
        box({ id: 'b2', label: 'B', sortKey: 2, disposition: 'stock' }),
        box({ id: 'b1', label: 'A', sortKey: 1, disposition: 'forward' }),
      ],
    });
    expect(forwardBoxes(s).map((b) => b.id)).toEqual(['b1', 'b3']);
  });
});

describe('skuLineCountInBox', () => {
  it('sku 줄 중 그 상자를 덮는 것만 센다', () => {
    const s = shipment({
      lines: [
        line({ id: 'l1', kind: 'sku', coversBoxLabels: ['A1', 'A2'] }),
        line({ id: 'l2', kind: 'free', coversBoxLabels: ['A1'] }),
        line({ id: 'l3', kind: 'unresolved', coversBoxLabels: ['A1'] }),
        line({ id: 'l4', kind: 'sku', coversBoxLabels: ['A2'] }),
      ],
    });
    expect(skuLineCountInBox(s, 'A1')).toBe(1);
    expect(skuLineCountInBox(s, 'A2')).toBe(2);
    expect(skuLineCountInBox(s, 'Z')).toBe(0);
  });
});

describe('confirmReadiness', () => {
  const boxes = [
    box({ id: 'b1', label: 'F1', sortKey: 1, disposition: 'forward' }),
    box({ id: 'b2', label: 'F2', sortKey: 2, disposition: 'forward' }),
    box({ id: 'b3', label: 'S1', sortKey: 3, disposition: 'stock' }),
  ];

  it('전달용 b2 가 미확인이면 막힌다', () => {
    const r = confirmReadiness(shipment({ status: 'draft', boxes }), new Set(['b1']));
    expect(r.enabled).toBe(false);
    expect(r.unacknowledgedForwardBoxIds).toEqual(['b2']);
    expect(r.acknowledgedForwardBoxIds).toEqual(['b1']);
  });

  it('둘 다 체크하면 활성', () => {
    const r = confirmReadiness(shipment({ status: 'draft', boxes }), new Set(['b1', 'b2']));
    expect(r).toEqual({
      enabled: true,
      unresolvedStockLines: 0,
      unacknowledgedForwardBoxIds: [],
      acknowledgedForwardBoxIds: ['b1', 'b2'],
    });
  });

  it('재고로 되돌린 상자의 남은 체크는 버린다', () => {
    const back = boxes.map((b) => (b.id === 'b2' ? { ...b, disposition: 'stock' as const } : b));
    const r = confirmReadiness(shipment({ status: 'draft', boxes: back }), new Set(['b1', 'b2']));
    expect(r.acknowledgedForwardBoxIds).toEqual(['b1']);
    expect(r.enabled).toBe(true);
  });

  it('재고 상자를 덮는 미확인 줄은 막는다', () => {
    const r = confirmReadiness(
      shipment({ status: 'draft', boxes, lines: [line({ kind: 'unresolved', coversBoxLabels: ['S1'] })] }),
      new Set(['b1', 'b2']),
    );
    expect(r.unresolvedStockLines).toBe(1);
    expect(r.enabled).toBe(false);
  });

  it('전달용 상자에만 얹힌 미확인 줄은 세지 않는다', () => {
    const r = confirmReadiness(
      shipment({ status: 'draft', boxes, lines: [line({ kind: 'unresolved', coversBoxLabels: ['F1'] })] }),
      new Set(['b1', 'b2']),
    );
    expect(r.unresolvedStockLines).toBe(0);
    expect(r.enabled).toBe(true);
  });

  it('전달용과 재고 상자를 같이 덮는 미확인 줄은 센다', () => {
    const r = confirmReadiness(
      shipment({ status: 'draft', boxes, lines: [line({ kind: 'unresolved', coversBoxLabels: ['F1', 'S1'] })] }),
      new Set(['b1', 'b2']),
    );
    expect(r.unresolvedStockLines).toBe(1);
  });

  it('초안이 아니면 비활성', () => {
    expect(confirmReadiness(shipment({ status: 'expected', boxes }), new Set(['b1', 'b2'])).enabled).toBe(false);
  });
});

describe('shipmentActions', () => {
  it('초안: 확정·취소', () =>
    expect(shipmentActions(shipment({ status: 'draft' }))).toEqual({
      confirm: true,
      cancel: true,
      close: false,
      reopen: false,
    }));
  it('expected 받은 상자 0 → 취소 가능', () =>
    expect(shipmentActions(shipment({ status: 'expected' }))).toEqual({
      confirm: false,
      cancel: true,
      close: true,
      reopen: false,
    }));
  it('expected 받은 상자 1 → 취소 불가', () => {
    const s = shipment({ status: 'expected' });
    s.summary.boxesReceived = 1;
    expect(shipmentActions(s).cancel).toBe(false);
  });
  it('receiving: 끝내기만', () =>
    expect(shipmentActions(shipment({ status: 'receiving' }))).toEqual({
      confirm: false,
      cancel: false,
      close: true,
      reopen: false,
    }));
  it('사람이 닫은 선적은 다시 열기', () =>
    expect(shipmentActions(shipment({ status: 'closed', closedReason: '안 옴' })).reopen).toBe(true));
  it('저절로 닫힌 선적은 다시 열기 불가', () =>
    expect(shipmentActions(shipment({ status: 'closed', closedReason: null })).reopen).toBe(false));
  it('취소된 선적은 전부 false', () =>
    expect(shipmentActions(shipment({ status: 'canceled' }))).toEqual({
      confirm: false,
      cancel: false,
      close: false,
      reopen: false,
    }));
});

describe('boxDispositionEditable', () => {
  it('열린 상자·진행 중 선적이면 가능', () => {
    expect(boxDispositionEditable(shipment({ status: 'draft' }), box())).toBe(true);
    expect(boxDispositionEditable(shipment({ status: 'receiving' }), box())).toBe(true);
  });
  it('받은 상자는 불가', () =>
    expect(boxDispositionEditable(shipment({ status: 'receiving' }), box({ status: 'received' }))).toBe(false));
  it('closed·canceled 는 불가', () => {
    expect(boxDispositionEditable(shipment({ status: 'closed' }), box())).toBe(false);
    expect(boxDispositionEditable(shipment({ status: 'canceled' }), box())).toBe(false);
  });
});

describe('defaultShipmentName', () => {
  it('마지막 확장자만 제거', () => expect(defaultShipmentName('입고.리스트.xlsx')).toBe('입고.리스트'));
  it('확장자 없으면 그대로', () => expect(defaultShipmentName('입고리스트')).toBe('입고리스트'));
  it('점으로 시작하는 이름은 그대로', () => expect(defaultShipmentName('.xlsx')).toBe('.xlsx'));
  it('255자로 자른다', () => expect(defaultShipmentName(`${'가'.repeat(300)}.xlsx`)).toHaveLength(255));
});

describe('defaultWarehouseId', () => {
  it('국내 하나 + 해외 하나 → 국내', () =>
    expect(
      defaultWarehouseId([
        { id: 'w1', type: 'domestic' },
        { id: 'w2', type: 'overseas' },
      ]),
    ).toBe('w1'));
  it('국내 둘 → null', () =>
    expect(
      defaultWarehouseId([
        { id: 'w1', type: 'domestic' },
        { id: 'w3', type: 'domestic' },
      ]),
    ).toBeNull());
  it('없으면 null', () => expect(defaultWarehouseId([])).toBeNull());
});

describe('normalizeCloseReason', () => {
  it('앞뒤 공백을 뺀다', () => expect(normalizeCloseReason('  파손  ')).toEqual({ ok: true, reason: '파손' }));
  it('빈 값·공백뿐이면 거절', () => {
    expect(normalizeCloseReason('')).toEqual({ ok: false });
    expect(normalizeCloseReason('   ')).toEqual({ ok: false });
  });
  it('500자까지 허용, 501자는 거절', () => {
    expect(normalizeCloseReason('가'.repeat(500)).ok).toBe(true);
    expect(normalizeCloseReason('가'.repeat(501)).ok).toBe(false);
  });
  it('공백을 뺀 뒤 길이로 센다', () => expect(normalizeCloseReason(` ${'가'.repeat(500)} `).ok).toBe(true));
});
