import { CUSTOMER_RETURN_REASONS } from '@packages/event-contracts/streams';
import {
  customerReturnArrivals,
  customerReturnItems,
  customerReturnLines,
  customerReturnReasonEnum,
  customerReturns,
  customerReturnStatusEnum,
} from '../../inventory/schema/inventory.schema';

describe('customer_returns 스키마 enum', () => {
  it('반품 사유 enum 은 이벤트 계약의 CUSTOMER_RETURN_REASONS 와 같다', () => {
    expect([...customerReturnReasonEnum.enumValues]).toEqual([...CUSTOMER_RETURN_REASONS]);
  });

  it('반품 상태 enum 은 N3 의 일곱 값을 같은 순서로 가진다', () => {
    expect([...customerReturnStatusEnum.enumValues]).toEqual([
      'expected',
      'arrived',
      'inspected',
      'held',
      'refund_pending',
      'settled',
      'cancelled',
    ]);
  });
});

describe('customer_return_items / customer_return_arrivals 스키마', () => {
  it('항목 테이블은 검수 결과 세 칸을 가지고 도착 테이블 멱등 키는 unique 다', () => {
    expect(Object.keys(customerReturnItems)).toEqual(
      expect.arrayContaining([
        'customerReturnLineId',
        'skuId',
        'qtyPerUnit',
        'expectedQty',
        'acceptedQty',
        'rejectedQty',
        'heldQty',
      ]),
    );
    expect(customerReturnArrivals.idempotencyKey.isUnique).toBe(true);
  });
});

describe('K8 PR6b — CS 문 칸', () => {
  it('반품 기록은 선환불·CS 결정 칸을, 줄은 미도착 수량 칸을 가진다', () => {
    expect(Object.keys(customerReturns)).toEqual(expect.arrayContaining(['prepayment', 'csResolution']));
    expect(Object.keys(customerReturnLines)).toContain('missingQty');
    expect(customerReturnLines.missingQty.notNull).toBe(true);
  });
});
