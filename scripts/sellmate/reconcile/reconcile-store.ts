/**
 * 셀메이트 저녁 맞추기의 DB 읽기·쓰기 한 자리(#1304). postgres.js raw SQL — 다른 scripts/sellmate 파일과 같다.
 * 호출자가 트랜잭션(`tx`)을 열고, dry-run 이면 끝까지 돈 뒤 롤백한다. 여기서는 트랜잭션을 열지 않는다.
 * 재고 grain 은 부천 창고(BUCHEON_WAREHOUSE_ID)뿐이다.
 */
import { Sql } from 'postgres';
import { unwrapFormula } from '../formula-barcodes-plan';
import { BUCHEON_WAREHOUSE_ID } from '../stock-delta';
import type { CoreIndex, Pair, StateRow, Unpaired } from './pairing';

/** 원장 이벤트 reason(출처) */
export const RECONCILE_SOURCE = 'sellmate-reconcile';
/** sync-stock·handover-stock-addback 과 같은 advisory lock 키 */
export const STOCK_LOCK_KEY = 'sellmate-stock-sync';
const HANDOVER_SOURCE = 'sellmate-handover';
const CHUNK = 1000;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export async function lockStock(tx: Sql): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${STOCK_LOCK_KEY}))`;
}

const TABLES = [
  'sellmate_item_pairs',
  'sellmate_reconcile_runs',
  'sellmate_reconcile_items',
  'sellmate_reconcile_states',
  'sellmate_handed_over_orders',
];

/** 마이그가 안 돈 DB 에서는 false — 그때 다른 조회를 하지 않게 호출자가 먼저 묻는다 */
export async function reconcileTablesExist(sql: Sql): Promise<boolean> {
  const rows = await sql<{ name: string; oid: string | null }[]>`
    SELECT t AS name, to_regclass(t)::text AS oid FROM unnest(${TABLES}::text[]) AS t`;
  return rows.every((r) => r.oid !== null);
}

/** init 뒤 옛 스크립트(sync-stock·handover-stock-addback)가 내는 거절 문구 */
export const SYNC_REFUSAL_AFTER_INIT = '저녁 맞추기 init 이 있다 — T 이후 이 스크립트는 core 원장을 되돌리므로 돌리지 않는다 (#1304)';

export async function reconcileInitExists(sql: Sql): Promise<boolean> {
  if (!(await reconcileTablesExist(sql))) return false;
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sellmate_reconcile_runs WHERE kind = 'init'`;
  return (row?.n ?? 0) > 0;
}

export async function handoverEventsExist(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM stock_events WHERE reason = ${HANDOVER_SOURCE}) AS found`;
  return row?.found ?? false;
}

export async function loadCoreIndex(tx: Sql): Promise<CoreIndex> {
  const codes = await tx<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE is_deleted = false`;
  const skuIdByCode = new Map<string, string>();
  for (const r of codes) skuIdByCode.set(r.code, r.id);

  const barcodes = await tx<{ sku_id: string; barcode: string }[]>`
    SELECT b.sku_id, b.barcode FROM sku_barcodes b JOIN skus s ON s.id = b.sku_id WHERE s.is_deleted = false`;
  const grouped = new Map<string, Set<string>>();
  for (const r of barcodes) {
    const key = unwrapFormula(r.barcode).trim();
    if (key === '') continue;
    const set = grouped.get(key) ?? new Set<string>();
    set.add(r.sku_id);
    grouped.set(key, set);
  }
  const skuIdsByBarcode = new Map<string, readonly string[]>();
  for (const [key, set] of grouped) skuIdsByBarcode.set(key, [...set].sort());
  return { skuIdByCode, skuIdsByBarcode };
}

type PairRow = {
  option_serial: string;
  product_serial: string;
  item_name: string;
  barcode: string;
  sku_id: string | null;
  matched_by: string | null;
  unpaired_reason: string | null;
};

