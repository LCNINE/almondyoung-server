/**
 * 넘겨받은 셀메이트 쿠팡 주문만큼 마지막 재고 sync 의 차감을 되돌린다 (#1245 스펙 결정 4·§4.9). 한 번만 도는 스크립트.
 *
 * 왜: 마지막 sync 는 «셀메이트 현재재고 − 미발송주문수»를 넣었다(sync-stock.ts `parseStockRows`). 재고가 모자라 셀메이트가
 * 못 보낸 쿠팡 주문은 결제완료로 남아 키 전환 뒤 우리 첫 수집에 들어오고, core 가 그 주문을 또 예약한다 — 두 번 빠졌다.
 *
 * 무엇을 되돌리나:
 *   - 넘겨받은 주문 = core `sales_orders` 중 `sales_channel='coupang'` 이고, 결제 시각(`order_date` — 쿠팡 source 가 첫 상자의
 *     paidAt 을 스냅샷 createdAt 에 싣고 core 가 그 값을 저장한다)이 `--sellmate-collected-at`(셀메이트 마지막 주문수집 버튼 시각)
 *     보다 15분 넘게 이른 주문. 셀메이트가 수집해 미발송에 넣은 주문이다. 앞뒤 15분 안이면 판정하지 않고 «사람이 확인»으로만 낸다
 *     (쿠팡 목록 반영이 ~10분 늦다). 15분 넘게 늦은 주문은 셀메이트가 수집하지 않아 미발송에 없다 — 되돌리면 오버셀이다.
 *   - 셀메이트 마지막 수집보다 먼저 core 에 있던 쿠팡 주문(`created_at`)은 우리 첫 수집에 들어온 주문이 아니므로 뺀다(따로 센다).
 *   - 품목별 넘겨받은 수량 = 그 주문들의 FO 항목(`fulfillment_order_items`) 수요 `qty − canceled_qty` 의 SKU 별 합.
 *     FO 항목은 FO 생성이 라인 구성(굳힌 구성/상품매칭)을 SKU 로 푼 결과이고, core 의 예약은 그 항목의 상자 라인에 걸린다 —
 *     core 가 예약할 때 쓰는 해석 그대로다. 같은 식이 K6 의 SKU 층 `required`(line-quantities.sql.ts `lineSkuQuantitiesSql`)다.
 *     FO 항목이 없는 물리 라인(매칭 미해결 등)은 SKU 를 알 수 없으므로 «사람이 확인»으로 내고 `--apply` 를 거절한다.
 *   - 더할 양 = 품목마다 `max(0, 현재재고 − (미발송주문수 − 넘겨받은 수량)) − max(0, 현재재고 − 미발송주문수)` — 0 으로 잘렸던
 *     품목에서 원래 실물보다 많이 넣지 않는다. 넘겨받은 수량이 미발송주문수보다 많으면 입력이 서로 안 맞는 것이라 되돌리지 않고
 *     `--apply` 를 거절한다.
 *
 * 쓰기: `--apply` 일 때만, 한 트랜잭션에서 sync-stock 과 같은 advisory lock 을 잡고 `applyStockDelta(…, source: 'sellmate-handover')`
 * (ADJUST_UP stock_events + 부천 입고기본존 원장). `reason = 'sellmate-handover'` 이벤트가 하나라도 있으면 거절한다.
 * 기본은 dry-run — 품목별 표만 찍고 아무것도 쓰지 않는다.
 *
 * ── 실행 (테넌트 1 core DB — run.sh 가 DATABASE_URL 을 넣는다) ───────────────────
 *   bash scripts/sellmate/run.sh live handover-stock-addback --stock=<마지막 sync 에 쓴 재고 파일> --sellmate-collected-at=2026-11-20T09:30:00+09:00
 *   bash scripts/sellmate/run.sh live handover-stock-addback --stock=… --sellmate-collected-at=… --apply
 *   DATABASE_URL=postgres://…/core npx tsx scripts/sellmate/handover-stock-addback.ts --stock=… --sellmate-collected-at=…   # 로컬
 * `--sellmate-collected-at` 에 offset 이 없으면 KST 로 읽는다. 반영 뒤 `recalc-sellable` 로 sellable 을 다시 계산한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres, { Sql } from 'postgres';
import { chunk, readRows } from './parse';
import { applyStockDelta } from './stock-delta';
import { parseStockRows, StockCount, StockParseError } from './sync-stock';

export const HANDOVER_SOURCE = 'sellmate-handover';
/** 셀메이트 수집 시각 앞뒤로 판정하지 않는 폭 — 쿠팡 목록 반영이 ~10분 늦다 */
export const AMBIGUOUS_WINDOW_MS = 15 * 60 * 1000;
/** sync-stock 과 같은 키 — 두 스크립트가 원장을 동시에 만지지 않게 한다 */
const STOCK_LOCK_KEY = 'sellmate-stock-sync';
const KST_OFFSET = '+09:00';

