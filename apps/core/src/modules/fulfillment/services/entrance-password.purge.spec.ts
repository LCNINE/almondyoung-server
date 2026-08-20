import { purgeTargetSalesOrderIds } from './entrance-password.purge';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('purgeTargetSalesOrderIds', () => {
  it('상자가 이행하는 주문을 중복 없이 모은다', () => {
    // 한 주문의 여러 라인이 한 상자에 담기면 조인 결과에 같은 주문이 여러 번 나온다.
    expect(purgeTargetSalesOrderIds([{ salesOrderId: B }, { salesOrderId: B }, { salesOrderId: A }])).toEqual([A, B]);
  });

  it('합배송으로 여러 주문이 한 상자가 되면 전부 대상이다', () => {
    expect(purgeTargetSalesOrderIds([{ salesOrderId: C }, { salesOrderId: A }, { salesOrderId: B }])).toEqual([
      A,
      B,
      C,
    ]);
  });

  it('판매주문 없이 만들어진 출고주문(salesOrderId null)은 대상에서 뺀다', () => {
    expect(purgeTargetSalesOrderIds([{ salesOrderId: null }, { salesOrderId: A }, { salesOrderId: null }])).toEqual([
      A,
    ]);
  });

  it('라인이 없거나 전부 null 이면 빈 목록이다 — 호출자가 UPDATE 자체를 건너뛸 수 있어야 한다', () => {
    expect(purgeTargetSalesOrderIds([])).toEqual([]);
    expect(purgeTargetSalesOrderIds([{ salesOrderId: null }])).toEqual([]);
  });

  it('입력 순서와 무관하게 항상 같은 순서를 돌려준다 — 동시 배송완료의 잠금 순서를 고정한다', () => {
    expect(purgeTargetSalesOrderIds([{ salesOrderId: C }, { salesOrderId: A }])).toEqual(
      purgeTargetSalesOrderIds([{ salesOrderId: A }, { salesOrderId: C }]),
    );
  });
});
