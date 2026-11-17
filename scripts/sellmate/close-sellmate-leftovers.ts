/**
 * 컷오버 드레인 끝 정리(#1243) — 셀메이트로 나간 자사몰 주문의 열린 출고주문·상자·예약·대기열 행을 닫는다.
 *
 * 왜: 셀메이트가 출고하는 동안 core 에는 판매주문은 나갔는데 출고주문은 열린 채, 대기열은 awaiting_matching 인 채
 * 남은 행이 쌓였다. 컷오버 뒤 이것들이 앱·admin-web 목록에 섞이면 작업자가 이미 나간 주문을 다시 본다.
 *
 * 경계 — 판매주문 상태(시각으로 자르지 않는다, 설계 §4):
 *   shipped·delivered (셀메이트 스크립트만 쓰는 값) → FO·상자·예약·대기열을 닫는다
 *   cancelled → 대기열만 닫는다(취소 경로가 부르는 그 명령). 열린 FO·상자는 리컨실러 몫이라 보고만
 *   그 밖 → 건드리지 않는다. 마켓 주문은 2단계(#1306) 몫이라 건드리지 않는다
 *
 * 상태를 바꾸는 새 SQL 은 없다. 쓰는 것: mark-core-shipped.sql.js 의 FO·FOI 문장, close-shipped-shipments 의 종결 문장
 * (대상 주문으로 좁힌 CTE), FulfillmentOrderCreationBacklogService.closeOpenForSalesOrder, markLineStateDirty(#1247 투영),
 * 예약을 푼 SKU 의 판매가능수량 재계산.
 *
 * 실행 시점: 드레인 끝 — mark-shipped-from-csv · mark-core-shipped · mark-medusa-shipped 를 마지막으로 돌린 뒤.
 * ⚠️ 컷오버 시각 T 뒤에는 close-shipped-shipments 를 단독으로 돌리지 않는다(앱이 맡은 취소 주문의 상자까지 닫는다).
 * 이 스크립트가 그 일을 대상 주문으로 좁혀 대신한다.
 *
 * 기본은 dry-run — 같은 경로를 끝까지 돌린 뒤 롤백해서 정확한 건수를 낸다. 반드시 먼저 본다.
 *   bash scripts/sellmate/run.sh live close-sellmate-leftovers
 *   bash scripts/sellmate/run.sh live close-sellmate-leftovers --apply
 * 다시 돌려도 된다 — 닫힌 행은 다음 실행의 대상이 아니다.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SQL, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { FulfillmentOrderCreationBacklogService } from '../../apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { markLineStateDirty } from '../../apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { outboxPublisherFor } from '../../apps/core/src/modules/fulfillment/outbox/__support__/outbox-publisher.factory';
import { classifyLeftover, LeftoverAction, LeftoverOrder } from './leftovers-plan';
import { SCOPED_CLOSEOUT_CTE, closeoutStatements } from './close-shipped-shipments';

// mark-core-shipped.js 가 pg 로 그대로 쓰는 CJS 문장 모듈이라 require 로 읽는다(mark-core-shipped.integration.spec.ts 와 같다).
type MarkSql = { MARK_FULFILLMENT_ORDERS_SHIPPED: string; MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const markSql = require('../ops/cellmate-local/mark-core-shipped.sql.js') as MarkSql;

const CHUNK = 200;
const PLACEHOLDER = '$1::text[]';

/** 기존 스크립트의 `$1::text[]` 자리마다 배열 파라미터 하나를 묶는다. 자리가 없으면 그 문장이 바뀐 것이니 던진다. */
export function bindTextArrayParam(text: string, ids: readonly string[]): SQL {
  const parts = text.split(PLACEHOLDER);
  if (parts.length < 2) throw new Error(`문장에 ${PLACEHOLDER} 자리가 없다 — 기존 스크립트 문장이 바뀌었다`);
  const chunks: SQL[] = [];
  parts.forEach((part, i) => {
    chunks.push(sql.raw(part));
    if (i < parts.length - 1) chunks.push(sql`${sql.param([...ids])}::text[]`);
  });
  return sql.join(chunks);
}

