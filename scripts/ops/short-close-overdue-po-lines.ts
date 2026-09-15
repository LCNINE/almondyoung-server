/**
 * 일회성 정리 — 기한이 지난 미수령 발주 라인을 **잔량 포기**로 종결한다.
 *
 * 배경: 실물 입고는 셀메이트에서 하고 core 발주 수령 경로(`POST …/receipts`)는 거의 쓰지 않는다.
 * 그래서 발주 라인이 `ordered` · `closed_at IS NULL` · `received_qty = 0` 인 채 영원히 남는다.
 * 2026-09-15 live 실측 2,257라인 / 발주 152건 / 미수령 310,259개, **전부 부분입고조차 없음**.
 *
 * 취소(`cancelPurchaseOrder`)가 아니라 잔량 포기를 쓰는 이유: 취소는 발주 자체를 없던 일로
 * 만들지만, 잔량 포기는 발주와 라인을 남기고 "안 들어옴" 으로 닫는다 — 이력이 보존된다.
 *
 * 쓰기는 `PurchaseOrderReceivingManager.shortCloseLine` 과 같다
 * (`closed_reason`/`closed_at`/`closed_by` 설정 → 헤더 상태 재파생).
 * 헤더 파생은 도메인의 `deriveHeaderStatus` 를 **그대로 import** 한다 — 규칙을 베끼지 않는다.
 *
 * 거부 조건도 도메인과 같다: 취소된 발주 · `requested`/`unavailable` 라인 · 이미 닫힌 라인 ·
 * 남은 수량 0 인 라인은 건너뛴다.
 *
 * 사용법:
 *   npx tsx scripts/ops/short-close-overdue-po-lines.ts          # 조회만 (기본)
 *   npx tsx scripts/ops/short-close-overdue-po-lines.ts --apply  # 실제 종결
 *
 * ENV: DATABASE_URL (core 논리 DB), CLOSED_BY (감사 주체 userId, 필수)
 */
import postgres, { Sql } from 'postgres';
import {
  deriveHeaderStatus,
  isDerivationFrozen,
  outstandingQty,
  type LineSettlement,
  type PurchaseOrderLineStatus,
  type PurchaseOrderStatus,
} from '../../apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules';

const APPLY = process.argv.includes('--apply');
const REASON =
  '기한 경과 미수령 — scripts/ops/short-close-overdue-po-lines.ts 로 일괄 잔량 포기 (실물 입고는 셀메이트에서 처리)';

