/**
 * 셀메이트 재고 CSV → core 입고예정(inbound_plans) 대량 등록
 *
 * core 모델상 입고예정은 발주(purchase_order)의 산물이라 PO 를 동반 생성한다
 * (inbound_plans.linked_purchase_order_id 가 NOT NULL FK). 중국 공급처 = 해외라
 * source(중국)+destination(부천) 2-plan 으로 들어간다.
 * values 정답 레퍼런스: purchase-order.service.ts createInboundPlanFromPO.
 *
 * 실행 (sst tunnel 필요):
 *   CORE_DB_URL="postgresql://<user>:<pw>@<host>:5432/core?sslmode=require" \
 *     npx ts-node -r tsconfig-paths/register apps/core/scripts/import-inbound-plans.ts <csv> [--apply]
 *
 * 기본은 dry-run: 전 과정 insert 후 ROLLBACK + 리포트만 (데이터 0건 남음).
 * --apply 로 실제 커밋.
 *
 * 입력: 셀메이트 재고 CSV (EUC-KR). 사용 컬럼: 바코드번호(서식), 입고예정일, 입고예정수량.
 */
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as Papa from 'papaparse';
import * as postgresNs from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

// postgres.js 는 CJS/ESM interop 에 따라 default 위치가 갈린다 (extract-core-snapshots 와 동일 처리)
const postgres = ((postgresNs as any).default ?? postgresNs) as typeof import('postgres');
import { sql, inArray, and, eq } from 'drizzle-orm';
import { wmsTables, wmsSchema } from '../src/modules/inventory/schema/inventory.schema';

// 창고 (lcnine-services, dev/live 동일 시드)
const SRC_WAREHOUSE = '019d0001-0002-7000-a000-000000000002'; // 중국 물류창고 (overseas)
const DST_WAREHOUSE = '019d0001-0001-7000-a000-000000000001'; // 부천 물류창고 (domestic)

// 셀메이트/DB 바코드는 `="11377120000"` 엑셀서식으로 저장돼 있어 숫자만 추출해 매칭한다.
const onlyDigits = (s: string): string => (s ?? '').replace(/[^0-9]/g, '');

