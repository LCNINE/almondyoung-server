import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #1247 — 판매주문 줄 상태(예약·출고·전달·출고 전 취소)가 바뀌는 트랜잭션은 그 주문에 «더러움» 표시를 한다.
 * 표시 지점은 둘이다: 예약·출고·입점사·FO 수량 변화가 전부 지나는 `reprojectFulfillmentOrders` 와
 * 취소 기록의 단 하나의 문 `recordSalesOrderCancellation`. 표시가 빠지면 폴러가 그 변화를 영영 내보내지 않고
 * Medusa 예약이 어긋난 채로 남는다 — 그래서 두 함수 본문이 `markLineStateDirty` 를 부르는지 소스로 지킨다.
 */
const ROOT = join(__dirname, '../../../../../..');

function functionBody(path: string, name: string): string {
  const source = readFileSync(join(ROOT, path), 'utf8');
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`${path} 에 ${name} 이 없다`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end < 0 ? undefined : end);
}

describe('줄 상태 더러움 표시 지점 (#1247)', () => {
  it.each([
    [
      'apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts',
      'reprojectFulfillmentOrders',
    ],
    ['apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts', 'recordSalesOrderCancellation'],
  ])('%s 의 %s 본문이 markLineStateDirty(ForFulfillmentOrders) 를 부른다', (path, name) => {
    expect(functionBody(path, name)).toMatch(/\bmarkLineStateDirty(ForFulfillmentOrders)?\(\s*(tx|trx)\b/);
  });
});