export function computeAddBack(row: { current: number; unshipped: number; handedOver: number }): number {
  const { current, unshipped, handedOver } = row;
  return Math.max(0, current - (unshipped - handedOver)) - Math.max(0, current - unshipped);
}

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

/** ISO 시각. offset 이 없으면 KST. 날짜만·없는 날짜·이상한 값은 던진다 — 시각을 추정하지 않는다 */
export function parseCollectedAt(raw: string): Date {
  const m = ISO_INSTANT.exec(raw.trim());
  if (!m) {
    throw new Error(
      `--sellmate-collected-at 을 못 읽었다: "${raw}" (예: 2026-11-20T09:30:00+09:00, offset 이 없으면 KST)`,
    );
  }
  const [, y, mo, d, h, mi, s, offset] = m;
  const zone = offset ?? KST_OFFSET;
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${zone === 'Z' ? 'Z' : zone}`);
  if (Number.isNaN(at.getTime())) throw new Error(`--sellmate-collected-at 이 없는 시각이다: "${raw}"`);
  // Date 가 넘친 값(2월 30일 등)을 다음 달로 굴리지 않았는지 — 그 offset 의 벽시계로 되돌려 같은지 본다
  const offsetMinutes =
    zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const wall = new Date(at.getTime() + offsetMinutes * 60_000);
  const same =
    wall.getUTCFullYear() === Number(y) &&
    wall.getUTCMonth() + 1 === Number(mo) &&
    wall.getUTCDate() === Number(d) &&
    wall.getUTCHours() === Number(h) &&
    wall.getUTCMinutes() === Number(mi);
  if (!same) throw new Error(`--sellmate-collected-at 이 없는 시각이다: "${raw}"`);
  return at;
}

export type CliArgs = { stock: string; collectedAt: Date; apply: boolean };

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let stock: string | undefined;
  let collectedAtRaw: string | undefined;
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--stock=')) stock = arg.slice('--stock='.length);
    else if (arg.startsWith('--sellmate-collected-at=')) collectedAtRaw = arg.slice('--sellmate-collected-at='.length);
    else throw new Error(`모르는 인자: ${arg}`);
  }
  if (!stock) throw new Error('--stock=<마지막 sync 에 쓴 재고 파일> 이 필요하다');
  if (!collectedAtRaw) throw new Error('--sellmate-collected-at=<셀메이트 마지막 주문수집 시각, ISO> 이 필요하다');
  return { stock, collectedAt: parseCollectedAt(collectedAtRaw), apply };
}

export type CoupangOrder = { id: string; orderDate: Date; createdAt: Date };

/**
 * 셀메이트 마지막 수집 시각으로 core 쿠팡 주문을 가른다.
 *   preexisting — 셀메이트 마지막 수집보다 먼저 core 에 있었다(우리 첫 수집이 아니다)
 *   handedOver  — 결제가 수집보다 15분 넘게 이르다(셀메이트가 수집해 미발송에 넣었다)
 *   ambiguous   — 결제가 수집 앞뒤 15분 안(판정하지 않는다, 사람이 확인)
 *   later       — 결제가 수집보다 15분 넘게 늦다(셀메이트 미발송에 없다)
 */
export type ClassifiedOrders<T> = { handedOver: T[]; ambiguous: T[]; later: T[]; preexisting: T[] };

export function classifyCoupangOrders<T extends CoupangOrder>(
  orders: readonly T[],
  collectedAt: Date,
): ClassifiedOrders<T> {
  const result: ClassifiedOrders<T> = { handedOver: [], ambiguous: [], later: [], preexisting: [] };
  const at = collectedAt.getTime();
  for (const order of orders) {
    if (order.createdAt.getTime() <= at) {
      result.preexisting.push(order);
      continue;
    }
    const diff = order.orderDate.getTime() - at;
    if (diff < -AMBIGUOUS_WINDOW_MS) result.handedOver.push(order);
    else if (diff <= AMBIGUOUS_WINDOW_MS) result.ambiguous.push(order);
    else result.later.push(order);
  }
  return result;
}

export type HandedOverSku = { skuId: string; skuCode: string; quantity: number };
export type AddBackRow = {
  skuId: string;
  skuCode: string;
  current: number;
  unshipped: number;
  handedOver: number;
  addBack: number;
};
export type AddBackPlan = {
  rows: AddBackRow[];
  /** 마지막 sync 재고 파일에 없는 품목 — sync 가 안 건드렸으니 되돌릴 것도 없다 */
  notInStockFile: HandedOverSku[];
  /** 넘겨받은 수량 > 미발송주문수 — 입력이 서로 안 맞는다. 되돌리지 않는다(addBack 0) */
  exceedsUnshipped: AddBackRow[];
};

/** 품목 키 = sku.code = 셀메이트 옵션정보일련번호. counts 에 같은 품목이 여럿이면 마지막 값을 쓴다(호출자가 충돌을 먼저 거른다) */
export function buildAddBackPlan(counts: readonly StockCount[], handedOver: readonly HandedOverSku[]): AddBackPlan {
  const byCode = new Map<string, StockCount>();
  for (const c of counts) byCode.set(c.itemCode, c);
  const plan: AddBackPlan = { rows: [], notInStockFile: [], exceedsUnshipped: [] };
  for (const sku of handedOver) {
    const count = byCode.get(sku.skuCode);
    if (!count) {
      plan.notInStockFile.push(sku);
      continue;
    }
    const base = {
      skuId: sku.skuId,
      skuCode: sku.skuCode,
      current: count.current,
      unshipped: count.unshipped,
      handedOver: sku.quantity,
    };
    if (sku.quantity > count.unshipped) {
      plan.exceedsUnshipped.push({ ...base, addBack: 0 });
      continue;
    }
    plan.rows.push({ ...base, addBack: computeAddBack(base) });
  }
  return plan;
}

// ── DB ─────────────────────────────────────────────────────────────────────────

type OrderRow = CoupangOrder & { channelOrderId: string };
type UnresolvedLine = { channelOrderId: string; lineId: string; productName: string; demand: number };

/** 셀메이트 수집보다 늦은 주문도 읽는다 — «15분 넘게 늦음» 건수를 보여 주려고. 키 전환 직후라 쿠팡 주문은 많지 않다 */
async function readCoupangOrders(db: Sql): Promise<OrderRow[]> {
  const rows = await db<{ id: string; channel_order_id: string; order_date: Date; created_at: Date }[]>`
    SELECT id, channel_order_id, order_date, created_at
      FROM sales_orders
     WHERE sales_channel = 'coupang'
     ORDER BY order_date, id
  `;
  return rows.map((r) => ({
    id: r.id,
    channelOrderId: r.channel_order_id,
    orderDate: r.order_date,
    createdAt: r.created_at,
  }));
}

/** 그 주문들의 FO 항목 수요(qty − canceled_qty)를 SKU 별로 합한다 — K6 SKU 층 `required` 와 같은 조인·같은 식 */
async function readHandedOverSkus(db: Sql, orderIds: readonly string[]): Promise<HandedOverSku[]> {
  const bySku = new Map<string, HandedOverSku>();
  for (const part of chunk([...orderIds], 1000)) {
    if (part.length === 0) continue;
    const rows = await db<{ sku_id: string; sku_code: string; quantity: number }[]>`
      SELECT foi.sku_id, s.code AS sku_code, sum(foi.qty - foi.canceled_qty)::int AS quantity
        FROM fulfillment_orders fo
        JOIN fulfillment_order_items foi ON foi.fulfillment_order_id = fo.id
        JOIN sales_order_lines line
          ON foi.sales_order_line_id = line.id::text
         AND line.sales_order_id = fo.sales_order_id
        JOIN skus s ON s.id = foi.sku_id
       WHERE fo.sales_order_id IN ${db(part)}
       GROUP BY foi.sku_id, s.code
    `;
    for (const r of rows) {
      const prev = bySku.get(r.sku_id);
      bySku.set(r.sku_id, { skuId: r.sku_id, skuCode: r.sku_code, quantity: (prev?.quantity ?? 0) + r.quantity });
    }
  }
  return [...bySku.values()].filter((s) => s.quantity > 0).sort((a, b) => a.skuCode.localeCompare(b.skuCode));
}

/** 수요가 남았는데 FO 항목이 없는 물리 라인 — SKU 를 모른다. 수요 = 주문 수량 − 출고 전 취소(K6 `lineDemandSql`) */
async function readUnresolvedLines(db: Sql, orderIds: readonly string[]): Promise<UnresolvedLine[]> {
  const out: UnresolvedLine[] = [];
  for (const part of chunk([...orderIds], 1000)) {
    if (part.length === 0) continue;
    const rows = await db<{ channel_order_id: string; line_id: string; product_name: string; demand: number }[]>`
      SELECT so.channel_order_id, line.id AS line_id, line.product_name,
             (line.quantity - coalesce((
               SELECT sum(cl.quantity) FROM sales_order_cancellation_lines cl
                WHERE cl.sales_order_line_id = line.id AND cl.shipment_phase = 'before_shipment'
             ), 0))::int AS demand
        FROM sales_order_lines line
        JOIN sales_orders so ON so.id = line.sales_order_id
       WHERE line.sales_order_id IN ${db(part)}
         AND line.almond_design_id IS NULL
         AND line.fulfillment_kind IS DISTINCT FROM 'digital'
         AND line.requires_shipping IS DISTINCT FROM false
         AND NOT EXISTS (
           SELECT 1
             FROM fulfillment_order_items foi
             JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
            WHERE foi.sales_order_line_id = line.id::text AND fo.sales_order_id = line.sales_order_id
         )
       ORDER BY so.channel_order_id, line.id
    `;
    for (const r of rows) {
      if (r.demand > 0) {
        out.push({
          channelOrderId: r.channel_order_id,
          lineId: r.line_id,
          productName: r.product_name,
          demand: r.demand,
        });
      }
    }
  }
  return out;
}

async function countHandoverEvents(db: Sql): Promise<number> {
  const [row] = await db<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM stock_events WHERE reason = ${HANDOVER_SOURCE}`;
  return row?.n ?? 0;
}

