import { outboxPublisherFor } from '../../apps/core/src/modules/fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
/**
 * sync-stock 후속: 매칭된 SKU 의 sellable 프로젝션 재계산 + 이벤트 발행.
 *
 * sync-stock 이 "매칭된 SKU N개의 재고가 바뀌었습니다" 경고를 냈을 때 짝으로 실행한다.
 * 최근 SELLMATE_STOCK_REASONS(sellmate-sync·sellmate-handover·sellmate-reconcile) stock_events 가 건드린 SKU 에 연결된 variant 를 찾아
 * 프로덕션 코드(ProductSellableQuantityService.recalculateAndPublishForVariants)를
 * 그대로 호출한다 — 프로젝션 upsert + outbox enqueue 까지 앱과 동일 경로.
 * 발행(outbox → Kafka)은 live core 앱의 outbox 디스패처가 처리하므로 여기선 DB 만 쓴다.
 *
 * idempotent: 프로젝션이 이전과 같으면 publish 를 건너뛴다(서비스 내장 로직).
 * evening-reconcile.ts 는 커밋 뒤 `recalcSellableForSkus` 로 원장이 바뀐 SKU 만 같은 경로로 다시 계산한다.
 *
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live recalc-sellable .
 *   bash scripts/sellmate/run.sh live recalc-sellable .
 *
 * 환경변수:
 *   DATABASE_URL         core 논리 DB (run.sh 가 주입)
 *   SINCE_HOURS          몇 시간 전 셀메이트 재고 이벤트까지 볼지 (기본 24시간)
 *   DRY_RUN=1            대상 variant 목록만 출력
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { mergedSchema, MergedSchema } from '../../apps/core/src/platform/database/merged-schema';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SINCE_HOURS = Number(process.env.SINCE_HOURS || 24);

/** 셀메이트 스크립트가 원장에 적는 stock_events.reason 전부 — sync-stock·handover-stock-addback·evening-reconcile */
export const SELLMATE_STOCK_REASONS: readonly string[] = ['sellmate-sync', 'sellmate-handover', 'sellmate-reconcile'];

type SellableRuntime = { dbService: DbService<MergedSchema>; svc: ProductSellableQuantityService };

function createSellableRuntime(url: string): SellableRuntime {
  // ponytail: Nest DI 없이 수동 인스턴스화 — 스크립트엔 모듈 부트스트랩이 과함.
  // DbService 생성자는 tsx 에서 CJS interop(`import * as postgres`) 문제로 못 쓰므로
  // prototype 만 빌려 클라이언트를 직접 주입한다 (run()/db getter 는 그대로 동작).
  const client = postgres(url, { max: 4 });
  const dbService: DbService<MergedSchema> = Object.assign(Object.create(DbService.prototype), {
    _client: client,
    _db: drizzle(client, { schema: mergedSchema }),
  });
  const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService as never);
  return { dbService, svc: new ProductSellableQuantityService(dbService, outbox) };
}

function logDryRunVariants(variantIds: readonly string[]): void {
  for (const id of variantIds.slice(0, 20)) console.log(`   variant=${id}`);
  if (variantIds.length > 20) console.log(`   … 외 ${variantIds.length - 20}개`);
}

/**
 * variant 목록을 잘라 재계산·발행한다.
 * ⚠️ recalculateAndPublishForVariants 는 넘긴 목록 전체를 **트랜잭션 하나**로 처리한다
 * (product-sellable-quantity.service.ts 의 dbService.run 이 루프를 통째로 감싼다).
 * 원래 이벤트 하나당 variant 몇 개를 다루는 함수라, 수만 개를 그대로 넘기면
 * ① 끝까지 가야 커밋 → 중간에 끊기면 전부 롤백 ② 진행률이 안 보임
 * ③ live 에 장시간 트랜잭션이 걸려 vacuum·DDL 이 막힌다.
 * 그래서 여기서 잘라 넘긴다 — 배치마다 독립 트랜잭션이라 끊겨도 그때까지가 남는다.
 */
