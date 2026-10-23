import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K7 PR1 — 판매주문 취소의 순서(판정·와우프레스·확정·기록)는 커널 `OrderCancellation` 하나가 소유한다.
 * 문(고객·운영자·채널·컨슈머)은 의도만 넘긴다. 취소 내부 단계를 부르는 파일을 허용 목록으로 못박아,
 * 새 호출자가 생기면(= 순서를 문이 다시 쥐면) 빨갛게 한다. 허용 목록은 줄어드는 방향으로만 바뀐다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

function walk(path: string): string[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) =>
      name === '__support__' || name === '__fixtures__' ? [] : walk(join(path, name)),
    );
  }
  return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
}

/** root 는 ROOT 기준 상대 경로 — 디렉터리 하나, 파일 하나, 또는 그 배열. */
function filesCalling(pattern: RegExp, roots?: string | string[]): string[] {
  const list = roots === undefined ? [SRC] : [roots].flat().map((r) => join(ROOT, r));
  return list
    .flatMap(walk)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

const K = 'apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts';
const STORE = 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts'; // N1 — PR4 가 지운다
const MANAGER = 'apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts'; // 확정 내부

describe('판매주문 취소 호출자 (K7)', () => {
  it('판매주문 취소 적용', () =>
    expect(filesCalling(/\b(salesOrders|salesOrdersService)\.cancel\(/)).toEqual([MANAGER, K, STORE].sort()));

  it('취소 계획', () => expect(filesCalling(/\.planCancellation\(/)).toEqual([MANAGER, K].sort()));

  it('채널 취소 요청 확정·사전검사', () =>
    expect(filesCalling(/cancelRequests\.(request|precheck)\(/)).toEqual([K, STORE].sort()));

  it('와우프레스 취소 문', () =>
    expect(filesCalling(/printCancellation\.(cancelForOrder|holdUnsent|noteSalesCancelFailed)\(/)).toEqual(
      [K, STORE].sort(),
    ));

  it('판매주문 코드의 print_orders 직접 UPDATE', () =>
    // 직접 형(.update(wmsTables.printOrders))과 별칭 형(const t = wmsTables.printOrders; … .update(t)) 둘 다.
    // «printOrders 를 언급하고 어딘가에서 update» 로 넓히면 sales-orders.service.ts 가 거짓 양성이다.
    expect(
      filesCalling(
        /\.update\((?:wmsTables|inventoryTables)\.printOrders\)|const (\w+) = (?:wmsTables|inventoryTables)\.printOrders;[\s\S]*?\.update\(\1\)/,
        'apps/core/src/modules/sales-order',
      ),
    ).toEqual([])); // D7 — 붙잡기는 와우프레스 모듈의 문(holdUnsentForCancel·holdUnsentForDecrease)

  it('판매주문 코드는 출고 테이블을 직접 쓰지 않는다 — K3 본편 둘만 예외', () =>
    // K7 PR3 — 상자 전 취소의 FO·FOI 쓰기는 출고 모듈 명령(`UnboxedDemandCancellation`)이 한다.
    // 남은 둘(배송지·공동현관 비번 파기)은 K3 본편이 옮긴다. drizzle 형과 raw SQL 형 둘 다 본다.
    expect(
      filesCalling(
        /\.(update|insert|delete)\((?:wmsTables|inventoryTables)\.(fulfillmentOrders|fulfillmentOrderItems|stockReservations|shipments|shipmentLines)\)|\b(update|insert\s+into|delete\s+from)\s+"?(fulfillment_orders|fulfillment_order_items|stock_reservations|shipments|shipment_lines)\b/i,
        'apps/core/src/modules/sales-order',
      ),
    ).toEqual([
      'apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts',
      'apps/core/src/modules/sales-order/services/entrance-password-cleaner.ts',
    ]));

  it('판매주문은 예약 서비스를 모른다', () =>
    // 상자 전 수요엔 예약이 없다(N13) — 예약은 상자 줄의 일이고 출고 모듈이 쥔다.
    expect(
      filesCalling(
        /ReservationLifecycleService|UnifiedReservationService|ShipmentReservationService/,
        'apps/core/src/modules/sales-order',
      ),
    ).toEqual([]));

  it('커널은 DbService 의 db 를 직접 쓰지 않는다 — 읽기는 Reader, 트랜잭션은 run', () =>
    expect(filesCalling(/\bthis\.db\.db\b/, 'apps/core/src/modules/sales-order/order-cancellation')).toEqual([]));

  it('커널은 Wallet 을 모른다', () =>
    expect(
      filesCalling(/WalletRefundClient|wallet-refund\.client/, 'apps/core/src/modules/sales-order/order-cancellation'),
    ).toEqual([]));

  it('취소 경로에 채널 이름 리터럴이 없다', () =>
    expect(
      filesCalling(/'(medusa|naver|coupang|3pl)'/, [
        'apps/core/src/modules/sales-order/order-cancellation',
        'apps/core/src/modules/sales-order/channel-cancel-request',
        'apps/core/src/modules/sales-order/services/self-cancel-block.ts',
      ]).filter((f) => !f.endsWith('channel-cancellation-capability.ts')),
    ).toEqual([]));
});
