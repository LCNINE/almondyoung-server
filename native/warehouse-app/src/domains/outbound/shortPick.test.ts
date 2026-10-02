import { describe, expect, it, vi } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import {
  SHORT_PICK_STALE_MESSAGE,
  SHORT_PICK_UNAVAILABLE_MESSAGE,
  buildShortPickRequest,
  reportShortPick,
  shortPickDraft,
  shortPickErrorMessage,
  shortPickSources,
} from './shortPick';
import type { ShipmentByWaybill, ShipmentByWaybillLine } from './types';

const A = { sourceLocationId: 'la', locationCode: 'A-01', qty: 2 };
const B = { sourceLocationId: 'lb', locationCode: 'B-01', qty: 3 };

describe('shortPickSources — 송장 순서 귀속을 재구성해 마지막 위치부터(U11, 10-02 결정)', () => {
  it.each([
    ['위치 하나', [{ ...A, qty: 3 }], 1, 2, [{ sourceLocationId: 'la', shortQty: 2 }]],
    ['마지막 위치 몫 이하 — U11 그대로', [A, B], 0, 3, [{ sourceLocationId: 'lb', shortQty: 3 }]],
    ['넘치면 앞 위치로', [A, B], 1, 4, [{ sourceLocationId: 'la', shortQty: 1 }, { sourceLocationId: 'lb', shortQty: 3 }]],
    ['앞 위치를 다 집었으면 뒤에서만', [A, B], 3, 2, [{ sourceLocationId: 'lb', shortQty: 2 }]],
  ] as const)('%s', (_name, allocations, picked, short, expected) => {
    expect(shortPickSources(allocations, picked, short)).toEqual(expected);
  });

  it('안 집은 몫보다 많거나, 0 이거나, 배정이 없으면 null', () => {
    expect(shortPickSources([A, B], 1, 5)).toBeNull();
    expect(shortPickSources([A], 0, 0)).toBeNull();
    expect(shortPickSources([], 0, 1)).toBeNull();
  });
});

const line = (patch: Partial<ShipmentByWaybillLine>): ShipmentByWaybillLine => ({
  shipmentLineId: 'l-1',
  skuId: 'sku-1',
  skuCode: 'C',
  skuName: '퍼머넌트 1제',
  qty: 5,
  pickedQty: 1,
  inspectedQty: 0,
  lineVersion: 7,
  allocations: [A, B],
  ...patch,
});
const fresh = (patch: Partial<ShipmentByWaybill> = {}): ShipmentByWaybill => ({
  warehouseId: 'w-1',
  shipmentId: 's-1',
  trackingNo: '421033881907',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'picking',
  recipientMasked: '김*영',
  lines: [line({}), line({ shipmentLineId: 'l-2', qty: 1, pickedQty: 1, allocations: [A] })],
  labelState: 'current',
  labelChanges: [],
  labelIssue: null,
  removals: [],
  exitTo: null,
  deliveryNote: null,
  shortPickContext: { workItemLeaseVersion: 3, sessionId: 'ses-1', sessionVersion: 9, manifestVersion: 2 },
  ...patch,
});

describe('shortPickDraft', () => {
  it('덜 찍힌 줄만 «주문 − 스캔» 으로 미리 채운다(§7.1-1)', () => {
    const f = fresh();
    const progress = f.lines.map((l) => ({ shipmentLineId: l.shipmentLineId, skuId: l.skuId, qty: l.qty, pickedQty: l.pickedQty, inspectedQty: 0 }));
    expect(shortPickDraft(f.lines, progress)).toEqual([{ shipmentLineId: 'l-1', name: '퍼머넌트 1제', max: 4, qty: 4 }]);
  });
});

describe('buildShortPickRequest — 보내기 직전에 다시 조회한 박스로', () => {
  it('버전·위치를 채운 요청', () => {
    expect(buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 4 }], 'item_damaged')).toEqual({
      ok: true,
      request: {
        workItemId: 'wi-1',
        expectedWorkItemLeaseVersion: 3,
        sessionId: 'ses-1',
        expectedSessionVersion: 9,
        expectedManifestVersion: 2,
        lines: [
          { shipmentLineId: 'l-1', sourceLocationId: 'la', expectedLineVersion: 7, shortQty: 1 },
          { shipmentLineId: 'l-1', sourceLocationId: 'lb', expectedLineVersion: 7, shortQty: 3 },
        ],
        reason: 'item_damaged',
      },
    });
  });

  it.each([
    ['빼는 중', { workItemStatus: 'withdrawing' }],
    ['다른 오퍼레이션 대기', { workItemStatus: 'short_pick_recovery' }],
    ['버전 없음(세션 없음)', { shortPickContext: null }],
    ['작업 항목 없음', { workItemId: null }],
  ] as const)('보고할 수 없는 상태: %s', (_name, patch) => {
    expect(buildShortPickRequest(fresh(patch), [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_UNAVAILABLE_MESSAGE,
    });
  });

  it('창을 연 사이 더 찍혀 남은 수량이 줄었으면 보내지 않는다', () => {
    const moved = fresh({ lines: [line({ pickedQty: 3 })] });
    expect(buildShortPickRequest(moved, [{ shipmentLineId: 'l-1', qty: 4 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_STALE_MESSAGE,
    });
  });

  it('줄 버전·배정이 없는 옛 core 면 보내지 않는다', () => {
    const legacy = fresh({ lines: [line({ lineVersion: undefined, allocations: undefined })] });
    expect(buildShortPickRequest(legacy, [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: SHORT_PICK_STALE_MESSAGE,
    });
  });

  it('결품 수량이 모두 0 이면 보내지 않는다', () => {
    expect(buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 0 }], 'inventory_shortage')).toEqual({
      ok: false,
      message: '결품 수량이 없어요.',
    });
  });
});

describe('reportShortPick', () => {
  it('POST /shipments/:id/short-picks 에 멱등 키와 함께 보낸다', async () => {
    const request = vi.fn(async () => ({ outcome: 'exited', refills: [] }));
    const built = buildShortPickRequest(fresh(), [{ shipmentLineId: 'l-1', qty: 1 }], 'inventory_shortage');
    if (!built.ok) throw new Error('fixture');
    await reportShortPick({ request } as never, 's-1', built.request, 'key-1');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/shipments/s-1/short-picks', body: built.request, idempotencyKey: 'key-1' });
  });
});

describe('shortPickErrorMessage', () => {
  it.each([
    [new ConflictError('x', 'SHORT_PICK_EXCEEDS_UNPICKED'), SHORT_PICK_STALE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_LINE_STALE'), SHORT_PICK_STALE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_WORK_ITEM_WAITING'), SHORT_PICK_UNAVAILABLE_MESSAGE],
    [new ConflictError('x', 'SHORT_PICK_DISPATCH_EXISTS'), '이미 출고된 박스예요.'],
    [new ApiError('POST /shipments/s/short-picks → 403', 403, 'FORBIDDEN'), '결품 보고 권한이 없어요. 관리자에게 요청해 주세요.'],
  ])('%s', (error, message) => {
    expect(shortPickErrorMessage(error)).toBe(message);
  });
});
