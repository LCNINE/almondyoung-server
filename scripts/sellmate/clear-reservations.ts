/**
 * Medusa 예약(reservation) 정리 — 셀메이트 재고 동기화의 짝 (Ⓑ)
 *
 * 왜 필요한가: 출고는 셀메이트에서 하고 Medusa 에는 fulfillment 를 만들지 않는다.
 * Medusa 에서 예약이 풀리는 유일한 경로가 fulfillment 라서, 주문 때 잡힌 예약이
 * 영원히 남는다 (2026-07-29 live: fulfillment 0건 / 살아있는 예약 2,830건·12,358개).
 * 스토어프론트가 보는 값은 available = stocked - reserved 이므로, sync-stock 이
 * stocked 를 아무리 정확히 맞춰도 예약이 쌓인 만큼 재고가 과소 계상된다.
 *
 * 기준: **CSV 스냅샷 시각보다 먼저 생성된 예약은 전부 지운다.**
 * 그 시점까지의 미발송 주문분은 CSV 의 `미발송주문수` 로 이미 재고에서 빠져 있고
 * (sync-stock 이 `현재재고 - 미발송주문수` 를 넣는다), 출고분은 `현재재고` 에서 빠져 있다.
 * 즉 스냅샷 이전 예약은 어느 쪽이든 이중 차감이다. 이후 예약만 유효하다.
 *
 * "출고된 주문만" 이 아니라 시각 기준인 이유: Medusa order ↔ Core sales_order 매핑에
 * orderId 불일치 이력이 있어 출고 판정이 못 미덥다. 시각은 CSV 자체가 증거다.
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   # dry-run (기본) — CSV 파일명에서 스냅샷 시각을 읽는다
 *   DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations ~/Downloads/stk_stockList_20260729_102241.csv
 *
 *   # 실제 반영
 *   DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations <csv> --apply
 *
 *   # 시각 직접 지정 (KST)
 *   … clear-reservations --before '2026-07-29 10:22:41'
 *
 * ⚠️ sync-stock 보다 **먼저** 돌린다. 순서가 반대면 예약이 남은 채로 재고가 내려가
 *    available 이 잠깐 음수로 보이는 구간이 생긴다.
 */
import postgres, { Sql } from 'postgres';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** CSV 파일명(`..._20260729_102241.csv`, KST) 또는 `YYYY-MM-DD HH:mm:ss`(KST) → UTC Date. */
export function parseCutoff(src: string): Date {
  const fromName = src.match(/_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (fromName) {
    const [, y, mo, d, h, mi, s] = fromName;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - KST_OFFSET_MS);
  }
  const explicit = src.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (explicit) {
    const [, y, mo, d, h, mi, s] = explicit;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)) - KST_OFFSET_MS);
  }
  throw new Error(
    `기준시각을 못 읽었습니다: "${src}"\n` +
      `   CSV 파일명(stk_stockList_20260729_102241.csv) 이나 --before '2026-07-29 10:22:41' (KST) 형식이 필요합니다.`,
  );
}

type Row = { inventory_item_id: string; location_id: string; qty: string; n: string; title: string | null };

/**
 * `inventory_level.reserved_quantity` 는 `reservation_item` 의 캐시일 뿐인데, 예약 행만 지워지고
 * 카운터가 안 내려간 칸이 생긴다 (2026-07-30 live: 243칸 / 9,465개, 그 탓에 47칸·2,355개 재고가 품절).
 * 그래서 개별 차감(reserved - qty)이 아니라 **살아있는 예약 합계로 덮어쓴다** — 과거 잔재까지 같이 낫는다.
 */
