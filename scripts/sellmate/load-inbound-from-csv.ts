/**
 * 셀메이트 재고 CSV 의 `입고예정일` → core 발주 라인. 스토어프론트 "○월 ○일 재입고 예정" 의 원천을 채운다.
 *
 * 왜 발주 라인인가: 입고예정일의 정본은 core 발주 라인(`purchase_order_lines.expected_arrival`)이고
 * ③ `sync-restock-to-medusa` 가 그걸 Medusa `variant.metadata.inboundDate` 로 옮긴다. Medusa 에 직접
 * 쓰면 다음 ③ 이 "발주 없음" 으로 보고 stale 제거로 지운다.
 *
 * 무엇을 쓰나: 실행마다 발주 1건(국내 · 부천 · confirmed/approved, `audit_notes` = `sellmate-csv-inbound <파일명>`)과
 * 오늘 이후 예정일인 품목마다 라인 1개(`ordered`, 수량 1 — CSV 에 입고예정수량이 없다).
 * 같은 SKU 가 여러 행이면 가장 이른 날짜를 쓴다.
 *
 * 반복 실행: 이전 실행이 만든 미종결 라인을 먼저 잔량 포기(`closed_at`)로 닫고 새로 넣는다.
 * 그래서 최신 CSV 가 항상 이긴다. 기한이 지난 라인은 런북 Ⓓ 가 닫는다.
 *
 *   bash scripts/sellmate/run.sh live load-inbound-from-csv <csv>            # dry-run
 *   bash scripts/sellmate/run.sh live load-inbound-from-csv <csv> --apply
 *   # 이어서 ③ (dry-run → --apply)
 *   MEDUSA_API_URL=... MEDUSA_API_KEY=... bash scripts/sellmate/inbound-run.sh live sync-restock --apply
 *
 * 환경변수:
 *   DATABASE_URL   core 논리 DB (run.sh 가 주입)
 *   WAREHOUSE_ID   입고 창고 (기본: 부천 물류창고)
 */
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';

const TAG = 'sellmate-csv-inbound';
const BUCHEON_WAREHOUSE_ID = process.env.WAREHOUSE_ID || '019d0001-0001-7000-a000-000000000001';
const SCRIPT_ACTOR = '00000000-0000-0000-0000-000000000000';

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('사용: load-inbound-from-csv.ts <csv> [--apply]');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');

  const [header, ...rows] = await readRows(file);
  const col = detectColumns(header, {
    itemCode: ['옵션정보일련번호'],
    inboundDate: ['입고예정일'],
    name: ['상품명'],
  });
  if (col.itemCode < 0 || col.inboundDate < 0) {
    throw new Error('CSV 에 옵션정보일련번호 / 입고예정일 열이 없습니다 — 셀메이트 다운로드 양식에 입고예정일을 추가하세요.');
  }

  // KST 기준 오늘. ③ 이 `expected_arrival >= CURRENT_DATE` 만 후보로 보므로 지난 날짜는 넣어도 안 보인다.
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const want = new Map<string, { date: string; name: string }>();
  let past = 0;
  const bad: string[] = [];
  for (const r of rows) {
    const date = (r[col.inboundDate] ?? '').trim();
    if (!date) continue;
    const code = (r[col.itemCode] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      bad.push(`${code}="${date}"`);
      continue;
    }
    if (date < today) {
      past++;
      continue;
    }
    const prev = want.get(code);
    if (!prev || date < prev.date) want.set(code, { date, name: r[col.name] ?? '' });
  }
  console.log(`📄 입고예정: 오늘(${today}) 이후 ${want.size}품목 | 지난 날짜 ${past} | 형식오류 ${bad.length}`);
  if (bad.length) throw new Error(`입고예정일 형식 오류(YYYY-MM-DD 만 허용): ${bad.slice(0, 10).join(', ')}`);
  if (want.size === 0) {
    console.log('✅ 넣을 입고예정 없음.');
    return;
  }

  const sql: Sql = postgres(url, { max: 1 });
  try {
    const codes = [...want.keys()];
    const idByCode = new Map<string, string>();
    for (const part of chunk(codes, 1000)) {
      for (const r of await sql<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE code IN ${sql(part)}`) {
        idByCode.set(r.code, r.id);
      }
    }
    const missing = codes.filter((c) => !idByCode.has(c));
    const skuIds = [...idByCode.values()];
    let matched = 0;
    for (const part of chunk(skuIds, 1000)) {
      const [m] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT sku_id)::int AS n FROM product_variant_sku_links WHERE sku_id IN ${sql(part)}`;
      matched += m.n;
    }
    const [prevOpen] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.po_id
       WHERE po.audit_notes LIKE ${TAG + '%'} AND pol.status = 'ordered' AND pol.closed_at IS NULL`;

    console.log(`🔗 core SKU ${skuIds.length}개 (판매상품 매칭 ${matched} — 스토어프론트 표시 대상) | core 에 없음 ${missing.length}`);
    if (missing.length) console.log(`   없음: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''} (import-products 먼저)`);
    console.log(`♻️  이전 ${TAG} 미종결 라인 ${prevOpen.n}개 → 잔량 포기로 닫고 교체`);

    if (!apply) {
      console.log('\n✅ DRY-RUN 종료 — DB 미반영. 적용하려면 --apply');
      return;
    }

    const poId = await sql.begin(async (txRaw) => {
      // postgres TransactionSql 는 Omit 기반이라 호출 시그니처가 사라진다(TS 한계) → 호출 가능한 Sql 로 취급.
      const tx = txRaw as unknown as Sql;
      await tx`
        UPDATE purchase_order_lines pol
           SET closed_at = now(), closed_reason = ${TAG + ': superseded by newer CSV'}, closed_by = ${SCRIPT_ACTOR}
          FROM purchase_orders po
         WHERE po.id = pol.po_id AND po.audit_notes LIKE ${TAG + '%'}
           AND pol.status = 'ordered' AND pol.closed_at IS NULL`;
      const [po] = await tx<{ id: string }[]>`
        INSERT INTO purchase_orders
          (type, status, source_warehouse_id, destination_warehouse_id, requires_transfer, audit_status, audited_at, audit_notes)
        VALUES ('domestic', 'confirmed', ${BUCHEON_WAREHOUSE_ID}, ${BUCHEON_WAREHOUSE_ID}, false, 'approved', now(),
                ${`${TAG} ${file.split('/').pop()}`})
        RETURNING id`;
      const now = new Date();
      const lines = [...want].flatMap(([code, { date }]) => {
        const skuId = idByCode.get(code);
        return skuId
          ? [{ po_id: po.id, sku_id: skuId, quantity: 1, status: 'ordered', ordered_qty: 1, expected_arrival: date, ordered_at: now }]
          : [];
      });
      for (const part of chunk(lines, 500)) await tx`INSERT INTO purchase_order_lines ${tx(part)}`;
      return po.id;
    });

    console.log(`✅ 발주 ${poId} 생성, 라인 ${skuIds.length}개`);
    console.log('\n★ 이어서 ③ 으로 Medusa 반영 (dry-run → --apply):');
    console.log('   MEDUSA_API_URL=... MEDUSA_API_KEY=... bash scripts/sellmate/inbound-run.sh live sync-restock');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('❌ 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
