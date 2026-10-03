import { describe, expect, it } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import { WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';
import {
  NOT_IN_TODAY_MESSAGE,
  PRINT_ELSEWHERE_MESSAGE,
  classifyInspectScan,
  formatTrackingNo,
  inspectionGateOf,
  inspectionRows,
  inspectionTotals,
  isNotFound,
  progressOf,
  remainingOf,
  scannedLineOf,
} from './inspection';
import type { ShipmentByWaybill, ShipmentByWaybillLine } from './types';

const found = (patch: Partial<ShipmentByWaybill> = {}): ShipmentByWaybill => ({
  warehouseId: 'w-1',
  shipmentId: 's-1',
  trackingNo: '421033881907',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '김*영',
  lines: [],
  labelState: 'current',
  labelChanges: [],
  labelIssue: null,
  removals: [],
  exitTo: null,
  ...patch,
});
const ctx = { warehouseId: 'w-1', canPrint: true };

describe('inspectionGateOf — 송장 스캔 결과 → 화면(스펙 §6.2)', () => {
  it.each([
    ['current', { kind: 'inspect' }],
    ['external', { kind: 'inspect' }],
    ['withdrawing', { kind: 'withdraw' }],
    ['not_started', { kind: 'reject', message: '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.' }],
    ['unavailable', { kind: 'reject', message: '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.' }],
  ] as const)('%s → %o', (labelState, gate) => {
    expect(inspectionGateOf(found({ labelState }), ctx)).toEqual(gate);
  });

  it('송장이 바뀌었거나 아직 안 찍었으면 새 송장 출력 — 바뀐 줄을 함께', () => {
    const changes = [{ locationCode: 'B-11-1', skuId: 'k', name: '집게핀', printedQty: 3, currentQty: 2 }];
    expect(inspectionGateOf(found({ labelState: 'reprint_required', labelChanges: changes }), ctx)).toEqual({ kind: 'reprint', changes });
    expect(inspectionGateOf(found({ labelState: 'never_printed' }), ctx)).toEqual({ kind: 'reprint', changes: [] });
  });

  it('프린터가 없으면 새 송장 대신 «프린터 있는 자리»', () => {
    expect(inspectionGateOf(found({ labelState: 'reprint_required' }), { ...ctx, canPrint: false })).toEqual({
      kind: 'reject',
      message: PRINT_ELSEWHERE_MESSAGE,
    });
  });

  it('빠진 박스는 작업 항목이 없어도 «빠진 박스» 다 — 오늘 배치에 없다고 하지 않는다', () => {
    expect(inspectionGateOf(found({ labelState: 'withdrawn', workItemId: null }), ctx)).toEqual({ kind: 'withdrawn' });
  });

  it.each([
    ['다른 창고', { warehouseId: 'w-2' }, '송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.'],
    ['이미 출고', { shipmentStatus: 'shipped' }, '이미 출고된 송장이에요'],
    ['오늘 배치에 없음', { workItemId: null, labelState: null }, NOT_IN_TODAY_MESSAGE],
    ['무효 송장', { labelState: 'unavailable', labelIssue: 'WAYBILL_STALE' }, WAYBILL_STALE_MESSAGE],
  ] as const)('거절: %s', (_name, patch, message) => {
    expect(inspectionGateOf(found(patch), ctx)).toEqual({ kind: 'reject', message });
  });
});

describe('classifyInspectScan — 검수 중 스캔이 송장인가 상품인가', () => {
  it.each([
    ['421033881907', 'same-waybill'],
    ['421033881915', 'maybe-waybill'],
    ['8801234567890', 'product'],
    ['8801002', 'product'],
    ['B-05-03', 'product'],
  ] as const)('%s → %s', (code, kind) => {
    expect(classifyInspectScan(code, '421033881907')).toBe(kind);
  });

  it('하이픈 없이 찍힌 같은 송장도 같은 송장이다', () => {
    expect(classifyInspectScan('421033881907', '4210-3388-1907')).toBe('same-waybill');
  });

  it('송장번호가 짧으면(10자리 미만) 숫자 상품을 송장으로 의심하지 않는다', () => {
    expect(classifyInspectScan('12345678', 'T-1')).toBe('product');
  });
});

describe('isNotFound', () => {
  it('404 만 참이다', () => {
    expect(isNotFound(new ApiError('GET /x → 404', 404, 'NOT_FOUND'))).toBe(true);
    expect(isNotFound(new ConflictError('x', 'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH'))).toBe(false);
    expect(isNotFound(new Error('offline'))).toBe(false);
  });
});

const line = (patch: Partial<ShipmentByWaybillLine> & Pick<ShipmentByWaybillLine, 'shipmentLineId'>): ShipmentByWaybillLine => ({
  skuId: `sku-${patch.shipmentLineId}`,
  skuCode: 'C',
  skuName: `상품 ${patch.shipmentLineId}`,
  qty: 1,
  pickedQty: 0,
  inspectedQty: 0,
  ...patch,
});

describe('품목 표', () => {
  const lines = [
    line({ shipmentLineId: 'c', qty: 2, allocations: [{ sourceLocationId: 'lc', locationCode: 'C-02-4', qty: 2 }] }),
    line({ shipmentLineId: 'a', qty: 1, allocations: [{ sourceLocationId: 'la', locationCode: 'A-03-2', qty: 1 }] }),
    line({ shipmentLineId: 'x', qty: 1 }),
    line({
      shipmentLineId: 'b',
      qty: 3,
      allocations: [
        { sourceLocationId: 'lb1', locationCode: 'B-10', qty: 1 },
        { sourceLocationId: 'lb2', locationCode: 'B-11-1', qty: 2 },
      ],
    }),
  ];

  it('송장 순서(첫 위치의 코드 순)로, 위치 없는 줄(옛 core)은 뒤로', () => {
    const rows = inspectionRows(lines, progressOf({ lines }));
    expect(rows.map((r) => [r.shipmentLineId, r.locations])).toEqual([
      ['a', [{ code: 'A-03-2', qty: 1 }]],
      [
        'b',
        [
          { code: 'B-10', qty: 1 },
          { code: 'B-11-1', qty: 2 },
        ],
      ],
      ['c', [{ code: 'C-02-4', qty: 2 }]],
      ['x', []],
    ]);
  });

  it('스캔·완료는 진행에서, 합계는 주문을 넘지 않는다', () => {
    const progress = progressOf({ lines }).map((p) => (p.shipmentLineId === 'a' ? { ...p, pickedQty: 1 } : p));
    const rows = inspectionRows(lines, progress);
    expect(rows.find((r) => r.shipmentLineId === 'a')).toMatchObject({ scanned: 1, done: true });
    expect(inspectionTotals(rows)).toEqual({ scanned: 1, ordered: 7 });
  });

  it('진행 시작값은 pickedQty 와 inspectedQty 중 큰 쪽(내려놨다 다시 연 박스)', () => {
    expect(progressOf({ lines: [line({ shipmentLineId: 'a', qty: 2, pickedQty: 0, inspectedQty: 2 })] })[0].pickedQty).toBe(2);
  });

  it('scannedLineOf 는 오른 줄, remainingOf 는 «주문 − 스캔»', () => {
    const before = progressOf({ lines });
    const after = before.map((p) => (p.shipmentLineId === 'b' ? { ...p, pickedQty: 1 } : p));
    expect(scannedLineOf(before, after)).toBe('b');
    expect(scannedLineOf(after, after)).toBeNull();
    expect(remainingOf(after, 'b')).toBe(2);
    expect(remainingOf(after, 'none')).toBe(0);
  });

  it('12자리 송장번호는 4-4-4 로 끊어 보인다', () => {
    expect(formatTrackingNo('421033881907')).toBe('4210-3388-1907');
    expect(formatTrackingNo('T-1')).toBe('T-1');
  });
});
