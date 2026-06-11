/**
 * QA7 (docs/qa/e2e-commerce-qa-guide.md #7) 1·2단계 사전준비 — dev 스테이지 전용.
 *
 * 실제 InboundService.simpleInbound 경로(저널 + 입고회차 + stock_events RECEIVE +
 * stock_ledgers + 작업로그)를 그대로 태우므로 admin UI 입고와 동일한 데이터가 만들어진다.
 * SKU 이름 기준 멱등 — 이미 존재하는 SKU는 생성/입고를 건너뛰고 현재 재고만 보고한다.
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/qa/seed-qa7-dev.sh
 */
import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sum } from 'drizzle-orm';
import { Resource } from 'sst';

import { mergedSchema } from '../../apps/core/src/platform/database/merged-schema';
import { wmsTables, DbTx } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { OutboxService } from '../../apps/core/src/modules/inventory/shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../apps/core/src/modules/inventory/core/repositories/stock-event.store';
import { InventoryCommandService } from '../../apps/core/src/modules/inventory/core/services/inventory-command.service';
import { LocationService } from '../../apps/core/src/modules/inventory/core/services/location.service';
import { SkuCatalogReader } from '../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader';
import { SkuCatalogManager } from '../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager';
import { SkuCatalogService } from '../../apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.service';
import { InboundService } from '../../apps/core/src/modules/inventory/inbound/services/inbound.service';

// scripts/seeding/constants/uuids.ts 의 WAREHOUSE_BUCHEON_DOMESTIC
const WAREHOUSE_BUCHEON = '019d0001-0001-7000-a000-000000000001';

const QA_SKUS: Array<{ name: string; qty: number; memo: string }> = [
  { name: 'QA7-A', qty: 1, memo: 'QA7 A-1 예약이전 간단판 (재고 정확히 1개 — deadlock 재현)' },
  { name: 'QA7-B-SPLIT', qty: 3, memo: 'QA7 B-1 전량 예약 상태 FO 분할' },
  { name: 'QA7-C-FLOW-1', qty: 3, memo: 'QA7 C 일반 출고 전체 흐름 (FOI 1번째 줄)' },
  { name: 'QA7-C-FLOW-2', qty: 2, memo: 'QA7 C 일반 출고 전체 흐름 (FOI 2번째 줄 — 검수 reject 케이스)' },
  { name: 'QA7-A2-GAP', qty: 1, memo: 'QA7 A-2 갑/을 정식판 SKU A (선택 시나리오)' },
  { name: 'QA7-A2-EUL', qty: 1, memo: 'QA7 A-2 갑/을 정식판 SKU B (선택 시나리오)' },
];

async function main() {
  const stage = Resource.App.stage;
  if (stage === 'live') {
    throw new Error('live 스테이지에는 QA 시드를 넣을 수 없습니다.');
  }
  console.log(`stage=${stage} app=${Resource.App.name}`);

  const dbRes = Resource.Db as { username: string; password: string; host: string; port: number };
  const url = `postgresql://${dbRes.username}:${encodeURIComponent(dbRes.password)}@${dbRes.host}:${dbRes.port}/core?sslmode=require`;

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema: mergedSchema });

  // 통합 테스트와 동일한 수동 와이어링 — DbService 모양({ db })만 맞추면 된다
  const dbService = { db } as never;
  const outbox = new OutboxService(dbService);
  const sellable = new ProductSellableQuantityService(dbService, outbox);
  const eventStore = new StockEventStore(dbService, sellable);
  const command = new InventoryCommandService(dbService, eventStore, outbox);
  const location = new LocationService(dbService);
  const reader = new SkuCatalogReader(dbService);
  const manager = new SkuCatalogManager(dbService, reader);
  const skuCatalog = new SkuCatalogService(reader, manager);
  const inbound = new InboundService(dbService, skuCatalog, command, location, eventStore);

  try {
    const [warehouse] = await db
      .select()
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, WAREHOUSE_BUCHEON));
    if (!warehouse) {
      const all = await db.select().from(wmsTables.warehouses);
      throw new Error(
        `부천 물류창고(${WAREHOUSE_BUCHEON})가 없습니다. 현재 창고: ${all.map((w) => `${w.name}(${w.id})`).join(', ') || '없음'} — db:seed:ref 먼저 실행 필요`,
      );
    }
    console.log(`창고: ${warehouse.name} (${warehouse.id})\n`);

    const onHand = async (skuId: string) => {
      const [row] = await db
        .select({ qty: sum(wmsTables.stockLedgers.qty) })
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, skuId),
            eq(wmsTables.stockLedgers.warehouseId, WAREHOUSE_BUCHEON),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      return Number(row?.qty ?? 0);
    };

    const results: Array<{ name: string; code: string; id: string; onHand: number; note: string }> = [];

    for (const spec of QA_SKUS) {
      const [existing] = await db.select().from(wmsTables.skus).where(eq(wmsTables.skus.name, spec.name));
      if (existing) {
        results.push({
          name: spec.name,
          code: existing.code,
          id: existing.id,
          onHand: await onHand(existing.id),
          note: '이미 존재 — 생성/입고 건너뜀',
        });
        continue;
      }

      // SKU 생성 + 입고를 한 트랜잭션으로 — 중간 실패 시 반쪽 상태가 남지 않게
      const created = await db.transaction(async (tx: DbTx) => {
        const sku = await skuCatalog.create({ name: spec.name, stockType: 'physical' } as never, tx);
        await inbound.simpleInbound(
          { warehouseId: WAREHOUSE_BUCHEON, items: [{ skuId: sku.id, quantity: spec.qty, memo: spec.memo }] },
          tx,
        );
        return sku;
      });

      results.push({
        name: spec.name,
        code: created.code,
        id: created.id,
        onHand: await onHand(created.id),
        note: `신규 생성 + ${spec.qty}개 입고`,
      });
    }

    console.log('=== QA7 사전준비 결과 ===');
    for (const r of results) {
      console.log(`${r.name.padEnd(14)} code=${r.code} onHand=${r.onHand}  ${r.note}\n  id=${r.id}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
