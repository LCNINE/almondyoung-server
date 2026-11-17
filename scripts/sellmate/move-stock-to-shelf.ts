/**
 * 컷오버(#1236) — 위치가 하나인 SKU 의 입고기본존 재고를 셀메이트 위치 선반으로 옮긴다(MOVE 원장 이벤트).
 *
 * 왜: 라이브 재고는 전량 입고기본존에 있다. 원장이 실제 선반을 가리켜야 피킹 배정과 송장 위치 칸이 원장에서 나온다.
 * 컷오버 때 실사는 하지 않으므로(셀메이트를 믿는다) 위치를 하나로 아는 SKU 만 옮기고, 나머지는 사유와 함께 목록으로
 * 남겨 컷오버 뒤 실사 대상이 된다. 남은 SKU 의 송장은 지금 규칙(label-items.ts — 시스템 로케이션이면 셀메이트 위치)대로다.
 *
 * 판정: apps/core/src/modules/inventory/core/shelf-move-verdict.ts (판정 스크립트와 같은 함수).
 * 고쳐 읽은 코드(CC-4-1 → CC-04-01 등)는 현장 확인 전까지 꺼져 있다 — --include-rule 로 규칙마다 켠다.
 * 원장은 MovementService.moveImmediately 로만 바꾼다. 적치 대기 입고분·배치 통제분은 guard 가 빼 주는 일반 가용분만 옮긴다.
 *
 * ⚠️ T 당일만 돈다 — 마지막 sync-stock · load-shelf-positions 직후. 며칠 뒤 다시 돌리면 묶이지 않은 앱 입고분을 쓸어 간다.
 *
 *   bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<load-shelf-positions 직전 시각>          # dry-run
 *   bash scripts/sellmate/run.sh live move-stock-to-shelf --positions-since=<…> [--include-rule=zero-pad,…] --apply
 *
 * 남긴 SKU 목록: --out=<경로> (기본 apps/core/tmp/cutover-1236-kept-<시각>.csv). 위치 원문이 들어가므로 커밋하지 않는다.
 * 다시 돌려도 된다 — 옮긴 SKU 는 입고기본존 잔량이 0 이라 대상이 아니고, 멱등키가 출발 원장 version 을 담는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { ConflictException, HttpException } from '@nestjs/common';
import { DbService } from '@app/db';
import { ApplicationException } from '@app/shared';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  CUTOVER_MOVE_MEMO,
  judgeShelfMove,
  SHELF_MOVE_RULES,
  ShelfKeepReason,
  ShelfMoveRule,
} from '../../apps/core/src/modules/inventory/core/shelf-move-verdict';
import { MovementService } from '../../apps/core/src/modules/inventory/movement/services/movement.service';
import { BatchControlledStockGuard } from '../../apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard';
import { StockEventStore } from '../../apps/core/src/modules/inventory/core/repositories/stock-event.store';
import { InventoryIdempotencyService } from '../../apps/core/src/modules/inventory/core/services/inventory-idempotency.service';
import { ProductSellableQuantityService } from '../../apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { outboxPublisherFor } from '../../apps/core/src/modules/fulfillment/outbox/__support__/outbox-publisher.factory';

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const MEMO = CUTOVER_MOVE_MEMO;
const PROGRESS_EVERY = 200;

export type ShelfMoveOptions = {
  /** 셀메이트 위치는 창고 하나(부천)의 위치다 — 판매 창고가 여럿이어도 그 창고만 옮긴다 */
  warehouseId: string;
  apply: boolean;
  positionsSince: Date | null;
  includeRules: ReadonlySet<ShelfMoveRule>;
  /**
   * 동시에 처리할 SKU 수(기본 1). 잠금이 SKU·창고 단위라 SKU 끼리는 서로 막지 않는다. 터널 너머 왕복이 SKU 하나에
   * 30~40번이라 하나씩 돌면 수천 SKU 에 수십 분이 걸린다. 통합 스펙은 롤백 트랜잭션 하나(연결 하나)라 1 로만 돈다.
   */
  concurrency?: number;
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function parseShelfMoveArgs(argv: string[]): Omit<ShelfMoveOptions, 'warehouseId' | 'concurrency'> & {
  warehouseId: string | null;
  concurrency: number;
  out: string;
} {
  let apply = false;
  let concurrency = 8;
  let warehouseId: string | null = null;
  let positionsSince: Date | null = null;
  const includeRules = new Set<ShelfMoveRule>();
  let out = `apps/core/tmp/cutover-1236-kept-${stamp(new Date())}.csv`;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--positions-since=')) {
      const at = new Date(arg.slice('--positions-since='.length));
      if (Number.isNaN(at.getTime())) throw new Error(`--positions-since 를 시각으로 읽을 수 없다: ${arg}`);
      positionsSince = at;
    } else if (arg.startsWith('--include-rule=')) {
      for (const rule of arg.slice('--include-rule='.length).split(',').filter(Boolean)) {
        const known = SHELF_MOVE_RULES.find((r) => r === rule);
        if (!known) throw new Error(`모르는 규칙 ${rule} — ${SHELF_MOVE_RULES.join(', ')} 중에서`);
        includeRules.add(known);
      }
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = Number(arg.slice('--concurrency='.length));
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error(`--concurrency 는 1~16 의 정수다: ${arg}`);
      }
    } else if (arg.startsWith('--warehouse-id=')) warehouseId = arg.slice('--warehouse-id='.length);
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else throw new Error(`모르는 인자 ${arg}`);
  }
  if (apply && !positionsSince) {
    throw new Error(
      '--apply 는 --positions-since=<T 당일 load-shelf-positions 직전 시각> 이 있어야 한다 — 낡은 위치 행으로 옮기지 않게',
    );
  }
  return { apply, warehouseId, positionsSince, includeRules, concurrency, out };
}