const RESERVED_DRIFT = (tx: Sql) => tx<{ id: string; from: number; to: number }[]>`
  SELECT il.id, il.reserved_quantity AS from, COALESCE(r.q, 0)::int AS to
  FROM inventory_level il
  LEFT JOIN (
    SELECT inventory_item_id, location_id, SUM(quantity)::int AS q
    FROM reservation_item WHERE deleted_at IS NULL GROUP BY 1, 2
  ) r ON r.inventory_item_id = il.inventory_item_id AND r.location_id = il.location_id
  WHERE il.deleted_at IS NULL AND il.reserved_quantity <> COALESCE(r.q, 0)
`;

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const beforeIdx = argv.indexOf('--before');
  const source = beforeIdx >= 0 ? argv[beforeIdx + 1] : argv.find((a) => !a.startsWith('--'));
  if (!source) {
    console.error('사용법: clear-reservations.ts <csv경로> [--apply]  |  --before "YYYY-MM-DD HH:mm:ss" [--apply]');
    process.exit(1);
  }
  const cutoff = parseCutoff(source);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (DB_NAME=medusa bash scripts/sellmate/run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }

  const kst = new Date(cutoff.getTime() + KST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n🕒 기준시각(KST) ${kst} — 이보다 먼저 생성된 예약을 정리 대상으로 봅니다.`);

  const sql = postgres(url, { max: 4 });
  try {
    const rows = await sql<Row[]>`
      SELECT ri.inventory_item_id, ri.location_id,
             SUM(ri.quantity)::text AS qty, count(*)::text AS n,
             (array_agg(p.title ORDER BY p.title))[1] AS title
      FROM reservation_item ri
      LEFT JOIN product_variant_inventory_item pvii
        ON pvii.inventory_item_id = ri.inventory_item_id AND pvii.deleted_at IS NULL
      LEFT JOIN product_variant v ON v.id = pvii.variant_id AND v.deleted_at IS NULL
      LEFT JOIN product p ON p.id = v.product_id
      WHERE ri.deleted_at IS NULL AND ri.created_at < ${cutoff}
      GROUP BY ri.inventory_item_id, ri.location_id
    `;

    const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
    const totalItems = rows.reduce((s, r) => s + Number(r.n), 0);
    const [remain] = await sql<{ n: string; qty: string }[]>`
      SELECT count(*)::text AS n, COALESCE(SUM(quantity),0)::text AS qty
      FROM reservation_item WHERE deleted_at IS NULL AND created_at >= ${cutoff}
    `;

    console.log(`\n📊 정리 대상: 예약 ${totalItems}건 / 수량 ${totalQty}개 (재고칸 ${rows.length}곳)`);
    console.log(`   유지(스냅샷 이후): 예약 ${remain.n}건 / 수량 ${remain.qty}개`);

    if (rows.length > 0) {
      console.log('\n🔎 회복량 상위 15건:');
      for (const r of [...rows].sort((a, b) => Number(b.qty) - Number(a.qty)).slice(0, 15)) {
        console.log(`   +${String(r.qty).padStart(4)}개 (예약 ${r.n}건)  ${r.title ?? '(상품 연결 없음)'}`);
      }
    }

    const drift = await RESERVED_DRIFT(sql);
    const driftQty = drift.reduce((s, d) => s + (d.from - d.to), 0);
    console.log(
      `\n🧮 reserved 카운터 어긋남: ${drift.length}칸 / ${driftQty}개` +
        (drift.length ? ' — 살아있는 예약 합계로 맞춥니다.' : ' (정상)'),
    );

    if (rows.length === 0 && drift.length === 0) {
      console.log('\n✅ 할 일이 없습니다.');
      return;
    }

    if (!apply) {
      console.log('\n✅ DRY-RUN 종료 — DB 미반영. 적용하려면 --apply');
      return;
    }

    const result = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`SELECT pg_advisory_xact_lock(hashtext('sellmate-clear-reservations'))`;

      const deleted = await tx`
        UPDATE reservation_item SET deleted_at = now(), updated_at = now()
        WHERE deleted_at IS NULL AND created_at < ${cutoff}
      `;

      // 삭제 후의 예약 원장을 그대로 카운터에 반영. 개별 차감이 아니라 덮어쓰기라
      // 이번 삭제분과 과거 잔재가 한 번에 정합해진다.
      const gaps = await RESERVED_DRIFT(tx);
      for (const g of gaps) {
        await tx`UPDATE inventory_level SET reserved_quantity = ${g.to}, updated_at = now() WHERE id = ${g.id}`;
      }

      const left = (await RESERVED_DRIFT(tx)).length;
      if (left !== 0) throw new Error(`재정합 후에도 어긋난 칸 ${left}곳 — 전체 롤백`);

      return { deleted: deleted.count, levels: gaps.length };
    });

    console.log(`\n✅ 정리 완료: 예약 ${result.deleted}건 해제, 재고칸 ${result.levels}곳 reserved 재정합.`);
    console.log('   → 스토어프론트 반영은 캐시 TTL 이후. 급하면 해당 handle 을 /api/revalidate.');
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