type Assessment = {
  orders: ClassifiedOrders<OrderRow>;
  unresolved: UnresolvedLine[];
  plan: AddBackPlan;
};

async function assess(db: Sql, counts: readonly StockCount[], collectedAt: Date): Promise<Assessment> {
  const orders = classifyCoupangOrders(await readCoupangOrders(db), collectedAt);
  const ids = orders.handedOver.map((o) => o.id);
  const handedOverSkus = await readHandedOverSkus(db, ids);
  const unresolved = await readUnresolvedLines(db, ids);
  return { orders, unresolved, plan: buildAddBackPlan(counts, handedOverSkus) };
}

/** --apply 를 막는 이유들. 비면 쓸 수 있다 */
function blockers(a: Assessment): string[] {
  const out: string[] = [];
  if (a.unresolved.length) out.push(`FO 항목이 없는(SKU 를 모르는) 라인 ${a.unresolved.length}개`);
  if (a.plan.exceedsUnshipped.length)
    out.push(`넘겨받은 수량이 미발송주문수보다 많은 품목 ${a.plan.exceedsUnshipped.length}개`);
  return out;
}

const kst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';

function report(a: Assessment, collectedAt: Date): void {
  const { orders, unresolved, plan } = a;
  console.log(`\n🕘 셀메이트 마지막 수집 ${kst(collectedAt)} (${collectedAt.toISOString()})`);
  console.log(
    `📦 쿠팡 주문: 넘겨받음 ${orders.handedOver.length} · 사람이 확인(±15분) ${orders.ambiguous.length} · ` +
      `15분 넘게 늦음 ${orders.later.length} · 수집 전부터 core 에 있음 ${orders.preexisting.length}`,
  );
  if (orders.ambiguous.length) {
    console.log('\n❓ 사람이 확인 — 결제 시각이 셀메이트 수집 앞뒤 15분 안이라 판정하지 않았다(되돌리지 않음):');
    for (const o of orders.ambiguous) console.log(`   주문 ${o.channelOrderId} 결제 ${kst(o.orderDate)}`);
  }
  if (unresolved.length) {
    console.log('\n❓ 사람이 확인 — FO 항목이 없어 SKU 를 모르는 라인(매칭을 풀어 FO 가 생긴 뒤 다시 돌린다):');
    for (const l of unresolved)
      console.log(`   주문 ${l.channelOrderId} 라인 ${l.lineId} 수요 ${l.demand} — ${l.productName}`);
  }
  if (plan.exceedsUnshipped.length) {
    console.log('\n❓ 사람이 확인 — 넘겨받은 수량이 미발송주문수보다 많다(재고 파일·수집 시각이 맞는지):');
    for (const r of plan.exceedsUnshipped) {
      console.log(`   ${r.skuCode} 현재재고 ${r.current} 미발송 ${r.unshipped} 넘겨받음 ${r.handedOver}`);
    }
  }
  if (plan.notInStockFile.length) {
    console.log('\nℹ️  재고 파일에 없는 품목 — 마지막 sync 가 안 건드렸으니 되돌리지 않는다:');
    for (const s of plan.notInStockFile) console.log(`   ${s.skuCode} 넘겨받음 ${s.quantity}`);
  }
  const total = plan.rows.reduce((sum, r) => sum + r.addBack, 0);
  console.log(`\n📋 품목별 (${plan.rows.length}개, 되돌릴 합계 ${total}):`);
  console.log('   품목 | 현재재고 | 미발송 | 넘겨받음 | 되돌림');
  for (const r of plan.rows) {
    console.log(`   ${r.skuCode} | ${r.current} | ${r.unshipped} | ${r.handedOver} | +${r.addBack}`);
  }
}

