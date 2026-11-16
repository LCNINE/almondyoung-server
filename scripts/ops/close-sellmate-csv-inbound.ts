/**
 * 일회성 정리(#1240) — 셀메이트 시기 입고예정 원천을 닫는다. 배포 뒤 한 번, 멱등.
 *
 * 배경: `load-inbound-from-csv` 는 셀메이트 입고예정 CSV 를 «발주»로 비춘 거울(audit_notes 가
 * `sellmate-csv-inbound` 로 시작)을 core 에 만들었다. 입고예정일의 원천이 선적·발주로 바뀐 지금
 * 이 거울 라인이 열려 있으면 앱 입고예정 목록과 스토어프론트 날짜를 가짜로 채운다.
 *
 * 하는 일 (--apply):
 *   1. 거울 발주의 열린 라인(closed_at IS NULL)을 `PurchaseOrderReceivingManager.shortCloseLine`(잔량 포기)으로 닫는다.
 *      헤더 파생·SKU 재발행은 그 경로가 한다 — 상태를 직접 UPDATE 하지 않는다.
 *      이미 닫혔거나 전량 입고됐거나 취소된 발주·주문 전 라인의 409 는 건너뛰고 센다(그래서 다시 돌려도 0건).
 *   2. 열린 선적(expected·receiving)의 sku 줄 SKU 를 재발행한다. #1240 배포 전에 확정된 선적은
 *      확정 시점의 재발행 트리거가 없었다.
 *
 * 기본은 dry-run(대상 수만 출력, DB 미반영). 반드시 dry-run 을 먼저 본다.
 *
 *   DATABASE_URL=… npx tsx scripts/ops/close-sellmate-csv-inbound.ts            # dry-run
 *   DATABASE_URL=… npx tsx scripts/ops/close-sellmate-csv-inbound.ts --apply
 *
 * live 의 DATABASE_URL 은 `bash scripts/sellmate/run.sh <stage> …` 가 쓰는 탐색과 같은 방법으로 얻는다(터널 필요).
 *
 * 생성 방식: shortCloseLine 이 쓰는 의존성(헤더 파생기·리더·sellable 서비스)만 손으로 만든다
 * (`scripts/sellmate/recalc-sellable.ts` 선례). 입고 커널·멱등 서비스는 이 메서드가 안 쓰므로 넘기지 않는다 —
 * 메서드가 그 둘을 쓰기 시작하면 아래 `unusedByShortCloseLine` 이 던진다.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { outboxPublisherFor } from '../../apps/core/src/modules/fulfillment/outbox/__support__/outbox-publisher.factory';
import { mergedSchema, MergedSchema } from '../../apps/core/src/platform/database/merged-schema';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { PurchaseOrderReceivingManager } from '../../apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.manager';
import { PurchaseOrderHeaderDeriver } from '../../apps/core/src/modules/inventory/procurement/services/purchase-order-header.deriver';
import { PurchaseOrderReader } from '../../apps/core/src/modules/inventory/procurement/services/purchase-order.reader';

const APPLY = process.argv.includes('--apply');
const CSV_TAG = 'sellmate-csv-inbound%';
const REASON = 'sellmate-csv-inbound: closed by #1240';
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const CHUNK = 200;

/** shortCloseLine 이 안 쓰는 의존성 자리. 쓰는 순간 조용히 undefined 를 건드리지 않고 던진다. */
function unusedByShortCloseLine<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get: () => {
        throw new Error(`${name} 은 close-sellmate-csv-inbound 스크립트에 연결돼 있지 않다 — shortCloseLine 이 바뀌었다`);
      },
    },
  ) as T;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (core 논리 DB)');
    process.exit(1);
  }

  // DbService 생성자는 tsx 에서 CJS interop 문제로 못 쓴다 — prototype 만 빌려 클라이언트를 주입한다(recalc-sellable.ts 와 같다).
  const client = postgres(url, { max: 4 });
  const dbService: DbService<MergedSchema> = Object.assign(Object.create(DbService.prototype), {
    _client: client,
    _db: drizzle(client, { schema: mergedSchema }),
  });

  try {
    const lines = await dbService.db.execute<{ po_id: string; sku_id: string }>(sql`
      SELECT pol.po_id, pol.sku_id
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.po_id
      WHERE po.audit_notes LIKE ${CSV_TAG} AND pol.closed_at IS NULL
      ORDER BY pol.po_id, pol.sku_id`);
    const shipmentSkus = await dbService.db.execute<{ sku_id: string }>(sql`
      SELECT DISTINCT l.sku_id
      FROM inbound_shipment_lines l
      JOIN inbound_shipments s ON s.id = l.shipment_id
      WHERE l.kind = 'sku' AND l.sku_id IS NOT NULL AND s.status IN ('expected', 'receiving')`);

    const poCount = new Set(lines.map((l) => l.po_id)).size;
    const lineSkuCount = new Set(lines.map((l) => l.sku_id)).size;
    console.log(`📋 CSV 거울 발주 ${poCount}건 · 열린 라인 ${lines.length}줄 · SKU ${lineSkuCount}개`);
    console.log(`📋 열린 선적(expected·receiving)의 sku 줄 SKU ${shipmentSkus.length}개`);

    if (!APPLY) {
      console.log('\n🔍 DRY-RUN — DB 미반영. --apply 로 실행.');
      return;
    }

    const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService as never);
    const sellable = new ProductSellableQuantityService(dbService, outbox);
    // 스크립트 경계의 좁은 캐스팅: 생성자 타입은 DbService<wmsSchema> 이고 mergedSchema 는 그 상위집합이다.
    const wmsDb = dbService as never;
    const manager = new PurchaseOrderReceivingManager(
      wmsDb,
      unusedByShortCloseLine('InboundReceiptKernel'),
      unusedByShortCloseLine('InventoryIdempotencyService'),
      new PurchaseOrderHeaderDeriver(),
      new PurchaseOrderReader(wmsDb),
      sellable,
    );

    let closed = 0;
    let skipped = 0;
    for (const line of lines) {
      try {
        await manager.shortCloseLine(line.po_id, line.sku_id, { reason: REASON }, SYSTEM_ACTOR);
        closed++;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        skipped++;
        console.log(`   건너뜀 po=${line.po_id} sku=${line.sku_id}: ${e.message}`);
      }
    }
    console.log(`✅ 라인 닫기: 닫음 ${closed}줄 · 건너뜀(409) ${skipped}줄`);

    let published = 0;
    const skuIds = shipmentSkus.map((r) => r.sku_id);
    for (let i = 0; i < skuIds.length; i += CHUNK) {
      const results = await sellable.recalculateAndPublishForSkus(skuIds.slice(i, i + CHUNK));
      published += results.filter((r) => r.published).length;
    }
    console.log(`✅ 열린 선적 SKU 재계산 ${skuIds.length}개 · 변경·발행 ${published}건`);
    console.log('   (발행분은 core outbox 디스패처가 Kafka 로 전송한다)');
  } finally {
    await dbService.onApplicationShutdown();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ 실패:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
