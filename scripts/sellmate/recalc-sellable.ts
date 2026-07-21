/**
 * sync-stock 후속: 매칭된 SKU 의 sellable 프로젝션 재계산 + 이벤트 발행.
 *
 * sync-stock 이 "매칭된 SKU N개의 재고가 바뀌었습니다" 경고를 냈을 때 짝으로 실행한다.
 * 최근 sellmate-sync stock_events 가 건드린 SKU 에 연결된 variant 를 찾아
 * 프로덕션 코드(ProductSellableQuantityService.recalculateAndPublishForVariants)를
 * 그대로 호출한다 — 프로젝션 upsert + outbox enqueue 까지 앱과 동일 경로.
 * 발행(outbox → Kafka)은 live core 앱의 outbox 디스패처가 처리하므로 여기선 DB 만 쓴다.
 *
 * idempotent: 프로젝션이 이전과 같으면 publish 를 건너뛴다(서비스 내장 로직).
 *
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live recalc-sellable .
 *   bash scripts/sellmate/run.sh live recalc-sellable .
 *
 * 환경변수:
 *   DATABASE_URL         core 논리 DB (run.sh 가 주입)
 *   SINCE_HOURS          며칠 전 sellmate-sync 이벤트까지 볼지 (기본 24시간)
 *   DRY_RUN=1            대상 variant 목록만 출력
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { mergedSchema, MergedSchema } from '../../apps/core/src/platform/database/merged-schema';
import { OutboxService } from '../../apps/core/src/modules/inventory/shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SINCE_HOURS = Number(process.env.SINCE_HOURS || 24);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }

  // ponytail: Nest DI 없이 수동 인스턴스화 — 스크립트엔 모듈 부트스트랩이 과함.
  // DbService 생성자는 tsx 에서 CJS interop(`import * as postgres`) 문제로 못 쓰므로
  // prototype 만 빌려 클라이언트를 직접 주입한다 (run()/db getter 는 그대로 동작).
  const client = postgres(url, { max: 4 });
  const dbService: DbService<MergedSchema> = Object.assign(Object.create(DbService.prototype), {
    _client: client,
    _db: drizzle(client, { schema: mergedSchema }),
  });
  const outbox = new OutboxService(dbService as never);
  const svc = new ProductSellableQuantityService(dbService, outbox);

  try {
    // 두 갈래를 합친다. 재고가 바뀐 것뿐 아니라 **새로 매칭된** variant 도 재계산 대상이다 —
    // 매칭 직후엔 재고 변동(stock_events)이 없어서 첫 갈래만으로는 안 잡히고,
    // 그러면 매칭해놓고도 Medusa 품절이 영영 반영되지 않는다.
    const rows = await dbService.db.execute<{ variant_id: string }>(sql`
      SELECT DISTINCT pm.variant_id
      FROM stock_events se
      JOIN product_variant_sku_links l ON l.sku_id = se.sku_id
      JOIN product_matchings pm ON pm.id = l.product_matching_id
      WHERE se.reason = 'sellmate-sync'
        AND se.occurred_at >= now() - make_interval(hours => ${SINCE_HOURS})
      UNION
      SELECT DISTINCT pm.variant_id
      FROM product_matchings pm
      WHERE pm.status = 'matched'
        AND pm.updated_at >= now() - make_interval(hours => ${SINCE_HOURS})
    `);
    const variantIds = rows.map((r) => r.variant_id);
    console.log(`📊 최근 ${SINCE_HOURS}시간 재고변동 + 신규매칭 variant: ${variantIds.length}개`);

    if (variantIds.length === 0) {
      console.log('✅ 재계산할 variant 없음.');
      return;
    }
    if (DRY_RUN) {
      for (const id of variantIds.slice(0, 20)) console.log(`   variant=${id}`);
      if (variantIds.length > 20) console.log(`   … 외 ${variantIds.length - 20}개`);
      console.log('\n✅ DRY-RUN 종료 — DB 미반영.');
      return;
    }

    const results = await svc.recalculateAndPublishForVariants(variantIds);
    const published = results.filter((r) => r.published).length;
    const missing = results.filter((r) => r.projection === null).length;
    console.log(
      `\n✅ 재계산 완료: ${results.length}개 variant | 변경·발행 ${published}건 | 변동없음 ${results.length - published - missing}건 | variant 없음 ${missing}건`,
    );
    console.log('   (발행분은 live core outbox 디스패처가 Kafka 로 전송)');
  } finally {
    await dbService.onModuleDestroy();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ 실패:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
