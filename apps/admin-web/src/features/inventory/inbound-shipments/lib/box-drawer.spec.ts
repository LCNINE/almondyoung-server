import { boxView } from './fixtures.spec-helper';
import { boxDrawerRows } from './box-drawer';

const single = {
  lineId: 'l1',
  kind: 'sku' as const,
  skuId: 's1',
  sku: { code: 'C1', name: '샘플 A' },
  productName: '샘플 A 원문',
  option: '빨강',
  expectedQty: 30,
  coversBoxLabels: ['L5'],
  alreadyCountedInOtherBoxes: 0,
  remark: '',
};
const range = {
  ...single,
  lineId: 'l2',
  sku: null,
  skuId: null,
  kind: 'unresolved' as const,
  productName: '샘플 B 원문',
  expectedQty: 1076,
  option: '',
  coversBoxLabels: ['L5', 'L6', 'L7', 'L8', 'L9'],
};

describe('boxDrawerRows', () => {
  it('범위 줄 예정 수량이 null 이면 합계 —', () => {
    const r = boxDrawerRows(boxView({ lines: [{ ...range, expectedQty: null }] }));
    expect(r.lines[0].expected).toBe('L5~L9 합계 —');
  });

  it('서울 시각으로 자정을 넘긴다', () => {
    const r = boxDrawerRows(
      boxView({ status: 'received', receivedAt: '2026-11-16T15:30:00.000Z' })
    );
    expect(r.header.receivedAt).toBe('2026-11-17 00:30');
  });

  it('확정된 상자: 줄별 센 수량·방법, 범위 줄 예정 문구, 리스트에 없던 물건', () => {
    const r = boxDrawerRows(
      boxView({
        status: 'received',
        receivedAt: '2026-11-16T01:00:00.000Z',
        lines: [single, range],
        counts: [
          { id: 'c1', lineId: 'l1', skuId: 's1', skuCode: 'C1', skuName: '샘플 A', countedQty: 30, method: 'list' },
          { id: 'c2', lineId: 'l2', skuId: null, skuCode: null, skuName: null, countedQty: 0, method: 'counted' },
          { id: 'c3', lineId: null, skuId: 's9', skuCode: 'C9', skuName: '덤 물건', countedQty: 3, method: 'counted' },
        ],
      })
    );
    expect(r.header).toEqual({ title: '11월 2차 배편 · 상자 L5', shipmentName: '11월 2차 배편', state: 'received', receivedAt: '2026-11-16 10:00' });
    expect(r.lines[0]).toMatchObject({ lineId: 'l1', product: '샘플 A 원문 빨강', sku: 'C1 샘플 A', expected: '30', counted: 30, method: 'list' });
    expect(r.lines[1]).toMatchObject({ product: '샘플 B 원문', sku: null, expected: 'L5~L9 합계 1,076', counted: 0, method: 'counted' });
    expect(r.unplanned).toEqual([{ skuCode: 'C9', skuName: '덤 물건', counted: 3 }]);
    expect(r.forwardNote).toBeNull();
  });

  it('열린 상자: counted·method 는 null', () => {
    const r = boxDrawerRows(boxView({ lines: [single] }));
    expect(r.header.state).toBe('open');
    expect(r.lines[0].counted).toBeNull();
    expect(r.lines[0].method).toBeNull();
    expect(r.unplanned).toEqual([]);
  });

  it('전달용: 비고만', () => {
    const r = boxDrawerRows(
      boxView({ disposition: 'forward', forwardNote: '업체로 발송', lines: [single] })
    );
    expect(r.header.state).toBe('forward');
    expect(r.lines).toEqual([]);
    expect(r.unplanned).toEqual([]);
    expect(r.forwardNote).toBe('업체로 발송');
  });
});