export type LeftoverReport = {
  closedFo: number;
  closedShipments: number;
  releasedReservations: number;
  closedBacklogs: number;
  releasedSkuIds: string[];
  /** channel_order_id */
  humanFo: string[];
  cancelledOpen: string[];
  /** shipment id */
  recoveryShipments: string[];
  activeWorkShipments: string[];
  /** null = sellmate_handed_over_orders 가 비었다(저녁 맞추기 init 전) */
  drainIncomplete: number | null;
};

type Deps = {
  backlog: Pick<FulfillmentOrderCreationBacklogService, 'closeOpenForSalesOrder'>;
  sellable: Pick<ProductSellableQuantityService, 'recalculateAndPublishForSkus'>;
};

type Planned = LeftoverOrder & { action: LeftoverAction };

class DryRunRollback extends Error {}

async function readCandidates(dbService: DbService<typeof wmsSchema>): Promise<LeftoverOrder[]> {
  const rows = await dbService.db.execute<{
    sales_order_id: string;
    channel_order_id: string;
    sales_channel: string;
    so_status: string;
    fo_status: string | null;
    open_backlogs: number;
    open_shipments: number;
  }>(sql`
    SELECT * FROM (
      SELECT so.id AS sales_order_id, so.channel_order_id, so.sales_channel::text AS sales_channel,
             so.status::text AS so_status, fo.status::text AS fo_status,
             (SELECT count(*) FROM fulfillment_order_creation_backlogs b
               WHERE b.sales_order_id = so.id
                 AND b.status IN ('pending','failed','processing','awaiting_matching'))::int AS open_backlogs,
             (SELECT count(DISTINCT s.id) FROM shipments s
                JOIN shipment_lines sl ON sl.shipment_id = s.id
                JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
               WHERE foi.fulfillment_order_id = fo.id
                 AND s.status IN ('draft','planned','recovery_required'))::int AS open_shipments
        FROM sales_orders so
        LEFT JOIN fulfillment_orders fo ON fo.sales_order_id = so.id
       WHERE so.sales_channel = 'medusa' AND so.status IN ('shipped','delivered','cancelled')
    ) c
    WHERE (c.fo_status IS NOT NULL AND c.fo_status NOT IN ('shipped','completed','canceled'))
       OR c.open_backlogs > 0 OR c.open_shipments > 0
    ORDER BY c.sales_order_id`);
  return rows.map((r) => ({
    salesOrderId: r.sales_order_id,
    channelOrderId: r.channel_order_id,
    salesChannel: r.sales_channel,
    soStatus: r.so_status,
    foStatus: r.fo_status,
    openBacklogs: Number(r.open_backlogs),
    openShipments: Number(r.open_shipments),
  }));
}

