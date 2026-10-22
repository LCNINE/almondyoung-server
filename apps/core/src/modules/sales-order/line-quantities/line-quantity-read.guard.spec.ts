import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K6 PR2a — 취소 수량은 «취소 라인 행(`sales_order_cancellation_lines`)» 한 곳에서, 읽는 문의 SQL 조각 한 벌로만 읽는다.
 * 쓰기 문(`record-cancellation.ts`)과 조각(`line-quantities.sql.ts`) 말고 이 테이블 이름을 쓰는 파일이 생기면
 * 정의가 다시 여러 벌이 된다. K6 PR6 이 옛 `metadata.cancelledLines` 파서를 모두 지웠다 — 이름이 되살아나거나
 * 취소 metadata 에서 `cancelledLines` 를 다시 읽는 코드가 생기면(스크립트 포함) 빨갛다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const SCRIPTS = join(ROOT, 'scripts');
const RECORDER = 'apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts';
const FRAGMENTS = 'apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts';
const SCHEMA_FILE = 'inventory.schema.ts';

/** 취소 metadata 에서 `cancelledLines` 를 읽는 꼴(TS 접근·Reflect·jsonb 연산자). */
const METADATA_CANCELLED_LINES_READ =
  /metadata\??\.cancelledLines|metadata\??\.?\[\s*['"]cancelledLines['"]\s*\]|Reflect\.get\([^)]*['"]cancelledLines['"]\)|->>?\s*'cancelledLines'|#>>?\s*'\{cancelledLines/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__support__' || name === '__fixtures__' || name === 'node_modules' ? [] : walk(path);
    }
    return /\.(ts|js)$/.test(path) && !/\.spec\.(ts|js)$/.test(path) ? [path] : [];
  });
}

function filesMatching(predicate: (source: string) => boolean): string[] {
  return filesMatchingIn([SRC], predicate);
}

