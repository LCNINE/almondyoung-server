/**
 * K6 PR 1 백필 — PR 1 배포(`migrate → deploy`) **뒤 한 번**.
 *
 * 라인 행이 없는 옛 판매주문 취소를 주문별로 시간순 재생해 `sales_order_cancellation_lines` 를 채운다.
 * 해석이 모호한 주문(metadata 형식 불량·도출 실패)은 한 행도 쓰지 않고 목록만 찍는다 — 사람이 판단한다.
 * 이미 라인 행이 있는 취소(배포 뒤 새 취소)는 건드리지 않고 수량만 prior 로 센다. `ON CONFLICT DO NOTHING` 이라 다시 돌려도 안전하다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/k6-backfill-cancellation-lines.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/k6-backfill-cancellation-lines.ts --apply  # 실제 쓰기
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/k6-backfill-cancellation-lines.ts --verify # 대조(읽기 전용)
 * --verify: 취소가 전부 라인 행을 가진 주문마다 metadata/effects 로 다시 도출해 저장된 행과 비교한다. 어긋난 주문 0 이 기대값.
 * 로컬 스모크: DATABASE_URL=postgresql://… npx tsx scripts/ops/k6-backfill-cancellation-lines.ts
 */
import postgres from 'postgres';
import { isDigitalFulfillmentLine } from '../../apps/core/src/modules/product-matching/line-composition/line-composition';
import { BackfillCancellation, diffDerivedWithStored, planOrderBackfill } from './k6-cancellation-lines-backfill';

const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

type CancellationRow = {
  id: string;
  salesOrderId: string;
  scope: 'full' | 'partial';
  metadata: unknown;
  effects: unknown;
  occurredAt: Date;
};
type LineRow = {
  id: string;
  salesOrderId: string;
  quantity: number;
  fulfillmentKind: string | null;
  requiresShipping: boolean | null;
};
type ExistingRow = { cancellationId: string; salesOrderLineId: string; shipmentPhase: string; quantity: number };

function connect(): postgres.Sql {
  if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 30 });
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 기존 ops 스크립트와 같은 이유로 캐스팅한다.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Resource } = require('sst') as { Resource: unknown };
  const Db = (Resource as { Db: { host: string; port: number; username: string; password: string } }).Db;
  return postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

