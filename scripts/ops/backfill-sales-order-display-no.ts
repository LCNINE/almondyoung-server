/**
 * core `sales_orders.display_order_no` 백필 — 자사몰(medusa) 과거 주문분.
 *
 * 왜 필요한가: 이 컬럼은 `OrderCreated` 이벤트의 `displayOrderNo` 로 채워지므로 컬럼이 생긴
 * 뒤의 주문만 값이 있다. 과거 주문은 Medusa `order.display_id` 가 유일한 출처다.
 * 백필 전에는 과거 주문이 관리자 화면에 내부 ID(`order_01J…`)로 남고, 고객 주문번호 검색에도
 * 안 걸린다.
 *
 * 안전성:
 *   - medusa DB 는 **읽기만** 한다. core 는 `display_order_no IS NULL` 인 행만 채운다
 *     (이미 이벤트로 채워진 값을 덮어쓰지 않는다 → 몇 번 돌려도 같은 결과).
 *   - 배치 단위로 끊어 쓴다. 라이브 주문 쓰기 경로와 같은 표를 만지므로 한 트랜잭션에
 *     전건을 담지 않는다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/backfill-sales-order-display-no.ts
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/backfill-sales-order-display-no.ts --apply
 */
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

function conn(database: string) {
  const db = (Resource as any).Db;
  return postgres({
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database,
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
}

async function main() {
  const core = conn('core');
  const medusa = conn('medusa');
  try {
    const [{ cnt: pending }] = (await core`
      SELECT count(*)::int AS cnt FROM sales_orders
      WHERE sales_channel = 'medusa' AND display_order_no IS NULL
    `) as any[];
    console.log(`백필 대상(medusa · display_order_no IS NULL): ${pending}건`);
    if (!pending) return;

    let done = 0;
    let filled = 0;
    let unmatched = 0;

    for (;;) {
      const rows = (await core`
        SELECT id, channel_order_id FROM sales_orders
        WHERE sales_channel = 'medusa' AND display_order_no IS NULL
        ORDER BY order_date
        LIMIT ${BATCH} OFFSET ${done}
      `) as any[];
      if (!rows.length) break;

      const channelOrderIds = rows.map((r) => r.channel_order_id);
      const found = (await medusa`
        SELECT id, display_id FROM "order" WHERE id = ANY(${channelOrderIds})
      `) as any[];
      const displayById = new Map<string, number>(
        found.filter((o) => o.display_id != null).map((o) => [o.id as string, o.display_id as number])
      );

      const updates = rows
        .map((r) => ({ id: r.id as string, no: displayById.get(r.channel_order_id) }))
        .filter((u): u is { id: string; no: number } => u.no != null);

      unmatched += rows.length - updates.length;

      if (APPLY && updates.length) {
        // 행별 값이 달라 한 문장으로 묶으려면 VALUES 조인이 필요하다.
        await core`
          UPDATE sales_orders AS s SET display_order_no = v.no, updated_at = now()
          FROM (VALUES ${core(updates.map((u) => [u.id, String(u.no)]))}) AS v(id, no)
          WHERE s.id = v.id::uuid AND s.display_order_no IS NULL
        `;
      }
      filled += updates.length;

      // APPLY 면 채워진 행이 대상에서 빠지므로 OFFSET 을 올리지 않는다.
      // DRY-RUN 이면 아무것도 안 지워지므로 OFFSET 을 밀어야 다음 배치를 본다.
      if (!APPLY) done += rows.length;
      else done += rows.length - updates.length;

      console.log(`  진행: 매칭 ${filled}건 / medusa 에 없음 ${unmatched}건`);
      if (rows.length < BATCH) break;
    }

    console.log(
      APPLY
        ? `\n>>> ${filled}건 채움. medusa 에서 못 찾은 주문 ${unmatched}건은 그대로 NULL (화면은 내부 ID 로 폴백).`
        : `\n[DRY-RUN] 채울 수 있는 주문 ${filled}건 / 못 찾는 주문 ${unmatched}건 — 적용하려면 --apply`
    );
  } finally {
    await core.end({ timeout: 5 }).catch(() => {});
    await medusa.end({ timeout: 5 }).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
