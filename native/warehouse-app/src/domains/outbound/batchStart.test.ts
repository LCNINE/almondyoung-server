import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/data/httpClient';
import { groupStartBlockers, startBlockersOf, type StartBlocker } from './batchStart';

const blocker = (over: Partial<StartBlocker>): StartBlocker => ({
  shipmentId: 's1', reason: 'STOCK_SHORT', shipmentLineId: 'l1', skuId: 'k1', requiredQty: 3, shortQty: 1,
  detail: null, trackingNo: '452716978431', skuCode: 'SKU-1', skuName: '볼펜', ...over,
});

describe('startBlockersOf', () => {
  it('BATCH_START_BLOCKED 409 의 errors 를 꺼낸다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [blocker({})]))).toEqual([blocker({})]);
  });
  it.each([
    ['다른 코드', new ConflictError('m', 'CONFLICT', undefined, [blocker({})])],
    ['errors 가 배열이 아님', new ConflictError('m', 'BATCH_START_BLOCKED', undefined, { x: 1 })],
    ['일반 오류', new Error('x')],
  ])('%s → null', (_label, error) => expect(startBlockersOf(error)).toBeNull());
  it('모양이 깨진 항목은 버린다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [{ reason: 'STOCK_SHORT' }, blocker({})]))).toEqual([blocker({})]);
  });
});

describe('groupStartBlockers', () => {
  it('사유별로 묶고 적치 대기 → 재고 부족 → 송장 순, 줄 문구에 송장 번호·상품·수량', () => {
    const groups = groupStartBlockers([
      blocker({ reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' }),
      blocker({ reason: 'STOCK_SHORT' }),
      blocker({ reason: 'INBOUND_PENDING', shortQty: 2 }),
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY']);
    expect(groups[1].rows).toEqual(['4527-1697-8431 · 볼펜 3개 중 1개 부족']);
    expect(groups[2].rows).toEqual(['4527-1697-8431 · 송장 재발급 필요']);
  });
});
