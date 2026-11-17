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
const MEMO = 'cutover #1236';

export type ShelfMoveOptions = {
  apply: boolean;
  positionsSince: Date | null;
  includeRules: ReadonlySet<ShelfMoveRule>;
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function parseShelfMoveArgs(argv: string[]): ShelfMoveOptions & { out: string } {
  let apply = false;
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
    } else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else throw new Error(`모르는 인자 ${arg}`);
  }
  if (apply && !positionsSince) {
    throw new Error(
      '--apply 는 --positions-since=<T 당일 load-shelf-positions 직전 시각> 이 있어야 한다 — 낡은 위치 행으로 옮기지 않게',
    );
  }
  return { apply, positionsSince, includeRules, out };
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

async function readCandidates(db: PostgresJsDatabase<typeof wmsSchema>): Promise<Candidate[]> {
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
     WHERE l.stock_state = 'ON_HAND' AND l.qty > 0
     ORDER BY l.warehouse_id, k.code`);
}

async function readShelves(
  db: PostgresJsDatabase<typeof wmsSchema>,
  warehouseIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const byWarehouse = new Map<string, Map<string, string>>();
  if (warehouseIds.length === 0) return byWarehouse;
  const rows = await db.execute<{ warehouse_id: string; id: string; code: string }>(sql`
    SELECT warehouse_id, id, code FROM locations
     WHERE is_active AND NOT is_system AND location_type = 'standard'
       AND warehouse_id = ANY(${sql.param(warehouseIds)}::uuid[])`);
  for (const r of rows) {
    const codes = byWarehouse.get(r.warehouse_id) ?? new Map<string, string>();
    codes.set(r.code, r.id);
    byWarehouse.set(r.warehouse_id, codes);
  }
  return byWarehouse;
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
): Promise<ShelfMoveRow[]> {
  const candidates = await readCandidates(db);
  const shelves = await readShelves(db, [...new Set(candidates.map((c) => c.warehouse_id))]);
  const rows: ShelfMoveRow[] = [];

  for (const c of candidates) {
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
    rows.push(row);
    const codes = shelves.get(c.warehouse_id) ?? new Map<string, string>();
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
      continue;
    }
    row.toCode = verdict.toCode;
    if (c.allocated) {
      row.outcome = 'keep:allocated';
      continue;
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
      continue;
    }
    if (available <= 0) {
      row.outcome = 'keep:protected';
      continue;
    }
    if (!opts.apply) {
      row.outcome = 'would-move';
      row.movedQty = available;
      continue;
    }

    // judgeShelfMove 는 codes 의 키로만 move 를 낸다 — 없으면 판정과 조회가 갈린 것이다.
    const toLocationId = codes.get(verdict.toCode);
    if (!toLocationId) throw new Error(`판정한 선반 ${verdict.toCode} 의 로케이션 id 가 없다`);
    try {
      await deps.movement.moveImmediately({
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
      });
      row.outcome = 'moved';
      row.movedQty = available;
    } catch (e) {
      // SKU 하나의 도메인 거절(목적지 비활성·수량 부족·멱등 충돌 등)만 기록하고 넘어간다. 그 밖(DB 연결 등)은 멈춘다.
      if (!(e instanceof HttpException) && !(e instanceof ApplicationException)) throw e;
      row.outcome = 'failed';
      row.error = errorText(e);
    }
  }
  return rows;
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
  const client = postgres(url, { max: 4 });
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

    if (args.includeRules.size) console.log(`켠 고쳐 읽기 규칙: ${[...args.includeRules].join(', ')}`);
    const rows = await runShelfMove(db, { movement, guard }, args);
    summarize(rows, args.apply);
    if (!args.apply) {
      const unconfirmed = rows.filter((r) => r.outcome === 'keep:unconfirmed').length;
      if (unconfirmed)
        console.log(`   (고쳐 읽은 코드라 스위치가 꺼져 남은 SKU ${unconfirmed}개 — --include-rule 로 켜면 다시 판정)`);
    }

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, keptRowsCsv(rows));
    console.log(`\n남긴 SKU 목록 → ${args.out} (위치 원문이 들어 있다 — 커밋하지 않는다)`);
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