/** 짝 표는 매번 통째로 다시 쓴다(한 번의 읽기 결과가 전부다) */
export async function replacePairs(tx: Sql, pairs: readonly Pair[], unpaired: readonly Unpaired[]): Promise<void> {
  await tx`DELETE FROM sellmate_item_pairs`;
  const rows: PairRow[] = [
    ...pairs.map((p) => ({
      option_serial: p.optionSerial,
      product_serial: p.productSerial,
      item_name: p.name,
      barcode: p.barcode,
      sku_id: p.skuId,
      matched_by: p.matchedBy,
      unpaired_reason: null,
    })),
    ...unpaired.map((u) => ({
      option_serial: u.optionSerial,
      product_serial: u.productSerial,
      item_name: u.name,
      barcode: u.barcode,
      sku_id: u.skuId,
      matched_by: null,
      unpaired_reason: u.reason,
    })),
  ];
  for (const part of chunks(rows)) {
    await tx`INSERT INTO sellmate_item_pairs ${tx(part, 'option_serial', 'product_serial', 'item_name', 'barcode', 'sku_id', 'matched_by', 'unpaired_reason')}`;
  }
}

export async function loadStates(tx: Sql): Promise<StateRow[]> {
  const rows = await tx<{ sku_id: string; option_serial: string; baseline: number; carry: number; frozen: boolean }[]>`
    SELECT sku_id, option_serial, baseline, carry, frozen FROM sellmate_reconcile_states ORDER BY option_serial`;
  return rows.map((r) => ({
    skuId: r.sku_id,
    optionSerial: r.option_serial,
    baseline: r.baseline,
    carry: r.carry,
    frozen: r.frozen,
  }));
}

export type CoreFigures = { onHand: number; reservedAll: number; reservedHandedOver: number };

/**
 * 부천 grain 수치. onHand = ON_HAND 원장 합, reservedAll = confirmed 예약 합(warehouse-availability.ts 와 같은 집합),
 * reservedHandedOver = 그중 넘긴 주문(sellmate_handed_over_orders)의 판매주문에 속한 몫.
 * 예약 → 상자 라인 → FO 항목 → FO → 판매주문 은 항목 쪽(shipment_lines.fulfillment_order_item_id, NOT NULL)으로 잇는다.
 */
export async function readCoreFigures(tx: Sql, skuIds: readonly string[]): Promise<Map<string, CoreFigures>> {
  const out = new Map<string, CoreFigures>();
  if (skuIds.length === 0) return out;
  for (const id of skuIds) out.set(id, { onHand: 0, reservedAll: 0, reservedHandedOver: 0 });
  const ids = [...skuIds];

  // ON_HAND 합과 예약 합은 한 statement 로 읽는다(warehouse-availability.ts 규칙) — 두 번에 나눠 읽으면
  // READ COMMITTED 에서 그 사이 커밋된 SHIP 이 한쪽에만 비쳐 torn read 가 난다.
  const rows = await tx<{ sku_id: string; on_hand: number; all_qty: number; handed_qty: number }[]>`
    SELECT k.sku_id,
           COALESCE((SELECT SUM(l.qty) FROM stock_ledgers l
                      WHERE l.sku_id = k.sku_id AND l.warehouse_id = ${BUCHEON_WAREHOUSE_ID}
                        AND l.stock_state = 'ON_HAND'), 0)::int AS on_hand,
           COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
                      WHERE r.sku_id = k.sku_id AND r.warehouse_id = ${BUCHEON_WAREHOUSE_ID}
                        AND r.status = 'confirmed'), 0)::int AS all_qty,
           COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
                      WHERE r.sku_id = k.sku_id AND r.warehouse_id = ${BUCHEON_WAREHOUSE_ID}
                        AND r.status = 'confirmed'
                        AND EXISTS (
                          SELECT 1 FROM shipment_lines sl
                          JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
                          JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
                          JOIN sellmate_handed_over_orders h ON h.sales_order_id = fo.sales_order_id
                          WHERE sl.id = r.shipment_line_id)), 0)::int AS handed_qty
    FROM unnest(${ids}::uuid[]) AS k(sku_id)`;
  for (const r of rows)
    out.set(r.sku_id, { onHand: r.on_hand, reservedAll: r.all_qty, reservedHandedOver: r.handed_qty });
  return out;
}