async function readDrainIncomplete(dbService: DbService<typeof wmsSchema>): Promise<number | null> {
  const [row] = await dbService.db.execute<{ total: number; open: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE so.status::text NOT IN ('shipped','delivered','cancelled'))::int AS open
      FROM sellmate_handed_over_orders h JOIN sales_orders so ON so.id = h.sales_order_id`);
  return Number(row.total) === 0 ? null : Number(row.open);
}

type ChunkResult = Pick<
  LeftoverReport,
  | 'closedFo'
  | 'closedShipments'
  | 'releasedReservations'
  | 'closedBacklogs'
  | 'releasedSkuIds'
  | 'recoveryShipments'
  | 'activeWorkShipments'
>;

async function closeChunk(tx: DbTx, deps: Deps, chunk: Planned[]): Promise<ChunkResult> {
  const result: ChunkResult = {
    closedFo: 0,
    closedShipments: 0,
    releasedReservations: 0,
    closedBacklogs: 0,
    releasedSkuIds: [],
    recoveryShipments: [],
    activeWorkShipments: [],
  };

  // ① 출고주문 — 상자 종결의 HAVING 이 FO terminal 을 보므로 먼저 닫는다
  const foChannelIds = chunk.filter((o) => o.action.closeFo).map((o) => o.channelOrderId);
  if (foChannelIds.length > 0) {
    const fo = await tx.execute(bindTextArrayParam(markSql.MARK_FULFILLMENT_ORDERS_SHIPPED, foChannelIds));
    await tx.execute(bindTextArrayParam(markSql.MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED, foChannelIds));
    result.closedFo = fo.count;
  }

  // ② 상자·예약 — 대상 주문으로 좁힌 종결 문장
  const scope = chunk.filter((o) => o.action.closeShipments).map((o) => o.salesOrderId);
  if (scope.length > 0) {
    await tx.execute(sql.raw('CREATE TEMP TABLE leftover_scope (sales_order_id uuid) ON COMMIT DROP'));
    await tx.execute(sql`INSERT INTO leftover_scope SELECT unnest(${sql.param(scope)}::uuid[])`);
    const skipped = await tx.execute<{ id: string; status: string; active: boolean }>(sql`
      SELECT DISTINCT s.id, s.status::text AS status,
             EXISTS (SELECT 1 FROM outbound_batch_work_items wi
                      WHERE wi.shipment_id = s.id AND wi.status NOT IN ('excluded','completed')) AS active
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
       WHERE fo.sales_order_id IN (SELECT sales_order_id FROM leftover_scope)
         AND s.status IN ('draft','planned','recovery_required')`);
    for (const s of skipped) {
      if (s.status === 'recovery_required') result.recoveryShipments.push(s.id);
      else if (s.active) result.activeWorkShipments.push(s.id);
    }
    for (const statement of closeoutStatements(SCOPED_CLOSEOUT_CTE)) await tx.execute(sql.raw(statement));
    const [closed] = await tx.execute<{ n: number }>(sql.raw('SELECT count(*)::int AS n FROM closeout'));
    const released = await tx.execute<{ sku_id: string }>(sql.raw('SELECT sku_id FROM closeout_reservation'));
    result.closedShipments = Number(closed.n);
    result.releasedReservations = released.length;
    result.releasedSkuIds = [...new Set(released.map((r) => r.sku_id))];
    // ON COMMIT DROP 은 바깥 트랜잭션 끝에야 지운다 — 다음 묶음(또는 중첩 트랜잭션 안의 재실행)이 같은 이름을 다시 만들게 지금 지운다.
    await tx.execute(sql.raw('DROP TABLE closeout, closeout_reservation, leftover_scope'));
  }

  // ③ 대기열 — 취소 경로가 부르는 그 명령
  for (const o of chunk.filter((p) => p.action.closeBacklogs)) {
    result.closedBacklogs += await deps.backlog.closeOpenForSalesOrder(o.salesOrderId, tx);
  }

  // ④ #1247 — 줄 상태가 바뀐 주문에 표시(같은 트랜잭션)
  const touched = chunk
    .filter((o) => o.action.closeFo || o.action.closeShipments || o.action.closeBacklogs)
    .map((o) => o.salesOrderId);
  await markLineStateDirty(tx, touched);
  return result;
}

export async function runLeftoverClose(
  dbService: DbService<typeof wmsSchema>,
  deps: Deps,
  opts: { apply: boolean },
): Promise<LeftoverReport> {
  const planned: Planned[] = (await readCandidates(dbService)).map((o) => ({ ...o, action: classifyLeftover(o) }));
  const report: LeftoverReport = {
    closedFo: 0,
    closedShipments: 0,
    releasedReservations: 0,
    closedBacklogs: 0,
    releasedSkuIds: [],
    humanFo: planned.filter((o) => o.action.report === 'human-fo').map((o) => o.channelOrderId),
    cancelledOpen: planned.filter((o) => o.action.report === 'cancelled-open').map((o) => o.channelOrderId),
    recoveryShipments: [],
    activeWorkShipments: [],
    drainIncomplete: await readDrainIncomplete(dbService),
  };

  const actionable = planned.filter((o) => o.action.closeFo || o.action.closeShipments || o.action.closeBacklogs);
  const skus = new Set<string>();
  for (let i = 0; i < actionable.length; i += CHUNK) {
    const chunk = actionable.slice(i, i + CHUNK);
    let got: ChunkResult | undefined;
    try {
      await dbService.run(async (tx) => {
        got = await closeChunk(tx, deps, chunk);
        if (!opts.apply) throw new DryRunRollback();
      });
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
    if (!got) throw new Error('묶음 결과가 없다');
    report.closedFo += got.closedFo;
    report.closedShipments += got.closedShipments;
    report.releasedReservations += got.releasedReservations;
    report.closedBacklogs += got.closedBacklogs;
    report.recoveryShipments.push(...got.recoveryShipments);
    report.activeWorkShipments.push(...got.activeWorkShipments);
    got.releasedSkuIds.forEach((s) => skus.add(s));
  }
  report.releasedSkuIds = [...skus];

  if (opts.apply) {
    for (let i = 0; i < report.releasedSkuIds.length; i += CHUNK) {
      await deps.sellable.recalculateAndPublishForSkus(report.releasedSkuIds.slice(i, i + CHUNK));
    }
  }
  return report;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = outArg ? outArg.slice('--out='.length) : `apps/core/tmp/cutover-1243-report-${stamp(new Date())}.txt`;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }

  // DbService 생성자는 tsx 에서 CJS interop 문제로 못 쓴다 — prototype 만 빌려 클라이언트를 주입한다(close-sellmate-csv-inbound.ts 와 같다).
  const client = postgres(url, { max: 4 });
  const dbService: DbService<typeof wmsSchema> = Object.assign(
    Object.create(DbService.prototype) as DbService<typeof wmsSchema>,
    {
      _client: client,
      _db: drizzle(client, { schema: wmsSchema }),
    },
  );
  try {
    // closeOpenForSalesOrder 는 workflowGate 를 쓰지 않는다 — 쓰기 시작하면 이 자리가 던진다.
    const gate = new Proxy(
      {},
      {
        get: () => {
          throw new Error(
            'workflowGate 는 close-sellmate-leftovers 에 연결돼 있지 않다 — closeOpenForSalesOrder 가 바뀌었다',
          );
        },
      },
    );
    const backlog = new FulfillmentOrderCreationBacklogService(dbService, gate as never);
    const sellable = new ProductSellableQuantityService(
      dbService as never,
      outboxPublisherFor(INVENTORY_STREAM, dbService as never),
    );

    const r = await runLeftoverClose(dbService, { backlog, sellable }, { apply });

    console.log(apply ? '✅ 적용' : '🔍 DRY-RUN — 같은 경로를 돌린 뒤 롤백했다(DB 미반영). --apply 로 실행.');
    console.log(
      `   출고주문 닫음 ${r.closedFo} · 상자 닫음 ${r.closedShipments} · 예약 해제 ${r.releasedReservations} · 대기열 닫음 ${r.closedBacklogs}`,
    );
    console.log(`   예약이 풀린 SKU ${r.releasedSkuIds.length}개${apply ? ' — 판매가능수량 재계산·발행함' : ''}`);
    console.log(`\n보고(닫지 않음):`);
    console.log(`   FO 가 사람이 볼 상태(processing·partially_shipped·recovery_required) ${r.humanFo.length}건`);
    console.log(`   취소 주문인데 FO·상자가 열림(리컨실러 몫) ${r.cancelledOpen.length}건`);
    console.log(
      `   recovery_required 상자 ${r.recoveryShipments.length}개 · 진행 중 작업 항목이 걸린 상자 ${r.activeWorkShipments.length}개`,
    );
    if (r.drainIncomplete === null) console.log('   드레인 미완료: 넘긴 주문 집합 없음(저녁 맞추기 init 전)');
    else if (r.drainIncomplete > 0)
      console.log(`   ⚠️  드레인 미완료 ${r.drainIncomplete}건 — 셀메이트가 아직 안 내보냈다. 끝난 뒤 다시 돌린다`);
    else console.log('   드레인 미완료 0');

    const lines = [
      ...r.humanFo.map((id) => `human-fo\t${id}`),
      ...r.cancelledOpen.map((id) => `cancelled-open\t${id}`),
      ...r.recoveryShipments.map((id) => `recovery-shipment\t${id}`),
      ...r.activeWorkShipments.map((id) => `active-work-shipment\t${id}`),
    ];
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
    console.log(`\n보고 목록 ${lines.length}줄 → ${out} (주문 식별자가 들어 있다 — 커밋하지 않는다)`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