async function recalcVariants(svc: ProductSellableQuantityService, variantIds: readonly string[]): Promise<void> {
  const CHUNK = Number(process.env.RECALC_CHUNK || 200);
  let published = 0;
  let missing = 0;
  let done = 0;
  const startedAt = Date.now();
  for (let i = 0; i < variantIds.length; i += CHUNK) {
    const batch = variantIds.slice(i, i + CHUNK);
    const results = await svc.recalculateAndPublishForVariants(batch);
    published += results.filter((r) => r.published).length;
    missing += results.filter((r) => r.projection === null).length;
    done += results.length;
    const rate = done / Math.max(1, (Date.now() - startedAt) / 1000);
    const etaMin = Math.round((variantIds.length - done) / Math.max(rate, 0.001) / 60);
    console.log(
      `  진행 ${done}/${variantIds.length} (발행 ${published}) — ${rate.toFixed(1)}건/초, 남은시간 약 ${etaMin}분`,
    );
  }
  console.log(
    `\n✅ 재계산 완료: ${done}개 variant | 변경·발행 ${published}건 | 변동없음 ${done - published - missing}건 | variant 없음 ${missing}건`,
  );
  console.log('   (발행분은 live core outbox 디스패처가 Kafka 로 전송)');
}

/** 주어진 SKU 에 연결된 variant 를 재계산한다(dryRun 이면 목록만). 돌려주는 값은 대상 variant 수 */
export async function recalcSellableForSkus(
  databaseUrl: string,
  skuIds: readonly string[],
  dryRun: boolean,
): Promise<number> {
  if (skuIds.length === 0) return 0;
  const { dbService, svc } = createSellableRuntime(databaseUrl);
  try {
    const variantIds = new Set<string>();
    for (let i = 0; i < skuIds.length; i += 1000) {
      const part = skuIds.slice(i, i + 1000);
      const rows = await dbService.db.execute<{ variant_id: string }>(sql`
        SELECT DISTINCT pm.variant_id
        FROM product_variant_sku_links l
        JOIN product_matchings pm ON pm.id = l.product_matching_id
        WHERE l.sku_id IN (${sql.join(
          part.map((id) => sql`${id}`),
          sql`, `,
        )})
      `);
      for (const r of rows) variantIds.add(r.variant_id);
    }
    const ids = [...variantIds];
    if (ids.length === 0) return 0;
    if (dryRun) logDryRunVariants(ids);
    else await recalcVariants(svc, ids);
    return ids.length;
  } finally {
    await dbService.onApplicationShutdown();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }

  const { dbService, svc } = createSellableRuntime(url);

  try {
    // 두 갈래를 합친다. 재고가 바뀐 것뿐 아니라 **새로 매칭된** variant 도 재계산 대상이다 —
    // 매칭 직후엔 재고 변동(stock_events)이 없어서 첫 갈래만으로는 안 잡히고,
    // 그러면 매칭해놓고도 Medusa 품절이 영영 반영되지 않는다.
    const rows = await dbService.db.execute<{ variant_id: string }>(sql`
      SELECT DISTINCT pm.variant_id
      FROM stock_events se
      JOIN product_variant_sku_links l ON l.sku_id = se.sku_id
      JOIN product_matchings pm ON pm.id = l.product_matching_id
      WHERE se.reason IN (${sql.join(
        SELLMATE_STOCK_REASONS.map((r) => sql`${r}`),
        sql`, `,
      )})
        AND se.occurred_at >= now() - make_interval(hours => ${SINCE_HOURS})
      UNION
      SELECT DISTINCT pm.variant_id
      FROM product_matchings pm
      WHERE pm.status = 'matched'
        AND pm.updated_at >= now() - make_interval(hours => ${SINCE_HOURS})
    `);
    // VARIANT_IDS 가 주어지면 그것만 (콤마 구분). 특정 건 복구용.
    const explicit = (process.env.VARIANT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const variantIds = explicit.length ? explicit : rows.map((r) => r.variant_id);
    console.log(
      explicit.length
        ? `📊 VARIANT_IDS 지정: ${variantIds.length}개`
        : `📊 최근 ${SINCE_HOURS}시간 재고변동 + 신규매칭 variant: ${variantIds.length}개`,
    );

    if (variantIds.length === 0) {
      console.log('✅ 재계산할 variant 없음.');
      return;
    }
    if (DRY_RUN) {
      logDryRunVariants(variantIds);
      console.log('\n✅ DRY-RUN 종료 — DB 미반영.');
      return;
    }

    await recalcVariants(svc, variantIds);
  } finally {
    await dbService.onApplicationShutdown();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