/** 부천 ON_HAND 가 비시스템 로케이션 정확히 한 곳에만 있으면 그 id, 아니면 null(증가 위치를 정할 수 없다) */
export async function singleRealLocation(tx: Sql, skuId: string): Promise<string | null> {
  const rows = await tx<{ location_id: string; is_system: boolean }[]>`
    SELECT l.id AS location_id, l.is_system
    FROM stock_ledgers sl JOIN locations l ON l.id = sl.location_id
    WHERE sl.warehouse_id = ${BUCHEON_WAREHOUSE_ID} AND sl.stock_state = 'ON_HAND' AND sl.sku_id = ${skuId} AND sl.qty > 0`;
  if (rows.length !== 1 || rows[0].is_system) return null;
  return rows[0].location_id;
}

/** medusa DB: 주문번호(display_id) → medusa 주문 id. 초안·삭제 주문은 뺀다 */
export async function resolveMedusaOrderIds(medusa: Sql, displayIds: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (displayIds.length === 0) return out;
  const ids = [...displayIds];
  const rows = await medusa<{ id: string; display_id: number }[]>`
    SELECT id, display_id FROM "order"
    WHERE display_id = ANY(${ids}::int[]) AND is_draft_order = false AND deleted_at IS NULL`;
  for (const r of rows) out.set(Number(r.display_id), r.id);
  return out;
}

/** core: medusa 주문 id(= sales_orders.channel_order_id) → 판매주문 id */
export async function resolveSalesOrders(tx: Sql, medusaOrderIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (medusaOrderIds.length === 0) return out;
  const ids = [...medusaOrderIds];
  const rows = await tx<{ id: string; channel_order_id: string }[]>`
    SELECT id, channel_order_id FROM sales_orders WHERE sales_channel = 'medusa' AND channel_order_id = ANY(${ids}::text[])`;
  for (const r of rows) out.set(r.channel_order_id, r.id);
  return out;
}

export type RunRow = {
  id: string;
  kind: 'init' | 'apply';
  status: 'closed' | 'awaiting_close';
  inputSha256: string;
  inputSnapshotAt: Date;
  closeSnapshotAt: Date | null;
  cutoverAt: Date | null;
  uploadFile: string | null;
  createdAt: Date;
};

type RunDbRow = {
  id: string;
  kind: string;
  status: string;
  input_sha256: string;
  input_snapshot_at: Date;
  close_snapshot_at: Date | null;
  cutover_at: Date | null;
  upload_file: string | null;
  created_at: Date;
};

const RUN_COLUMNS = (tx: Sql) =>
  tx`id, kind, status, input_sha256, input_snapshot_at, close_snapshot_at, cutover_at, upload_file, created_at`;

function toRun(r: RunDbRow): RunRow {
  if ((r.kind !== 'init' && r.kind !== 'apply') || (r.status !== 'closed' && r.status !== 'awaiting_close')) {
    throw new Error(`알 수 없는 실행 종류/상태: kind=${r.kind} status=${r.status} id=${r.id}`);
  }
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    inputSha256: r.input_sha256,
    inputSnapshotAt: r.input_snapshot_at,
    closeSnapshotAt: r.close_snapshot_at,
    cutoverAt: r.cutover_at,
    uploadFile: r.upload_file,
    createdAt: r.created_at,
  };
}

export async function findRunBySha(tx: Sql, sha: string): Promise<RunRow | null> {
  const [r] = await tx<RunDbRow[]>`SELECT ${RUN_COLUMNS(tx)} FROM sellmate_reconcile_runs WHERE input_sha256 = ${sha}`;
  return r ? toRun(r) : null;
}

export async function openRun(tx: Sql): Promise<RunRow | null> {
  const [r] = await tx<RunDbRow[]>`
    SELECT ${RUN_COLUMNS(tx)} FROM sellmate_reconcile_runs WHERE status = 'awaiting_close'`;
  return r ? toRun(r) : null;
}

