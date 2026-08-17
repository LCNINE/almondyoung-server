/**
 * #647 일회성 정리 — 이미 Core 에 수집된 주문의 가짜 격리를 닫는다.
 *
 * 배경: 폴러는 `updated_at > 워터마크` 로 묻기 때문에 이미 수집한 주문도 바뀌면 다시 온다.
 * 그때 라인 식별에 실패하면(Medusa 원본 variant 가 사라지면 주문 라인의 비정규화 필드만 남고
 * 식별자는 증발한다) 번역기가 격리 후보로 올렸고, orchestrator 가 매핑을 보지 않고 기록했다.
 * 2026-08-17 실측 기준 `channel_product_identification_failed` 117건 **전부** 이 경우였다.
 *
 * 코드 수정은 새로 쌓이는 것만 막는다. 이미 쌓인 행은 이 스크립트가 닫는다.
 *
 * ⚠️ 판정 조건은 **개수가 아니라 매핑 존재**다. 117 이라는 숫자로 거르면 그 사이 늘어난 건을
 * 놓친다. `wms_order_mappings` 에 대응 행이 있으면 그 격리는 조치 대상이 아니다.
 *
 * 사용법:
 *   npx tsx scripts/ops/647-close-already-collected-quarantines.ts          # 조회만 (기본)
 *   npx tsx scripts/ops/647-close-already-collected-quarantines.ts --apply  # 실제 종결
 */
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const REASON =
  'Closed by scripts/ops/647-close-already-collected-quarantines.ts: order was already collected into Core before it was quarantined (#647)';

async function main() {
  const db = (Resource as any).Db;
  const sql = postgres({
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: 'channel_adapter',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    // 1) 대상 확인. 매핑이 있는 격리만 센다.
    const targets = await sql`
      SELECT f.id, f.external_order_id, f.status, f.created_at, m.created_at AS mapped_at
      FROM order_collection_failures f
      JOIN wms_order_mappings m
        ON m.sales_channel = f.channel AND m.channel_order_id = f.external_order_id
      WHERE f.reason = 'channel_product_identification_failed'
        AND f.status = 'quarantined'
      ORDER BY f.created_at`;

    console.log(`종결 대상: ${targets.length}건`);
    if (targets.length > 0) {
      const first = targets[0] as any;
      const last = targets[targets.length - 1] as any;
      console.log(`  기간: ${first.created_at.toISOString()} ~ ${last.created_at.toISOString()}`);
    }

    // 2) 남는 것 확인. 매핑이 없는 격리는 **진짜 조치 대상**이므로 건드리지 않는다.
    const [remaining] = await sql`
      SELECT count(*)::int AS n
      FROM order_collection_failures f
      LEFT JOIN wms_order_mappings m
        ON m.sales_channel = f.channel AND m.channel_order_id = f.external_order_id
      WHERE f.reason = 'channel_product_identification_failed'
        AND f.status = 'quarantined'
        AND m.channel_order_id IS NULL`;
    console.log(`남기는 진짜 조치 대상(매핑 없음): ${(remaining as any).n}건`);

    if (!APPLY) {
      console.log('\n조회만 했다. 적용하려면 --apply 를 붙일 것.');
      return;
    }

    if (targets.length === 0) {
      console.log('\n닫을 것이 없다.');
      return;
    }

    const result = await sql`
      UPDATE order_collection_failures f
         SET status = 'closed_already_collected',
             error_message = ${REASON},
             updated_at = now()
        FROM wms_order_mappings m
       WHERE m.sales_channel = f.channel
         AND m.channel_order_id = f.external_order_id
         AND f.reason = 'channel_product_identification_failed'
         AND f.status = 'quarantined'`;

    console.log(`\n종결 완료: ${result.count}건`);

    const [after] = await sql`
      SELECT count(*)::int AS n
      FROM order_collection_failures
      WHERE reason = 'channel_product_identification_failed' AND status = 'quarantined'`;
    console.log(`남은 quarantined: ${(after as any).n}건 (전부 매핑 없는 진짜 조치 대상이어야 한다)`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
