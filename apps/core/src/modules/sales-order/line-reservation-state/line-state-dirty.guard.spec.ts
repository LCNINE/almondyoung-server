import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #1247 — 판매주문 줄 상태(예약·출고·전달·출고 전 취소)가 바뀌는 트랜잭션은 그 주문에 «더러움» 표시를 한다.
 * 표시 지점은 셋이다: 예약·출고·입점사·FO 수량 변화가 전부 지나는 `reprojectFulfillmentOrders`,
 * 취소 기록의 단 하나의 문 `recordSalesOrderCancellation`, 그리고 `reprojectFulfillmentOrders` 를 지나지 않고
 * 확정 예약 행을 푸는 `UnifiedReservationService.releaseReservation`(관리자 예약 해제 라우트가 부른다).
 * 표시가 빠지면 폴러가 그 변화를 영영 내보내지 않고 Medusa 예약이 어긋난 채로 남는다 — 그래서 본문이
 * `markLineStateDirty*` 를 부르는지 소스로 지킨다.
 */
const ROOT = join(__dirname, '../../../../../..');

function functionBody(path: string, name: string): string {
  const source = readFileSync(join(ROOT, path), 'utf8');
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`${path} 에 ${name} 이 없다`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end < 0 ? undefined : end);
}

/** 클래스 메서드 본문 — 두 칸 들여쓴 `async name(` 부터 같은 들여쓰기의 닫는 `}` 까지. */
function methodBody(path: string, name: string): string {
  const source = readFileSync(join(ROOT, path), 'utf8');
  const start = source.indexOf(`\n  async ${name}(`);
  if (start < 0) throw new Error(`${path} 에 ${name} 메서드가 없다`);
  const end = source.indexOf('\n  }\n', start);
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

  it('UnifiedReservationService.releaseReservation 본문이 상자 라인 예약을 풀 때 markLineStateDirtyForShipmentLines 를 부른다', () => {
    expect(
      methodBody(
        'apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts',
        'releaseReservation',
      ),
    ).toMatch(/\bmarkLineStateDirtyForShipmentLines\(\s*trx\s*,\s*\[\s*updated\.shipmentLineId\s*\]/);
  });
});