class RefusedError extends Error {}

/** reserve 한 연결에서 BEGIN … COMMIT. ReservedSql 은 호출 시그니처가 살아 있는 Sql 이라 applyStockDelta 에 그대로 넘긴다 */
async function inTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn`BEGIN`;
    try {
      const result = await fn(conn);
      await conn`COMMIT`;
      return result;
    } catch (err) {
      await conn`ROLLBACK`.catch(() => undefined);
      throw err;
    }
  } finally {
    conn.release();
  }
}

function listStockFiles(arg: string): string[] {
  if (!fs.statSync(arg).isDirectory()) return [arg];
  return fs
    .readdirSync(arg)
    .filter((f) => ['.csv', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b)) // sync-stock 과 같은 순서 — 마지막 = 최신
    .map((f) => path.join(arg, f));
}

/** sync-stock 과 같은 엄격함: 형식 오류·파일 간 값 충돌이면 던진다 */
async function readStockCounts(arg: string): Promise<StockCount[]> {
  const byCode = new Map<string, StockCount>();
  const errors: StockParseError[] = [];
  const conflicts: string[] = [];
  for (const file of listStockFiles(arg)) {
    const { counts, errors: fileErrors } = parseStockRows(await readRows(file), file);
    errors.push(...fileErrors);
    for (const c of counts) {
      const prev = byCode.get(c.itemCode);
      if (prev && (prev.current !== c.current || prev.unshipped !== c.unshipped)) conflicts.push(c.itemCode);
      byCode.set(c.itemCode, c);
    }
  }
  if (errors.length) {
    const head = errors.slice(0, 10).map((e) => `${e.file} 행${e.rowNumber} ${e.itemCode}="${e.raw}"`);
    throw new RefusedError(`재고 값 형식 오류 ${errors.length}건 — 추정하지 않는다:\n   ${head.join('\n   ')}`);
  }
  if (conflicts.length) {
    throw new RefusedError(
      `여러 파일에 같은 품목이 다른 값으로 있다 ${conflicts.length}건: ${conflicts.slice(0, 10).join(', ')}`,
    );
  }
  return [...byCode.values()];
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (process.env.ALLOW_NO_UNSHIPPED === '1' || process.env.ALLOW_NO_UNSHIPPED === 'true') {
    throw new RefusedError('ALLOW_NO_UNSHIPPED 로는 돌리지 않는다 — 미발송주문수가 없으면 되돌릴 양을 계산할 수 없다');
  }
  const counts = await readStockCounts(args.stock);
  console.log(`\n📄 재고 파일 품목 ${counts.length}개`);

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new RefusedError(
      'DATABASE_URL 이 필요하다 (테넌트 1 core 논리 DB). 라이브는 bash scripts/sellmate/run.sh live handover-stock-addback …',
    );
  }
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    if (!args.apply) {
      const assessment = await assess(sql, counts, args.collectedAt);
      report(assessment, args.collectedAt);
      const already = await countHandoverEvents(sql);
      if (already)
        console.log(
          `\n⛔ '${HANDOVER_SOURCE}' 이벤트가 이미 ${already}건 있다 — --apply 는 거절된다(한 번만 도는 스크립트).`,
        );
      const blocked = blockers(assessment);
      if (blocked.length) console.log(`\n⛔ --apply 는 거절된다: ${blocked.join(', ')}`);
      console.log('\n✅ DRY-RUN 종료 — DB 미반영. 반영은 --apply.');
      return;
    }

    const result = await inTransaction(sql, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${STOCK_LOCK_KEY}))`;
      const already = await countHandoverEvents(tx);
      if (already) {
        throw new RefusedError(
          `'${HANDOVER_SOURCE}' 이벤트가 이미 ${already}건 있다 — 한 번만 도는 스크립트라 거절한다`,
        );
      }
      const assessment = await assess(tx, counts, args.collectedAt);
      report(assessment, args.collectedAt);
      const blocked = blockers(assessment);
      if (blocked.length) throw new RefusedError(`--apply 를 거절한다: ${blocked.join(', ')}`);

      const now = new Date();
      const changed: string[] = [];
      for (const row of assessment.plan.rows) {
        if (row.addBack <= 0) continue;
        await applyStockDelta(tx, {
          skuId: row.skuId,
          delta: row.addBack,
          source: HANDOVER_SOURCE,
          label: row.skuCode,
          occurredAt: now,
        });
        changed.push(row.skuId);
      }
      let matched = 0;
      for (const part of chunk(changed, 1000)) {
        if (part.length === 0) continue;
        const m = await tx<{ n: number }[]>`
          SELECT count(DISTINCT sku_id)::int AS n FROM product_variant_sku_links WHERE sku_id IN ${tx(part)}
        `;
        matched += m[0]?.n ?? 0;
      }
      return { changed: changed.length, total: assessment.plan.rows.reduce((s, r) => s + r.addBack, 0), matched };
    });

    console.log(
      `\n✅ 반영 완료: ${result.changed}개 품목에 합계 +${result.total} (ADJUST_UP, reason='${HANDOVER_SOURCE}').`,
    );
    if (result.matched) {
      console.log(`\n⚠️  매칭된 SKU ${result.matched}개의 재고가 바뀌었다 — sellable 은 갱신하지 않았다. 이어서:`);
      console.log('   bash scripts/sellmate/run.sh live recalc-sellable .');
    }
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(
      `\n❌ ${err instanceof RefusedError ? '' : '실패: '}${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