type LineRow = LineSettlement & { po_id: string; sku_id: string; expected_arrival: string | null };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 이 필요합니다 (core 논리 DB)');
  // 조회만 할 땐 감사 주체가 필요 없다 — dry-run 문턱을 낮춘다. (실제 확인은 dry-run 분기 뒤)
  if (APPLY && !process.env.CLOSED_BY) throw new Error('CLOSED_BY 가 필요합니다 (감사 주체 userId, uuid)');

  const sql = postgres(url, { max: 1, connect_timeout: 60 });
  try {
    // 대상: 기한 지난 ordered 라인 중 남은 수량이 있고 아직 안 닫힌 것. 취소된 발주는 제외.
    const targets = await sql<LineRow[]>`
      SELECT pol.po_id, pol.sku_id, pol.status, pol.ordered_qty AS "orderedQty",
             pol.received_qty AS "receivedQty", pol.closed_at AS "closedAt",
             pol.expected_arrival::text AS expected_arrival
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.po_id
       WHERE pol.status = 'ordered'
         AND pol.closed_at IS NULL
         AND pol.received_qty < COALESCE(pol.ordered_qty, 0)
         AND po.status <> 'cancelled'
         AND pol.expected_arrival < CURRENT_DATE
       ORDER BY pol.po_id, pol.sku_id`;

    const remaining = targets.reduce((sum, l) => sum + outstandingQty(l), 0);
    const poIds = [...new Set(targets.map((l) => l.po_id))];
    console.log(`📋 대상 라인 ${targets.length}건 · 발주 ${poIds.length}건 · 미수령 ${remaining.toLocaleString()}개`);
    if (targets.length === 0) return;

    const partial = targets.filter((l) => l.receivedQty > 0);
    console.log(`   부분입고 있는 라인: ${partial.length}건 (남은 수량만 포기된다)`);

    if (!APPLY) {
      for (const l of targets.slice(0, 10)) {
        console.log(`   PLAN po=${l.po_id} sku=${l.sku_id} 예정 ${l.expected_arrival} 남은 ${outstandingQty(l)}개`);
      }
      if (targets.length > 10) console.log(`   … 외 ${targets.length - 10}건`);
      console.log('🔍 DRY-RUN — DB 미반영. --apply 로 실제 종결.');
      return;
    }

    const closedBy = process.env.CLOSED_BY;
    if (!closedBy) throw new Error('CLOSED_BY 가 필요합니다 (감사 주체 userId, uuid)');

    // 도메인과 같은 잠금 순서: 발주 행 → 라인(sku_id 오름차순). 전체를 한 트랜잭션으로 묶는다.
    //
    // ⚠️ 위 `targets` 는 **잠그기 전에** 읽은 스냅샷이다. 잠근 뒤 상태를 다시 보지 않으면
    // 그 사이 취소된 발주의 라인을 닫고, 파생 결과로 `cancelled` 를 덮어써 **취소된 발주를
    // 되살린다.** 도메인(`shortCloseLine`)이 잠근 직후 취소를 거부하고 `isDerivationFrozen` 으로
    // 파생을 막는 이유가 이것이다 — 여기서도 똑같이 한다.
    const result = await sql.begin(async (trxRaw) => {
      // postgres.js 의 트랜잭션 타입은 태그드 템플릿 제네릭을 안 받는다 — 기존 ops 스크립트와
      // 같은 캐스팅을 쓴다 (scripts/sellmate/clear-reservations.ts:145). 런타임 표현은 동일하다.
      const trx = trxRaw as unknown as Sql;
      const statusCount: Record<string, number> = {};
      let closedLines = 0;
      let skippedPos = 0;

      for (const poId of poIds) {
        const [locked] = await trx<{ status: PurchaseOrderStatus }[]>`
          SELECT status FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
        if (!locked) {
          skippedPos++; // 잠그는 사이 사라진 발주
          continue;
        }
        if (isDerivationFrozen(locked.status)) {
          skippedPos++; // 취소된 발주 — 라인도 건드리지 않는다
          continue;
        }

        const skuIds = targets.filter((l) => l.po_id === poId).map((l) => l.sku_id);
        // 라인 조건 **전부**를 잠금 이후 기준으로 다시 건다 — 그 사이 입고·포기된 라인은 빠진다.
        // `expected_arrival` 도 반드시 포함한다: 스냅샷 이후 `PATCH …/expected-arrival` 로
        // 예정일이 미래로 밀린 라인은 더 이상 "기한 경과" 가 아니므로 닫으면 안 된다.
        // 대상을 정의하는 조건을 재검증에서 빼면 스냅샷 재확인 자체가 무의미해진다.
        const closed = await trx<{ sku_id: string }[]>`
          UPDATE purchase_order_lines
             SET closed_reason = ${REASON}, closed_at = now(), closed_by = ${closedBy}
           WHERE po_id = ${poId} AND sku_id = ANY(${skuIds})
             AND status = 'ordered' AND closed_at IS NULL
             AND received_qty < COALESCE(ordered_qty, 0)
             AND expected_arrival < CURRENT_DATE
          RETURNING sku_id`;
        closedLines += closed.length;

        const lines = await trx<
          { status: PurchaseOrderLineStatus; orderedQty: number | null; receivedQty: number; closedAt: Date | null }[]
        >`
          SELECT status, ordered_qty AS "orderedQty", received_qty AS "receivedQty", closed_at AS "closedAt"
            FROM purchase_order_lines WHERE po_id = ${poId}`;
        const next = deriveHeaderStatus(lines);
        if (locked.status !== next) {
          await trx`UPDATE purchase_orders SET status = ${next}, updated_at = now() WHERE id = ${poId}`;
        }
        statusCount[next] = (statusCount[next] ?? 0) + 1;
      }
      return { statusCount, closedLines, skippedPos };
    });

    console.log(`✅ 잔량 포기 ${result.closedLines}건 종결 · 발주 ${poIds.length - result.skippedPos}건 헤더 재파생`);
    if (result.closedLines !== targets.length) {
      console.log(
        `   ⚠️ 계획 ${targets.length}건 중 ${targets.length - result.closedLines}건은 잠금 이후 조건이 바뀌어 건너뜀`,
      );
    }
    if (result.skippedPos > 0) console.log(`   ⚠️ 취소·소멸로 건너뛴 발주: ${result.skippedPos}건`);
    for (const [status, n] of Object.entries(result.statusCount)) console.log(`   헤더 → ${status}: ${n}건`);
  } finally {
    await sql.end();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