/** 운영 스크립트(`scripts/`)까지 훑는다 — 옛 파서는 백필 스크립트에서도 쓰였다. */
function filesMatchingIn(roots: string[], predicate: (source: string) => boolean): string[] {
  return roots
    .flatMap(walk)
    .filter((path) => !path.endsWith(SCHEMA_FILE))
    .filter((path) => predicate(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('취소 수량 읽는 문', () => {
  it('only the line-quantity kernel and the recorder read cancellation lines', () => {
    expect(filesMatching((source) => /salesOrderCancellationLines/.test(source))).toEqual([RECORDER, FRAGMENTS]);
  });

  it('retired cancelled-quantity parsers stay gone', () => {
    const pattern =
      /\bcancelledQuantitySql\b|\bloadPriorPartialCancellationContext\b|\bgetCancelledQuantityByLine\b|\bsumCancelledByLine\b|\breadCancelledLines\b|\blegacyCancelledByLine\b/;
    expect(filesMatchingIn([SRC, SCRIPTS], (source) => pattern.test(source))).toEqual([]);
  });

  it('the metadata-read pattern catches the common read shapes', () => {
    const shapes = [
      'metadata.cancelledLines',
      'metadata?.cancelledLines',
      "metadata['cancelledLines']",
      'metadata["cancelledLines"]',
      "metadata?.['cancelledLines']",
      "Reflect.get(metadata, 'cancelledLines')",
      'Reflect.get(metadata, "cancelledLines")',
      "c.metadata->'cancelledLines'",
      "c.metadata->>'cancelledLines'",
      "c.metadata #> '{cancelledLines}'",
    ];
    expect(shapes.filter((shape) => !METADATA_CANCELLED_LINES_READ.test(shape))).toEqual([]);
    // 이벤트 payload·감사 로그의 객체 리터럴은 다른 것이라 걸리지 않아야 한다.
    expect(METADATA_CANCELLED_LINES_READ.test('cancelledLines: requestedLines.map(')).toBe(false);
  });

  it('nothing reads cancelledLines out of cancellation metadata', () => {
    // 쓰기 쪽 재발은 쓰기 문의 런타임 검사가 잡는다 — 객체 리터럴 `cancelledLines:` 는 이벤트 payload 와 구별되지 않아 여기서 막지 않는다.
    expect(filesMatchingIn([SRC, SCRIPTS], (source) => METADATA_CANCELLED_LINES_READ.test(source))).toEqual([]);
  });

  it('retired shipment-phase definitions stay gone', () => {
    const pattern =
      /\borderShipmentPhaseSql\b|\bderiveFulfillmentPhase\b|\bhasShippedEvidence\b|\bMOVED_SHIPMENT_STATUSES\b|\boutstandingSalesUnits\b|\bgetEffectiveShippedFulfillmentQty\b|\bisReturnEligible\b|\bassertOrderDelivered\b|\bassertAttemptBasedReturnEligibility\b|\bassertPurchasedQuantityReturnCap\b|\bassertReturnQuantitiesAvailable\b|\bassertExchangeQuantitiesAvailable\b|\bFO_DELIVERED_STATUSES\b/;
    expect(filesMatching((source) => pattern.test(source))).toEqual([]);
  });

  it('only the kernel reads delivery tracking for quantities', () => {
    // 비테스트 운영 파일만 센다(walk 가 스펙·__support__ 를 뺀다). 픽스처는 현실 데이터를 흉내 내려 추적 행을 써야 한다.
    // - store-sales-orders.service.ts: 배송조회 화면의 추적 이벤트 목록이다(수량이 아니다).
    // - line-quantities.sql.ts: `deliveredParcelsSql` 이 «배송완료 소포»의 단 하나의 정의다(SKU 층 `delivered` 와 소포 단위 청구 자격이 함께 쓴다).
    // 반품 자격(store-return-exchange.service.ts)은 K6 PR3a 가 소포 단위 청구 자격(`parcel-claim-eligibility`)으로 옮겼다 —
    // 그 SQL 은 `deliveredParcelsSql` 을 불러 쓰므로 추적 테이블 이름을 직접 쓰지 않는다.
    const salesOrder = 'apps/core/src/modules/sales-order/';
    const files = filesMatching((source) => /shipment_tracking|shipmentTracking/.test(source)).filter((path) =>
      path.startsWith(salesOrder),
    );
    expect(files).toEqual(
      [
        `${salesOrder}line-quantities/line-quantities.sql.ts`,
        `${salesOrder}services/store-sales-orders.service.ts`,
      ].sort(),
    );
  });
});

describe('청구(반품·교환) 수량 읽는 문', () => {
  const salesOrder = 'apps/core/src/modules/sales-order/';

  it('only the kernel and the claim service touch claim items', () => {
    // 커널 SQL 조각(`claim-quantities.sql.ts`)이 수량을 읽고, 서비스는 항목을 만들고(INSERT) 요청을 다룬다.
    // `claim-quantities.reader.ts`·`parcel-claim-eligibility.*` 는 조각을 불러 쓸 뿐 이 테이블 이름을 쓰지 않는다(R2).
    const files = filesMatching((source) => /\breturnRequestItems\b|\bexchangeRequestItems\b/.test(source)).filter(
      (path) => path.startsWith(salesOrder),
    );
    expect(files).toEqual(
      [
        `${salesOrder}line-quantities/claim-quantities.sql.ts`,
        `${salesOrder}services/store-return-exchange.service.ts`,
      ].sort(),
    );
    expect(filesMatching((source) => /\breturnRequestItems\b|\bexchangeRequestItems\b/.test(source)).sort()).toEqual(
      files,
    );
  });

  it('claim quantities are summed only in the kernel', () => {
    // 서비스의 INSERT(`quantity: line.quantity`)는 걸리지 않는다. 항목 수량을 읽는 표현은 커널 SQL 조각(`claim-quantities.sql.ts`)의 raw SQL 별칭 `return_item.quantity`·`exchange_item.quantity` 뿐이다.
    expect(filesMatching((source) => /\b(returnRequestItems|exchangeRequestItems)\.quantity\b/.test(source))).toEqual(
      [],
    );
  });

  it('claim statuses have one home', () => {
    expect(filesMatching((source) => /const\s+ACTIVE_(RETURN|EXCHANGE)_STATUSES\s*=/.test(source))).toEqual([
      `${salesOrder}line-quantities/claim-statuses.ts`,
    ]);
  });
});