type GuardReason = 'protected' | 'allocated' | 'inconsistent';

export type ShelfMoveRow = {
  warehouseId: string;
  skuId: string;
  skuCode: string;
  positionText: string | null;
  /** 입고기본존 ON_HAND */
  qty: number;
  outcome: 'moved' | 'would-move' | 'failed' | `keep:${ShelfKeepReason | GuardReason}`;
  movedQty: number;
  toCode: string | null;
  /** keep:unconfirmed 일 때 꺼져 있던 고쳐 읽기 규칙 */
  rule?: ShelfMoveRule;
  error?: string;
};

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function keptRowsCsv(rows: ShelfMoveRow[]): string {
  const lines = ['warehouse_id,sku_code,reason,qty,position_text'];
  const line = (r: ShelfMoveRow, reason: string, qty: number) =>
    [r.warehouseId, r.skuCode, reason, String(qty), r.positionText ?? ''].map(csvCell).join(',');
  for (const r of rows) {
    if (r.outcome.startsWith('keep:')) lines.push(line(r, r.outcome.slice('keep:'.length), r.qty));
    else if (r.outcome === 'failed') lines.push(line(r, 'failed', r.qty));
    else if (r.movedQty < r.qty) lines.push(line(r, 'protected', r.qty - r.movedQty));
  }
  return lines.join('\n') + '\n';
}

type Candidate = {
  warehouse_id: string;
  sku_id: string;
  sku_code: string;
  qty: number;
  from_location_id: string;
  position_code: string | null;
  position_updated_at: Date | string | null;
  allocated: boolean;
  shelves_with_stock: string[] | null;
};

