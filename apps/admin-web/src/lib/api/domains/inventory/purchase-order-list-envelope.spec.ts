import type { PurchaseOrderDto } from '../../../types/dto/inventory';
import { normalizePurchaseOrderList } from './purchase-order-list-envelope';

function po(id: string): PurchaseOrderDto {
  return {
    id,
    type: 'domestic',
    supplierId: 'sup-1',
    expectedArrival: null,
    status: 'created',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lines: [],
  };
}

describe('normalizePurchaseOrderList', () => {
  it('core 가 주는 bare array 를 목록 형태로 감싼다', () => {
    // GET /purchase-orders 는 Promise<PurchaseOrderResponse[]> 다 — envelope 이 없다.
    // 감싸지 않으면 테이블의 data?.data 가 undefined 라 목록이 항상 비어 보인다.
    expect(normalizePurchaseOrderList([po('a'), po('b')])).toEqual({
      data: [po('a'), po('b')],
      total: 2,
    });
  });

  it('이미 envelope 형태면 그대로 쓴다', () => {
    // core 가 나중에 { data, total } 로 바뀌어도 클라이언트가 깨지지 않게 한다.
    expect(normalizePurchaseOrderList({ data: [po('a')], total: 57 })).toEqual({
      data: [po('a')],
      total: 57,
    });
  });

  it('빈 응답을 빈 목록으로 다룬다', () => {
    expect(normalizePurchaseOrderList(null)).toEqual({ data: [], total: 0 });
    expect(normalizePurchaseOrderList(undefined)).toEqual({ data: [], total: 0 });
    expect(normalizePurchaseOrderList([])).toEqual({ data: [], total: 0 });
  });
});