// "2026-07-01" / "2026.7.1" / "2026-07-01 오후 4:21:00" → Date(자정). 빈 값이면 null.
function parseDate(raw: string): Date | null {
  const m = (raw ?? '').match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

interface Row {
  barcode: string; // 정규화된 숫자
  expectedDate: Date;
  expectedQty: number;
}

function parseCsv(path: string): { rows: Row[]; skipped: number } {
  const buf = fs.readFileSync(path);
  const text = iconv.decode(buf, 'euc-kr');
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  const rows: Row[] = [];
  let skipped = 0;
  for (const r of parsed.data) {
    const barcode = onlyDigits(r['바코드번호(서식)'] ?? r['바코드번호'] ?? '');
    const expectedDate = parseDate(r['입고예정일'] ?? '');
    const expectedQty = parseInt(onlyDigits(r['입고예정수량'] ?? ''), 10);
    // 입고예정 정보가 없는 행은 등록 대상 아님 (단순 재고행)
    if (!barcode || !expectedDate || !expectedQty) {
      skipped++;
      continue;
    }
    rows.push({ barcode, expectedDate, expectedQty });
  }
  return { rows, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) throw new Error('usage: import-inbound-plans.ts <csv> [--apply]');
  if (!process.env.CORE_DB_URL) throw new Error('CORE_DB_URL is required');

  const { rows, skipped } = parseCsv(csvPath);
  console.log(`📄 CSV: ${rows.length} 입고예정행 (입고예정 없는 행 ${skipped}개 제외)`);
  if (!rows.length) return;

  const client = postgres(process.env.CORE_DB_URL, { max: 1, idle_timeout: 20, connect_timeout: 60 });
  const db = drizzle(client, { schema: wmsSchema });

  let poCount = 0;
  let planCount = 0;
  let itemCount = 0;
  let skippedDup = 0;

  try {
    // 1) 바코드 → sku_id (숫자정규화 양쪽). 한 바코드가 여러 sku 면 첫 행 — 운영상 UNIQUE.
    const codes = [...new Set(rows.map((r) => r.barcode))];
    const mapped = await db
      .select({
        norm: sql<string>`regexp_replace(${wmsTables.skuBarcodes.barcode}, '[^0-9]', '', 'g')`,
        skuId: wmsTables.skuBarcodes.skuId,
      })
      .from(wmsTables.skuBarcodes)
      .where(inArray(sql`regexp_replace(${wmsTables.skuBarcodes.barcode}, '[^0-9]', '', 'g')`, codes));

    const skuByBarcode = new Map(mapped.map((m) => [m.norm, m.skuId]));
    const missing = codes.filter((c) => !skuByBarcode.has(c));
    console.log(`🔗 매핑: ${codes.length - missing.length}/${codes.length} 성공, 실패 ${missing.length}건`);
    if (missing.length) console.log(`   ❌ 미매핑 바코드: ${missing.join(', ')}`);

    // 등록 대상 = 매핑된 행만, (입고예정일 → [{skuId, qty}]) 그룹핑 (날짜=PO 단위)
    const groups = new Map<string, { date: Date; items: { skuId: string; qty: number }[] }>();
    for (const r of rows) {
      const skuId = skuByBarcode.get(r.barcode);
      if (!skuId) continue;
      const key = r.expectedDate.toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, { date: r.expectedDate, items: [] });
      groups.get(key)!.items.push({ skuId, qty: r.expectedQty });
    }

    await db.transaction(async (tx) => {
      for (const { date, items } of groups.values()) {
        // 멱등성: 같은 (sku, 예정일) 로 pending plan 이 이미 있으면 그 sku 제외
        const skuIds = items.map((i) => i.skuId);
        const existing = await tx
          .select({ skuId: wmsTables.inboundPlanItems.skuId })
          .from(wmsTables.inboundPlanItems)
          .innerJoin(wmsTables.inboundPlans, eq(wmsTables.inboundPlanItems.planId, wmsTables.inboundPlans.id))
          .where(
            and(
              inArray(wmsTables.inboundPlanItems.skuId, skuIds),
              eq(wmsTables.inboundPlans.expectedDate, date),
              eq(wmsTables.inboundPlanItems.status, 'pending'),
            ),
          );
        const dupSkus = new Set(existing.map((e) => e.skuId));
        const fresh = items.filter((i) => !dupSkus.has(i.skuId));
        skippedDup += items.length - fresh.length;
        if (!fresh.length) continue;

        // 2) PO (해외, supplier 없이 source/dest 명시). status=confirmed+approved 로 박아
        //    추후 누가 confirm 해도 createInboundPlanFromPO 가 재호출돼 plan 중복되는 걸 차단.
        const [po] = await tx
          .insert(wmsTables.purchaseOrders)
          .values({
            type: 'foreign',
            supplierId: null,
            sourceWarehouseId: SRC_WAREHOUSE,
            destinationWarehouseId: DST_WAREHOUSE,
            requiresTransfer: true,
            expectedArrival: date,
            status: 'confirmed',
            auditStatus: 'approved',
          })
          .returning();
        poCount++;

        await tx
          .insert(wmsTables.purchaseOrderLines)
          .values(fresh.map((i) => ({ poId: po.id, skuId: i.skuId, quantity: i.qty, unitPrice: null })));

        // 3) 해외 2-plan (source: 예정일 / destination: 이동완료 후라 null, parent=source)
        const [sourcePlan] = await tx
          .insert(wmsTables.inboundPlans)
          .values({
            warehouseId: SRC_WAREHOUSE,
            planType: 'source',
            linkedPurchaseOrderId: po.id,
            destinationWarehouseId: DST_WAREHOUSE,
            requiresTransfer: true,
            expectedDate: date,
            status: 'pending',
          })
          .returning();
        const [destPlan] = await tx
          .insert(wmsTables.inboundPlans)
          .values({
            warehouseId: DST_WAREHOUSE,
            planType: 'destination',
            parentPlanId: sourcePlan.id,
            linkedPurchaseOrderId: po.id,
            destinationWarehouseId: DST_WAREHOUSE,
            requiresTransfer: false,
            expectedDate: null,
            status: 'pending',
          })
          .returning();
        planCount += 2;

        const mkItems = (planId: string) =>
          fresh.map((i) => ({ planId, skuId: i.skuId, expectedQty: i.qty, receivedQty: 0, status: 'pending' as const }));
        await tx.insert(wmsTables.inboundPlanItems).values([...mkItems(sourcePlan.id), ...mkItems(destPlan.id)]);
        itemCount += fresh.length * 2;
      }

      if (!apply) throw new RollbackSignal();
    });

    console.log(`✅ APPLIED — PO ${poCount}건 / plan ${planCount}건 / item ${itemCount}건 (중복 skip ${skippedDup}건)`);
  } catch (e) {
    if (e instanceof RollbackSignal) {
      console.log(
        `📊 생성 예정 — PO ${poCount}건 / plan ${planCount}건 / item ${itemCount}건 (중복 skip ${skippedDup}건)`,
      );
      console.log(`🔍 DRY-RUN (rolled back, 데이터 미반영) — --apply 로 커밋.`);
    } else {
      throw e;
    }
  } finally {
    await client.end();
  }
}

class RollbackSignal extends Error {}

// --- self-check (순수 로직만) ---
if (process.env.SELFTEST) {
  console.assert(onlyDigits('="11377120000"') === '11377120000', 'onlyDigits strip');
  console.assert(onlyDigits('1-0750920002') === '10750920002', 'onlyDigits dash');
  console.assert(parseDate('2026-07-01')?.getMonth() === 6, 'parseDate month');
  console.assert(parseDate('2026.7.1 오후 4:21')?.getDate() === 1, 'parseDate kr');
  console.assert(parseDate('') === null, 'parseDate empty');
  console.log('selftest ok');
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