async function readCandidates(db: PostgresJsDatabase<typeof wmsSchema>, warehouseId: string): Promise<Candidate[]> {
  return db.execute<Candidate>(sql`
    SELECT l.warehouse_id, l.sku_id, k.code AS sku_code, l.qty, l.location_id AS from_location_id,
           p.position_code, p.updated_at AS position_updated_at,
           EXISTS (SELECT 1 FROM picking_source_allocations a
                     JOIN shipment_lines sl ON sl.id = a.shipment_line_id
                     JOIN outbound_batch_work_items wi ON wi.id = a.work_item_id
                    WHERE a.source_location_id = l.location_id AND sl.sku_id = l.sku_id AND a.qty > 0
                      AND wi.status NOT IN ('excluded','completed')) AS allocated,
           (SELECT array_agg(o_loc.code) FROM stock_ledgers o
              JOIN locations o_loc ON o_loc.id = o.location_id
             WHERE o.sku_id = l.sku_id AND o.warehouse_id = l.warehouse_id
               AND o.stock_state = 'ON_HAND' AND o.qty > 0 AND o_loc.location_type = 'standard') AS shelves_with_stock
      FROM stock_ledgers l
      JOIN locations src ON src.id = l.location_id AND src.system_role = 'inbound_default'
      JOIN warehouses w ON w.id = l.warehouse_id AND w.is_sellable
      JOIN skus k ON k.id = l.sku_id
      LEFT JOIN sku_shelf_positions p ON p.sku_id = l.sku_id
     WHERE l.stock_state = 'ON_HAND' AND l.qty > 0 AND l.warehouse_id = ${warehouseId}
     ORDER BY k.code`);
}

async function readShelves(
  db: PostgresJsDatabase<typeof wmsSchema>,
  warehouseId: string,
): Promise<Map<string, string>> {
  const rows = await db.execute<{ id: string; code: string }>(sql`
    SELECT id, code FROM locations
     WHERE is_active AND NOT is_system AND location_type = 'standard' AND warehouse_id = ${warehouseId}`);
  return new Map(rows.map((r) => [r.code, r.id]));
}

function conflictCode(e: unknown): string | undefined {
  if (!(e instanceof ConflictException)) return undefined;
  const body: unknown = e.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
    ? body.code
    : undefined;
}