async function main() {
  const sql = connect();
  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    const cancellations = await sql<CancellationRow[]>`
      SELECT id, sales_order_id AS "salesOrderId", cancellation_scope AS scope, metadata, effects, occurred_at AS "occurredAt"
      FROM sales_order_cancellations ORDER BY sales_order_id, occurred_at, id`;
    const orderIds = [...new Set(cancellations.map((c) => c.salesOrderId))];
    const lineRows =
      orderIds.length === 0
        ? []
        : await sql<LineRow[]>`
            SELECT id, sales_order_id AS "salesOrderId", quantity,
                   fulfillment_kind AS "fulfillmentKind", requires_shipping AS "requiresShipping"
            FROM sales_order_lines WHERE sales_order_id = ANY(${orderIds}::uuid[])`;
    const existing =
      orderIds.length === 0
        ? []
        : await sql<ExistingRow[]>`
            SELECT cancellation_id AS "cancellationId", sales_order_line_id AS "salesOrderLineId",
                   shipment_phase AS "shipmentPhase", quantity
            FROM sales_order_cancellation_lines WHERE sales_order_id = ANY(${orderIds}::uuid[])`;

    const linesByOrder = groupBy(lineRows, (l) => l.salesOrderId);
    const existingByCancellation = groupBy(existing, (e) => e.cancellationId);
    const cancellationsByOrder = groupBy(cancellations, (c) => c.salesOrderId);

    if (VERIFY) {
      let checked = 0;
      let skipped = 0;
      const mismatched: Array<{ orderId: string; diffs: string[] }> = [];
      for (const [orderId, orderCancellations] of cancellationsByOrder) {
        if (orderCancellations.some((c) => (existingByCancellation.get(c.id) ?? []).length === 0)) {
          skipped += 1; // 라인 행 없는 취소가 있는 주문(ambiguous·0행 도출)은 대조 대상이 아니다
          continue;
        }
        checked += 1;
        const lines = (linesByOrder.get(orderId) ?? []).map((l) => ({
          id: l.id,
          quantity: l.quantity,
          isDigital: isDigitalFulfillmentLine(l),
        }));
        const input: BackfillCancellation[] = orderCancellations.map((c) => ({
          id: c.id,
          scope: c.scope,
          metadata: c.metadata,
          effects: c.effects,
          occurredAt: c.occurredAt,
          existingLines: [], // 저장된 행을 무시하고 옛 기록에서 다시 도출한다
        }));
        const plan = planOrderBackfill(lines, input);
        if (plan.kind === 'ambiguous') {
          mismatched.push({ orderId, diffs: [`재도출 불가 (취소 ${plan.cancellationId}): ${plan.reason}`] });
          continue;
        }
        const stored = orderCancellations.flatMap((c) => existingByCancellation.get(c.id) ?? []);
        const diffs = diffDerivedWithStored(plan.inserts, stored);
        if (diffs.length > 0) mismatched.push({ orderId, diffs });
      }
      console.log(`대조 ${checked}주문 · 건너뜀(라인 행 없는 취소 있음) ${skipped} · 어긋난 주문 ${mismatched.length} (기대 0)`);
      for (const m of mismatched) for (const d of m.diffs) console.log(`  mismatch\t주문 ${m.orderId}\t${d}`);
      if (mismatched.length > 0) process.exitCode = 1;
      return;
    }

    let okOrders = 0;
    let cancellationsInAmbiguousOrders = 0;
    let cancellationsDerivedToZeroLines = 0;
    let rowsToInsert = 0;
    const ambiguous: Array<{ orderId: string; cancellationId: string; reason: string }> = [];
    const writes: Array<{
      orderId: string;
      inserts: { cancellationId: string; salesOrderLineId: string; quantity: number; shipmentPhase: string }[];
    }> = [];

    for (const [orderId, orderCancellations] of cancellationsByOrder) {
      const lines = (linesByOrder.get(orderId) ?? []).map((l) => ({
        id: l.id,
        quantity: l.quantity,
        isDigital: isDigitalFulfillmentLine(l),
      }));
      const input: BackfillCancellation[] = orderCancellations.map((c) => ({
        id: c.id,
        scope: c.scope,
        metadata: c.metadata,
        effects: c.effects,
        occurredAt: c.occurredAt,
        existingLines: (existingByCancellation.get(c.id) ?? []).map((e) => ({
          salesOrderLineId: e.salesOrderLineId,
          quantity: e.quantity,
        })),
      }));
      const plan = planOrderBackfill(lines, input);
      if (plan.kind === 'ambiguous') {
        ambiguous.push({ orderId, cancellationId: plan.cancellationId, reason: plan.reason });
        // 게이트 SQL(라인 행 없는 취소 수)이 세는 단위: 그 주문의 취소 중 아직 행이 없는 것
        cancellationsInAmbiguousOrders += orderCancellations.filter(
          (c) => (existingByCancellation.get(c.id) ?? []).length === 0,
        ).length;
        continue;
      }
      okOrders += 1;
      rowsToInsert += plan.inserts.length;
      const withInserts = new Set(plan.inserts.map((i) => i.cancellationId));
      cancellationsDerivedToZeroLines += orderCancellations.filter(
        (c) => (existingByCancellation.get(c.id) ?? []).length === 0 && !withInserts.has(c.id),
      ).length;
      if (plan.inserts.length > 0) writes.push({ orderId, inserts: plan.inserts });
    }

    console.log(
      `취소가 있는 주문 ${cancellationsByOrder.size} · ok ${okOrders} · 넣을 행 ${rowsToInsert} · ambiguous ${ambiguous.length} (ambiguous 는 쓰지 않는다)`,
    );
    console.log(
      `게이트 SQL 기대값 = (a) ambiguous 주문에 속한 취소 ${cancellationsInAmbiguousOrders} + (b) 라인 0개로 도출된 취소 ${cancellationsDerivedToZeroLines} = ${cancellationsInAmbiguousOrders + cancellationsDerivedToZeroLines}`,
    );
    for (const a of ambiguous) console.log(`  ambiguous\t주문 ${a.orderId}\t취소 ${a.cancellationId}\t${a.reason}`);

    if (!APPLY) return;

    let written = 0;
    for (const { orderId, inserts } of writes) {
      await sql.begin(async (trx) => {
        // postgres.js 의 TransactionSql 은 Omit 으로 호출 시그니처를 잃는다(타입 결함) — 런타임은 Sql 과 같다
        const tx = trx as unknown as postgres.Sql;
        for (const row of inserts) {
          await tx`
            INSERT INTO sales_order_cancellation_lines (cancellation_id, sales_order_id, sales_order_line_id, quantity, shipment_phase)
            VALUES (${row.cancellationId}, ${orderId}, ${row.salesOrderLineId}, ${row.quantity}, ${row.shipmentPhase})
            ON CONFLICT (cancellation_id, sales_order_line_id, shipment_phase) DO NOTHING`;
        }
      });
      written += inserts.length;
    }
    console.log(`\n처리한 행 ${written} / ${rowsToInsert} (이미 있던 행은 건너뜀)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