export async function lastClosedRun(tx: Sql): Promise<RunRow | null> {
  const [r] = await tx<RunDbRow[]>`
    SELECT ${RUN_COLUMNS(tx)} FROM sellmate_reconcile_runs WHERE status = 'closed'
    ORDER BY closed_at DESC NULLS LAST, created_at DESC LIMIT 1`;
  return r ? toRun(r) : null;
}

export async function initRun(tx: Sql): Promise<RunRow | null> {
  const [r] = await tx<RunDbRow[]>`SELECT ${RUN_COLUMNS(tx)} FROM sellmate_reconcile_runs WHERE kind = 'init'`;
  return r ? toRun(r) : null;
}

export async function insertRun(tx: Sql, r: Omit<RunRow, 'id' | 'createdAt' | 'closeSnapshotAt'>): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO sellmate_reconcile_runs (kind, status, input_sha256, input_snapshot_at, cutover_at, upload_file, closed_at)
    VALUES (${r.kind}, ${r.status}, ${r.inputSha256}, ${r.inputSnapshotAt}, ${r.cutoverAt}, ${r.uploadFile},
            ${r.status === 'closed' ? new Date() : null})
    RETURNING id`;
  return row.id;
}

export type RunItemRow = {
  optionSerial: string;
  skuId: string;
  sellmateCurrent: number;
  sellmateUnshipped: number;
  s: number;
  baselineBefore: number;
  carryBefore: number;
  delta: number;
  carryAfter: number;
  uploadAvail: number | null;
  uploadedCurrent: number | null;
  refUnshipped: number | null;
};

export async function insertRunItems(tx: Sql, runId: string, items: readonly RunItemRow[]): Promise<void> {
  const rows = items.map((i) => ({
    run_id: runId,
    option_serial: i.optionSerial,
    sku_id: i.skuId,
    sellmate_current: i.sellmateCurrent,
    sellmate_unshipped: i.sellmateUnshipped,
    s: i.s,
    baseline_before: i.baselineBefore,
    carry_before: i.carryBefore,
    delta: i.delta,
    carry_after: i.carryAfter,
    upload_avail: i.uploadAvail,
    uploaded_current: i.uploadedCurrent,
    ref_unshipped: i.refUnshipped,
  }));
  for (const part of chunks(rows)) {
    await tx`INSERT INTO sellmate_reconcile_items ${tx(
      part,
      'run_id',
      'option_serial',
      'sku_id',
      'sellmate_current',
      'sellmate_unshipped',
      's',
      'baseline_before',
      'carry_before',
      'delta',
      'carry_after',
      'upload_avail',
      'uploaded_current',
      'ref_unshipped',
    )}`;
  }
}

export async function loadRunItems(tx: Sql, runId: string): Promise<RunItemRow[]> {
  const rows = await tx<
    {
      option_serial: string;
      sku_id: string;
      sellmate_current: number;
      sellmate_unshipped: number;
      s: number;
      baseline_before: number;
      carry_before: number;
      delta: number;
      carry_after: number;
      upload_avail: number | null;
      uploaded_current: number | null;
      ref_unshipped: number | null;
    }[]
  >`SELECT * FROM sellmate_reconcile_items WHERE run_id = ${runId} ORDER BY option_serial`;
  return rows.map((r) => ({
    optionSerial: r.option_serial,
    skuId: r.sku_id,
    sellmateCurrent: r.sellmate_current,
    sellmateUnshipped: r.sellmate_unshipped,
    s: r.s,
    baselineBefore: r.baseline_before,
    carryBefore: r.carry_before,
    delta: r.delta,
    carryAfter: r.carry_after,
    uploadAvail: r.upload_avail,
    uploadedCurrent: r.uploaded_current,
    refUnshipped: r.ref_unshipped,
  }));
}

export async function updateRunItemClose(
  tx: Sql,
  runId: string,
  optionSerial: string,
  v: { verdict: string; accept: string | null; uploadedCurrent?: number; refUnshipped?: number },
): Promise<void> {
  await tx`
    UPDATE sellmate_reconcile_items
    SET close_verdict = ${v.verdict}, accept = ${v.accept},
        uploaded_current = COALESCE(${v.uploadedCurrent ?? null}::int, uploaded_current),
        ref_unshipped = COALESCE(${v.refUnshipped ?? null}::int, ref_unshipped)
    WHERE run_id = ${runId} AND option_serial = ${optionSerial}`;
}

export async function upsertStates(tx: Sql, rows: readonly (StateRow & { lastRunId: string })[]): Promise<void> {
  const data = rows.map((r) => ({
    sku_id: r.skuId,
    option_serial: r.optionSerial,
    baseline: r.baseline,
    carry: r.carry,
    frozen: r.frozen,
    last_run_id: r.lastRunId,
  }));
  for (const part of chunks(data)) {
    await tx`
      INSERT INTO sellmate_reconcile_states ${tx(part, 'sku_id', 'option_serial', 'baseline', 'carry', 'frozen', 'last_run_id')}
      ON CONFLICT (sku_id) DO UPDATE SET
        option_serial = EXCLUDED.option_serial, baseline = EXCLUDED.baseline, carry = EXCLUDED.carry,
        frozen = EXCLUDED.frozen, last_run_id = EXCLUDED.last_run_id, updated_at = now()`;
  }
}

export async function closeRunRow(
  tx: Sql,
  runId: string,
  closeSha: string,
  closeSnapshotAt: Date,
  accepted: unknown,
): Promise<void> {
  // accepted 는 호출자가 만든 JSON 직렬화 가능 값이다. postgres.js 의 JSONValue 타입으로 좁히는 한 곳의 캐스트.
  const json = tx.json(accepted as Parameters<Sql['json']>[0]);
  await tx`
    UPDATE sellmate_reconcile_runs
    SET status = 'closed', close_input_sha256 = ${closeSha}, close_snapshot_at = ${closeSnapshotAt},
        accepted = ${json}, closed_at = now()
    WHERE id = ${runId}`;
}

export async function insertHandedOver(
  tx: Sql,
  runId: string,
  rows: readonly { salesOrderId: string; displayId: number; medusaOrderId: string }[],
): Promise<void> {
  const data = rows.map((r) => ({
    sales_order_id: r.salesOrderId,
    display_id: r.displayId,
    medusa_order_id: r.medusaOrderId,
    run_id: runId,
  }));
  for (const part of chunks(data)) {
    await tx`INSERT INTO sellmate_handed_over_orders ${tx(part, 'sales_order_id', 'display_id', 'medusa_order_id', 'run_id')}
      ON CONFLICT (sales_order_id) DO NOTHING`;
  }
}

/** 회차 id 로 이름을 짓는 업로드 파일 경로를 행을 만든 뒤에 적는다 */
export async function setRunUploadFile(tx: Sql, runId: string, uploadFile: string): Promise<void> {
  await tx`UPDATE sellmate_reconcile_runs SET upload_file = ${uploadFile} WHERE id = ${runId}`;
}

/**
 * 얼어 있던 상태가 다른 SKU 로 다시 짝지어져 새로 시작할 때, 옛 행이 option_serial unique 를 막지 않게 지운다.
 * 얼지 않은 행은 지우지 않는다(그건 skuChanged 로 막혀 여기까지 오지 않는다).
 */
export async function dropFrozenStates(tx: Sql, optionSerials: readonly string[]): Promise<void> {
  if (optionSerials.length === 0) return;
  const serials = [...optionSerials];
  await tx`DELETE FROM sellmate_reconcile_states WHERE frozen = true AND option_serial = ANY(${serials}::text[])`;
}

/** 마지막 pair/init/apply 가 쓴 짝 표에서 짝 못 지은 품목 */
export async function loadUnpairedPairs(sql: Sql): Promise<{ optionSerial: string; reason: string }[]> {
  const rows = await sql<{ option_serial: string; unpaired_reason: string }[]>`
    SELECT option_serial, unpaired_reason FROM sellmate_item_pairs
    WHERE unpaired_reason IS NOT NULL ORDER BY option_serial`;
  return rows.map((r) => ({ optionSerial: r.option_serial, reason: r.unpaired_reason }));
}