function errorText(e: HttpException | ApplicationException): string {
  if (e instanceof HttpException) {
    const body = e.getResponse();
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
  return e.message;
}

export async function runShelfMove(
  db: PostgresJsDatabase<typeof wmsSchema>,
  deps: { movement: MovementService; guard: BatchControlledStockGuard },
  opts: ShelfMoveOptions,
  /** 행이 정해질 때마다 부른다 — 진행 표시와, 중간에 죽어도 그때까지의 결과를 남기는 데 쓴다 */
  onRow?: (row: ShelfMoveRow) => void,
): Promise<ShelfMoveRow[]> {
  const candidates = await readCandidates(db, opts.warehouseId);
  const codes = await readShelves(db, opts.warehouseId);
  return mapPool(candidates, opts.concurrency ?? 1, (c) => decide(db, deps, opts, codes, c), onRow);
}

/**
 * items 를 n 개씩 동시에 fn 에 넘긴다. 결과는 입력 순서, onDone 은 끝나는 대로.
 * 하나가 던지면 새 일을 시작하지 않고, 이미 돌던 일이 끝난 뒤 그 오류로 끝난다 — 그때까지 끝난 행은 onDone 으로 나갔다.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T) => Promise<R>,
  onDone?: (result: R) => void,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
        onDone?.(results[i]);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  if (failures.length > 0) throw failures[0];
  return results;
}

function codeOf(x: unknown): unknown {
  return typeof x === 'object' && x !== null && 'code' in x ? x.code : undefined;
}

/** 교착(40P01)·직렬화 실패(40001) — 트랜잭션이 통째로 롤백되니 같은 명령을 다시 보내도 된다. drizzle 이 감싸면 cause 에 있다. */
export function isRetryableTxError(e: unknown): boolean {
  const cause = typeof e === 'object' && e !== null && 'cause' in e ? e.cause : undefined;
  return [codeOf(e), codeOf(cause)].some((c) => c === '40P01' || c === '40001');
}

async function decide(
  db: PostgresJsDatabase<typeof wmsSchema>,
  deps: { movement: MovementService; guard: BatchControlledStockGuard },
  opts: ShelfMoveOptions,
  codes: Map<string, string>,
  c: Candidate,
): Promise<ShelfMoveRow> {
  const qty = Number(c.qty);
  const row: ShelfMoveRow = {
    warehouseId: c.warehouse_id,
    skuId: c.sku_id,
    skuCode: c.sku_code,
    positionText: c.position_code,
    qty,
    outcome: 'failed',
    movedQty: 0,
    toCode: null,
  };
  const verdict = judgeShelfMove({
    position:
      c.position_code === null || c.position_updated_at === null
        ? null
        : { code: c.position_code, updatedAt: new Date(c.position_updated_at) },
    freshSince: opts.positionsSince,
    locationCodes: new Set(codes.keys()),
    shelvesWithStock: c.shelves_with_stock ?? [],
    includeRules: opts.includeRules,
  });
  if (verdict.kind === 'keep') {
    row.outcome = `keep:${verdict.reason}`;
    if (verdict.reason === 'unconfirmed') row.rule = verdict.rule;
    return row;
  }
  row.toCode = verdict.toCode;
  if (c.allocated) {
    row.outcome = 'keep:allocated';
    return row;
  }

  let available: number;
  let stockVersion: number | null;
  try {
    const a = await db.transaction((tx) =>
      deps.guard.getAvailability(
        { skuId: c.sku_id, warehouseId: c.warehouse_id, sourceLocationId: c.from_location_id },
        tx,
      ),
    );
    available = a.generallyAvailableQty;
    stockVersion = a.stockVersion;
  } catch (e) {
    if (conflictCode(e) !== 'INBOUND_ORIGIN_STOCK_INCONSISTENT') throw e;
    row.outcome = 'keep:inconsistent';
    return row;
  }
  if (available <= 0) {
    row.outcome = 'keep:protected';
    return row;
  }
  if (!opts.apply) {
    row.outcome = 'would-move';
    row.movedQty = available;
    return row;
  }

  // judgeShelfMove 는 codes 의 키로만 move 를 낸다 — 없으면 판정과 조회가 갈린 것이다.
  const toLocationId = codes.get(verdict.toCode);
  if (!toLocationId) throw new Error(`판정한 선반 ${verdict.toCode} 의 로케이션 id 가 없다`);
  const dto = {
    warehouseId: c.warehouse_id,
    actorId: SYSTEM_ACTOR,
    memo: MEMO,
    idempotencyKey: `cutover-1236:${c.warehouse_id}:${c.sku_id}:${stockVersion ?? 0}`,
    lines: [
      {
        skuId: c.sku_id,
        fromLocationId: c.from_location_id,
        toLocationId,
        quantity: available,
      },
    ],
  };
  try {
    try {
      await deps.movement.moveImmediately(dto);
    } catch (e) {
      // 동시 실행에서 같은 상품에 걸린 SKU 끼리 드물게 교착될 수 있다 — 한 번만 다시 보낸다(같은 멱등키, 롤백돼 소비되지 않았다).
      if (!isRetryableTxError(e)) throw e;
      await deps.movement.moveImmediately(dto);
    }
    row.outcome = 'moved';
    row.movedQty = available;
  } catch (e) {
    // SKU 하나의 도메인 거절(목적지 비활성·수량 부족·멱등 충돌 등)만 기록하고 넘어간다. 그 밖(DB 연결 등)은 멈춘다.
    if (!(e instanceof HttpException) && !(e instanceof ApplicationException)) throw e;
    row.outcome = 'failed';
    row.error = errorText(e);
  }
  return row;
}

function summarize(rows: ShelfMoveRow[], apply: boolean): void {
  const sum = (rs: ShelfMoveRow[], f: (r: ShelfMoveRow) => number) => rs.reduce((s, r) => s + f(r), 0);
  const moved = rows.filter((r) => r.outcome === (apply ? 'moved' : 'would-move'));
  console.log(
    `${apply ? '✅ 옮김' : '🔍 옮길 것(DRY-RUN — DB 미반영)'} SKU ${moved.length}개 · ${sum(moved, (r) => r.movedQty)}개`,
  );
  const byReason = new Map<string, ShelfMoveRow[]>();
  for (const r of rows.filter((x) => x.outcome.startsWith('keep:'))) {
    const list = byReason.get(r.outcome) ?? [];
    list.push(r);
    byReason.set(r.outcome, list);
  }
  for (const [reason, list] of [...byReason].sort()) {
    console.log(`   남김 ${reason.slice('keep:'.length)}: SKU ${list.length}개 · ${sum(list, (r) => r.qty)}개`);
  }
  // 현장 확인은 규칙마다 한다 — 어느 규칙을 켜면 몇 SKU 가 더 옮겨지는지 따로 보인다.
  for (const rule of SHELF_MOVE_RULES) {
    const off = rows.filter((r) => r.outcome === 'keep:unconfirmed' && r.rule === rule);
    if (off.length > 0) {
      console.log(
        `     └ 규칙 ${rule} 꺼짐: SKU ${off.length}개 · ${sum(off, (r) => r.qty)}개 — 현장 확인 뒤 --include-rule=${rule}`,
      );
    }
  }
  const partial = moved.filter((r) => r.movedQty < r.qty);
  if (partial.length) {
    console.log(
      `   일부만(적치 대기·배치 통제분 남김): SKU ${partial.length}개 · ${sum(partial, (r) => r.qty - r.movedQty)}개`,
    );
  }
  const failed = rows.filter((r) => r.outcome === 'failed');
  if (failed.length) {
    console.log(`❌ 실패 ${failed.length}건`);
    for (const r of failed.slice(0, 20)) console.log(`   ${r.skuCode}: ${r.error ?? ''}`);
  }
}

async function main() {
  const args = parseShelfMoveArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }
  // DbService 생성자는 tsx 에서 CJS interop 문제로 못 쓴다 — prototype 만 빌려 클라이언트를 주입한다(close-sellmate-csv-inbound.ts 와 같다).
  const client = postgres(url, { max: args.concurrency + 2 });
  const db = drizzle(client, { schema: wmsSchema });
  const dbService: DbService<typeof wmsSchema> = Object.assign(
    Object.create(DbService.prototype) as DbService<typeof wmsSchema>,
    { _client: client, _db: db },
  );
  try {
    const guard = new BatchControlledStockGuard();
    const sellable = new ProductSellableQuantityService(
      dbService as never,
      outboxPublisherFor(INVENTORY_STREAM, dbService as never),
    );
    const movement = new MovementService(
      dbService,
      new StockEventStore(dbService, sellable, guard),
      new InventoryIdempotencyService(dbService),
    );

    // 셀메이트 위치는 창고 하나의 위치다 — build-location-master 와 같은 규칙으로 창고를 고른다.
    const sellableWarehouses = await db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM warehouses WHERE is_sellable`,
    );
    const warehouseId = args.warehouseId ?? (sellableWarehouses.length === 1 ? sellableWarehouses[0].id : null);
    if (!warehouseId) {
      console.error(`판매 창고가 ${sellableWarehouses.length}개입니다. --warehouse-id 로 고르세요:`);
      for (const w of sellableWarehouses) console.error(`  ${w.id}  ${w.name}`);
      process.exitCode = 1;
      return;
    }
    if (args.includeRules.size) console.log(`켠 고쳐 읽기 규칙: ${[...args.includeRules].join(', ')}`);

    // 행이 정해지는 대로 모은다 — 중간에 죽어도(터널 끊김 등) 그때까지 옮긴 것의 요약·목록을 남긴다.
    const rows: ShelfMoveRow[] = [];
    const started = Date.now();
    try {
      await runShelfMove(db, { movement, guard }, { ...args, warehouseId }, (row) => {
        rows.push(row);
        if (rows.length % PROGRESS_EVERY === 0) {
          const moved = rows.filter((r) => r.outcome === 'moved' || r.outcome === 'would-move').length;
          console.log(`   … ${rows.length}개 처리 (옮김 ${moved}) · ${Math.round((Date.now() - started) / 1000)}초`);
        }
      });
    } finally {
      summarize(rows, args.apply);
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, keptRowsCsv(rows));
      console.log(`\n남긴 SKU 목록 ${rows.length}개 처리분 → ${args.out} (위치 원문이 들어 있다 — 커밋하지 않는다)`);
    }
    if (rows.some((r) => r.outcome === 'failed')) process.exitCode = 1;
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
