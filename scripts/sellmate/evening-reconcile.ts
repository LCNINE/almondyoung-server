/**
 * 셀메이트 저녁 맞추기 (#1304). 셀메이트 쪽 변화(마켓 주문·취소·반품)를 core 원장으로 가져오고, core 가용을 셀메이트로
 * 돌려보낼 업로드 CSV 를 만든다. 규칙은 docs/superpowers/specs/2026-11-17-sellmate-evening-reconcile-design.md.
 *
 * 하위 명령 (모두 dry-run 이 기본, `--apply` 일 때만 쓴다. dry-run 은 같은 트랜잭션을 끝까지 돌린 뒤 롤백하고 파일을 쓰지 않는다):
 *   pair   <재고 CSV>                       짝 표만 다시 쓴다(원장 안 건드림). 짝 못 지은 품목이 있으면 1
 *   init   <마지막 sync 재고 CSV> --cutover-at=<T> --sellmate-orders=<미발송 주문 파일> --own-mall-channel=<판매처 이름>
 *                                            T 에 한 번. 기준값·이월·넘긴 주문을 쓴다(원장 안 씀). MEDUSA_DATABASE_URL 필요
 *   apply  <지금 받은 재고 CSV>             원장 반영 + 회차(업로드 대기) + 업로드 CSV
 *   close  <업로드 뒤 다시 받은 재고 CSV> [--accept-landed=<옵션,…>] [--accept-not-landed=<옵션,…>]
 *                                            업로드가 먹었는지 판정하고 기준값을 확정한다. ✗ 면 1(--apply 면 고친 CSV)
 *   status                                   열린 회차·이월·짝 못 지은 품목(읽기 전용)
 *
 * ── 실행 (테넌트 1 core DB — run.sh 가 DATABASE_URL 을, WITH_MEDUSA=1 이면 MEDUSA_DATABASE_URL 도 넣는다) ──
 *   bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/stk_stockList_20261120_180000.csv
 *   bash scripts/sellmate/run.sh live evening-reconcile apply apps/core/tmp/stk_stockList_20261120_180000.csv --apply
 *   WITH_MEDUSA=1 bash scripts/sellmate/run.sh live evening-reconcile init <csv> --cutover-at=2026-11-20T09:00 \
 *     --sellmate-orders=<파일> --own-mall-channel=<자사몰 판매처 이름> --apply
 *
 * 환경변수: OUT_DIR(업로드·고친 CSV 를 쓸 폴더, 기본 apps/core/tmp), UPLOAD_ENCODING(기본 euc-kr), COL_*(열 이름 덮기)
 * `--apply` 로 원장이 바뀐 SKU 는 커밋 뒤 sellable 을 다시 계산한다(recalc-sellable.ts `recalcSellableForSkus`).
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres, { Sql } from 'postgres';
import { readRows } from './parse';
import { parseCollectedAt } from './handover-stock-addback';
import { applyStockDelta } from './stock-delta';
import { readStockCsv } from './reconcile/stock-csv';
import { parseOwnMallDisplayIds } from './reconcile/orders-csv';
import { UploadLine, writeUploadCsv } from './reconcile/upload-csv';
import { Pair, StateRow, Unpaired, compareWithState, pairItems } from './reconcile/pairing';
import { ApplyResult, freshState, initState, planApply, sellmateAvail } from './reconcile/reconcile-math';
import {
  Accept,
  CloseVerdict,
  confirmedBaseline,
  isFixPending,
  isOkVerdict,
  judgeClose,
} from './reconcile/close-verdict';
import {
  RECONCILE_SOURCE,
  RunItemRow,
  closeRunRow,
  dropFrozenStates,
  findRunBySha,
  handoverEventsExist,
  initRun,
  insertHandedOver,
  insertRun,
  insertRunItems,
  lastClosedRun,
  loadCoreIndex,
  loadRunItems,
  loadStates,
  loadUnpairedPairs,
  lockStock,
  openRun,
  readCoreFigures,
  reconcileTablesExist,
  recordCloseAttempt,
  replacePairs,
  resolveMedusaOrderIds,
  resolveSalesOrders,
  setRunUploadFile,
  singleRealLocation,
  updateRunItemClose,
  upsertStates,
} from './reconcile/reconcile-store';

export type Sub = 'pair' | 'init' | 'apply' | 'close' | 'status';
export type CliArgs = {
  sub: Sub;
  stockFile: string | null;
  apply: boolean;
  cutoverAt: Date | null;
  ordersFile: string | null;
  ownMallChannel: string | null;
  acceptLanded: string[];
  acceptNotLanded: string[];
};

const SUBS: readonly Sub[] = ['pair', 'init', 'apply', 'close', 'status'];
const FLAGS: Record<Sub, readonly string[]> = {
  pair: ['--apply'],
  init: ['--apply', '--cutover-at', '--sellmate-orders', '--own-mall-channel'],
  apply: ['--apply'],
  close: ['--apply', '--accept-landed', '--accept-not-landed'],
  status: [],
};

function isSub(v: string): v is Sub {
  return SUBS.some((s) => s === v);
}

function parseCutoverAt(raw: string): Date {
  try {
    return parseCollectedAt(raw);
  } catch {
    throw new Error(`--cutover-at 을 못 읽었다: "${raw}" (예: 2026-11-20T09:00, offset 이 없으면 KST)`);
  }
}

const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [first, ...rest] = argv;
  if (first === undefined || !isSub(first)) {
    throw new Error(`하위 명령이 필요하다: ${SUBS.join('|')} (받은 값: ${first ?? '없음'})`);
  }
  const sub = first;
  const args: CliArgs = {
    sub,
    stockFile: null,
    apply: false,
    cutoverAt: null,
    ordersFile: null,
    ownMallChannel: null,
    acceptLanded: [],
    acceptNotLanded: [],
  };
  for (const arg of rest) {
    if (!arg.startsWith('--')) {
      if (sub === 'status') throw new Error(`status 는 파일을 받지 않는다: ${arg}`);
      if (args.stockFile !== null) throw new Error(`재고 파일은 하나만 받는다: ${args.stockFile}, ${arg}`);
      args.stockFile = arg;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? null : arg.slice(eq + 1);
    if (!FLAGS[sub].includes(name)) throw new Error(`${sub} 에 쓸 수 없는 인자: ${arg}`);
    if (name === '--apply') {
      if (value !== null) throw new Error(`--apply 는 값을 받지 않는다: ${arg}`);
      args.apply = true;
      continue;
    }
    if (value === null || value.trim() === '') throw new Error(`${name}=<값> 꼴이어야 한다: ${arg}`);
    if (name === '--cutover-at') args.cutoverAt = parseCutoverAt(value);
    else if (name === '--sellmate-orders') args.ordersFile = value;
    else if (name === '--own-mall-channel') args.ownMallChannel = value.trim();
    else if (name === '--accept-landed') args.acceptLanded = splitList(value);
    else if (name === '--accept-not-landed') args.acceptNotLanded = splitList(value);
  }
  if (sub !== 'status' && args.stockFile === null) throw new Error(`${sub} 에는 셀메이트 재고 CSV 파일이 필요하다`);
  if (sub === 'init') {
    const missing = [
      args.cutoverAt === null ? '--cutover-at=<T>' : null,
      args.ordersFile === null ? '--sellmate-orders=<T 의 셀메이트 미발송 주문 파일>' : null,
      args.ownMallChannel === null ? '--own-mall-channel=<자사몰 판매처 이름>' : null,
    ].filter((m): m is string => m !== null);
    if (missing.length) throw new Error(`init 에 필요한 인자가 없다: ${missing.join(', ')}`);
  }
  const both = args.acceptLanded.filter((s) => args.acceptNotLanded.includes(s));
  if (both.length)
    throw new Error(`같은 품목을 --accept-landed 와 --accept-not-landed 에 다 지목했다: ${both.join(', ')}`);
  return args;
}

export type Deps = { core: Sql; medusa: Sql | null; outDir: string; now: Date; log: (line: string) => void };
export type StockInput = Awaited<ReturnType<typeof readStockCsv>>;
export type RunOutcome = { exitCode: 0 | 1; touchedSkuIds: string[]; uploadFile: string | null };

type TxResult = { outcome: RunOutcome; commit: boolean };

const NOTHING: RunOutcome = { exitCode: 1, touchedSkuIds: [], uploadFile: null };

/**
 * 연결 하나를 잡아 BEGIN → 잠금 → fn → (apply 이고 fn 이 커밋을 원하면) COMMIT, 아니면 ROLLBACK.
 * dry-run 은 쓰기까지 똑같이 돌고 여기서 되돌린다. reserve 한 연결은 Sql 그대로라 저장소 함수에 캐스트 없이 넘긴다.
 */
async function inTx(d: Deps, apply: boolean, fn: (tx: Sql) => Promise<TxResult>): Promise<RunOutcome> {
  const conn = await d.core.reserve();
  try {
    await conn`BEGIN`;
    let result: TxResult;
    try {
      await lockStock(conn);
      result = await fn(conn);
    } catch (err) {
      await conn`ROLLBACK`.catch(() => undefined);
      throw err;
    }
    if (apply && result.commit) await conn`COMMIT`;
    else await conn`ROLLBACK`;
    return result.outcome;
  } finally {
    conn.release();
  }
}

function refuse(d: Deps, message: string): TxResult {
  d.log(`⛔ ${message} — 아무것도 쓰지 않았다.`);
  return { outcome: NOTHING, commit: false };
}

/** 공통 거절: 테이블 없음, CSV 값 오류. 거절이면 사유, 아니면 null */
async function commonRefusal(tx: Sql, d: Deps, stock: StockInput | null): Promise<string | null> {
  if (!(await reconcileTablesExist(tx))) {
    return '맞추기 테이블이 없다 — 먼저 npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes';
  }
  if (stock && stock.errors.length) {
    for (const e of stock.errors.slice(0, 30)) d.log(`   ${e}`);
    if (stock.errors.length > 30) d.log(`   … 외 ${stock.errors.length - 30}건`);
    return `재고 CSV 값 오류 ${stock.errors.length}건 — 0 으로 추정하지 않는다`;
  }
  return null;
}

function summaryLine(c: { up: number; down: number; carry: number; unpaired: number; fresh: number }): string {
  return `UP ${c.up}품목 · DOWN ${c.down}품목 · 이월 ${c.carry}품목 · 짝 못 지음 ${c.unpaired}품목 · 새 품목 ${c.fresh}`;
}

function logExcluded(d: Deps, stock: StockInput): void {
  for (const [reason, count] of stock.excluded) d.log(`   제외 ${count}행 — ${reason}`);
}

function logUnpaired(d: Deps, unpaired: readonly Unpaired[]): void {
  if (unpaired.length === 0) return;
  d.log(`\n짝 못 지은 품목 ${unpaired.length}:`);
  for (const u of unpaired) d.log(`   ${u.optionSerial}  ${u.reason}  바코드=${u.barcode || '(빈칸)'}  ${u.name}`);
}

function requireValue<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`${what} 를 찾지 못했다: ${String(key)}`);
  return v;
}

// ── pair ──────────────────────────────────────────────────────────────────────

export async function runPair(d: Deps, stock: StockInput, apply: boolean): Promise<RunOutcome> {
  return inTx(d, apply, async (tx) => {
    const refusal = await commonRefusal(tx, d, stock);
    if (refusal) return refuse(d, refusal);
    const { pairs, unpaired } = pairItems(stock.rows, await loadCoreIndex(tx));
    await replacePairs(tx, pairs, unpaired);
    d.log(`짝 ${pairs.length}품목 · 짝 못 지음 ${unpaired.length}품목`);
    logExcluded(d, stock);
    logUnpaired(d, unpaired);
    d.log(apply ? '\n✅ 짝 표를 다시 썼다.' : '\n✅ DRY-RUN — 짝 표 미반영. 반영은 --apply.');
    return { outcome: { exitCode: unpaired.length ? 1 : 0, touchedSkuIds: [], uploadFile: null }, commit: true };
  });
}

// ── init ──────────────────────────────────────────────────────────────────────

export async function runInit(
  d: Deps,
  stock: StockInput,
  handedOver: readonly { displayId: number; medusaOrderId: string }[],
  cutoverAt: Date,
  apply: boolean,
): Promise<RunOutcome> {
  return inTx(d, apply, async (tx) => {
    const refusal = await commonRefusal(tx, d, stock);
    if (refusal) return refuse(d, refusal);
    const existing = await initRun(tx);
    if (existing)
      return refuse(
        d,
        `init 은 이미 돌았다(회차 ${existing.id}, T=${existing.cutoverAt?.toISOString()}) — 한 번만 돈다`,
      );
    if (await handoverEventsExist(tx))
      return refuse(d, "'sellmate-handover' 원장 이벤트가 있다 — 맞추기와 섞지 않는다(#1306)");

    const { pairs, unpaired } = pairItems(stock.rows, await loadCoreIndex(tx));
    if (unpaired.length) {
      d.log(summaryLine({ up: 0, down: 0, carry: 0, unpaired: unpaired.length, fresh: 0 }));
      logUnpaired(d, unpaired);
      return refuse(d, `짝 못 지은 품목 ${unpaired.length}개 — pair 로 짝 표를 고친 뒤 다시`);
    }

    const salesOrderByMedusa = await resolveSalesOrders(
      tx,
      handedOver.map((h) => h.medusaOrderId),
    );
    const unresolved = handedOver.filter((h) => !salesOrderByMedusa.has(h.medusaOrderId));
    if (unresolved.length) {
      d.log(`\ncore 판매주문을 못 찾은 넘긴 주문 ${unresolved.length}건:`);
      for (const h of unresolved) d.log(`   display_id=${h.displayId}  medusa=${h.medusaOrderId}`);
      return refuse(d, '넘긴 주문을 전부 core 판매주문으로 찾아야 한다 — 빠진 주문은 그만큼 두 번 빠진다');
    }

    const runId = await insertRun(tx, {
      kind: 'init',
      status: 'closed',
      inputSha256: stock.sha256,
      inputSnapshotAt: stock.snapshotAt,
      cutoverAt,
      uploadFile: null,
    });
    await replacePairs(tx, pairs, []);
    await insertHandedOver(
      tx,
      runId,
      handedOver.map((h) => ({
        salesOrderId: requireValue(salesOrderByMedusa, h.medusaOrderId, '판매주문'),
        displayId: h.displayId,
        medusaOrderId: h.medusaOrderId,
      })),
    );

    const rowBySerial = new Map(stock.rows.map((r) => [r.optionSerial, r]));
    const items: RunItemRow[] = [];
    const states: (StateRow & { lastRunId: string })[] = [];
    for (const p of pairs) {
      const row = requireValue(rowBySerial, p.optionSerial, '재고 행');
      const s = sellmateAvail(row.current, row.unshipped);
      const start = initState(s);
      // init 품목은 «시작 상태» 를 전후 양쪽에 적는다(칸이 NOT NULL 이고, init 은 원장·업로드가 없다)
      items.push({
        optionSerial: p.optionSerial,
        skuId: p.skuId,
        sellmateCurrent: row.current,
        sellmateUnshipped: row.unshipped,
        s,
        baselineBefore: start.baseline,
        carryBefore: start.carry,
        delta: 0,
        carryAfter: start.carry,
        uploadAvail: null,
        uploadedCurrent: null,
        refUnshipped: null,
      });
      states.push({ skuId: p.skuId, optionSerial: p.optionSerial, ...start, frozen: false, lastRunId: runId });
    }
    await insertRunItems(tx, runId, items);
    await upsertStates(tx, states);

    const negative = items.filter((i) => i.carryAfter > 0);
    d.log(summaryLine({ up: 0, down: 0, carry: negative.length, unpaired: 0, fresh: pairs.length }));
    logExcluded(d, stock);
    d.log(`   T=${cutoverAt.toISOString()} · 넘긴 자사몰 주문 ${handedOver.length}건 · 원장은 쓰지 않는다`);
    if (negative.length) {
      d.log('\n셀메이트 가용이 음수인 품목(기준값=S, 이월=−S):');
      for (const i of negative) d.log(`   ${i.optionSerial}  S=${i.s}  이월=${i.carryAfter}`);
    }
    d.log(
      apply
        ? `\n✅ init 반영(회차 ${runId}, 닫힘). 첫 apply 가 셀메이트에 올린다.`
        : '\n✅ DRY-RUN — DB 미반영. 반영은 --apply.',
    );
    return { outcome: { exitCode: 0, touchedSkuIds: [], uploadFile: null }, commit: true };
  });
}

// ── apply ─────────────────────────────────────────────────────────────────────

type Planned = {
  pair: Pair;
  fresh: boolean;
  current: number;
  unshipped: number;
  s: number;
  baselineBefore: number;
  carryBefore: number;
  plan: ApplyResult;
};

export async function runApply(d: Deps, stock: StockInput, apply: boolean): Promise<RunOutcome> {
  return inTx(d, apply, async (tx) => {
    const refusal = await commonRefusal(tx, d, stock);
    if (refusal) return refuse(d, refusal);
    if (!(await initRun(tx))) return refuse(d, 'init 이 아직 없다 — T 에 init 을 먼저 돌린다');
    if (await handoverEventsExist(tx))
      return refuse(d, "'sellmate-handover' 원장 이벤트가 있다 — 맞추기와 섞지 않는다(#1306)");

    const same = await findRunBySha(tx, stock.sha256);
    if (same) {
      d.log(`이 파일은 이미 반영했다(회차 ${same.id}, ${same.kind}/${same.status}) — 원장을 다시 쓰지 않는다.`);
      if (same.uploadFile) d.log(`   업로드 파일: ${same.uploadFile}`);
      return { outcome: { exitCode: 0, touchedSkuIds: [], uploadFile: same.uploadFile }, commit: false };
    }
    const open = await openRun(tx);
    if (open) {
      return refuse(
        d,
        `열린 회차가 있다(회차 ${open.id}, 업로드 ${open.uploadFile ?? '-'}) — 업로드 뒤 close 로 먼저 닫는다`,
      );
    }
    const last = await lastClosedRun(tx);
    const ref = last ? (last.closeSnapshotAt ?? last.inputSnapshotAt) : null;
    if (ref && stock.snapshotAt.getTime() <= ref.getTime()) {
      return refuse(
        d,
        `재고 CSV 시각 ${stock.snapshotAt.toISOString()} 이 직전 회차(${last?.id})의 ${last?.closeSnapshotAt ? '닫기' : 'init'} 입력 ${ref.toISOString()} 보다 늦지 않다 — 새로 받은 파일로 다시`,
      );
    }

    const { pairs, unpaired } = pairItems(stock.rows, await loadCoreIndex(tx));
    const states = await loadStates(tx);
    const cmp = compareWithState(pairs, states, stock.excludedSerials);
    const blocked = unpaired.length + cmp.missing.length + cmp.skuChanged.length;
    if (blocked) {
      d.log(summaryLine({ up: 0, down: 0, carry: 0, unpaired: blocked, fresh: cmp.fresh.length }));
      logUnpaired(d, unpaired);
      if (cmp.missing.length) {
        d.log(`\n기준값이 있는데 이번 CSV 에 없는 품목 ${cmp.missing.length}:`);
        for (const m of cmp.missing) d.log(`   ${m.optionSerial}  sku=${m.skuId}`);
      }
      if (cmp.skuChanged.length) {
        d.log(`\n다른 SKU 로 다시 짝지어진 품목 ${cmp.skuChanged.length}:`);
        for (const c of cmp.skuChanged) d.log(`   ${c.pair.optionSerial}  ${c.state.skuId} → ${c.pair.skuId}`);
      }
      return refuse(d, `짝 못 지은·사라진·SKU 가 바뀐 품목 ${blocked}개 — 짝 표를 고칠 때까지 반영하지 않는다`);
    }

    const rowBySerial = new Map(stock.rows.map((r) => [r.optionSerial, r]));
    const stateBySerial = new Map(states.map((s) => [s.optionSerial, s]));
    const figures = await readCoreFigures(
      tx,
      [...cmp.known, ...cmp.fresh].map((p) => p.skuId),
    );
    const planned: Planned[] = [];
    for (const [pair, fresh] of [
      ...cmp.known.map((p): [Pair, boolean] => [p, false]),
      ...cmp.fresh.map((p): [Pair, boolean] => [p, true]),
    ]) {
      const row = requireValue(rowBySerial, pair.optionSerial, '재고 행');
      const f = requireValue(figures, pair.skuId, 'core 수치');
      const s = sellmateAvail(row.current, row.unshipped);
      // 새 품목은 기준값 S·이월 = 미발송으로 시작해 같은 회에 planApply 를 탄다 — core 가 그 미발송을 지금 뺀다(freshState 주석)
      const st = fresh ? freshState(s, row.unshipped) : requireValue(stateBySerial, pair.optionSerial, '품목 상태');
      const plan = planApply({ s, baseline: st.baseline, carry: st.carry, ...f, unshipped: row.unshipped });
      planned.push({
        pair,
        fresh,
        current: row.current,
        unshipped: row.unshipped,
        s,
        baselineBefore: st.baseline,
        carryBefore: st.carry,
        plan,
      });
    }
    planned.sort((a, b) => (a.pair.optionSerial < b.pair.optionSerial ? -1 : 1));

    d.log(
      summaryLine({
        up: planned.filter((p) => p.plan.delta > 0).length,
        down: planned.filter((p) => p.plan.delta < 0).length,
        carry: planned.filter((p) => p.plan.carryAfter > 0).length,
        unpaired: 0,
        fresh: cmp.fresh.length,
      }),
    );
    const shown = planned.filter((p) => p.fresh || p.plan.delta !== 0 || p.plan.carryAfter > 0 || p.carryBefore > 0);
    if (shown.length) {
      d.log('   옵션정보일련번호  S  기준값  이월 전→후  원장  올릴가용  올릴현재재고');
      for (const p of shown) {
        d.log(
          `   ${p.pair.optionSerial}  ${p.s}  ${p.baselineBefore}  ${p.carryBefore}→${p.plan.carryAfter}  ` +
            `${p.plan.delta > 0 ? '+' : ''}${p.plan.delta}  ${p.plan.uploadAvail}  ${p.plan.uploadCurrent}${p.fresh ? '  [새 품목]' : ''}`,
        );
      }
    }
    logExcluded(d, stock);
    if (cmp.toFreeze.length) d.log(`   제외 목록에 새로 들어가 상태를 얼린 품목 ${cmp.toFreeze.length}`);

    const touched: string[] = [];
    for (const p of planned) {
      if (p.plan.delta === 0) continue;
      const upLocationId = p.plan.delta > 0 ? ((await singleRealLocation(tx, p.pair.skuId)) ?? undefined) : undefined;
      await applyStockDelta(tx, {
        skuId: p.pair.skuId,
        delta: p.plan.delta,
        source: RECONCILE_SOURCE,
        label: p.pair.optionSerial,
        occurredAt: d.now,
        upLocationId,
      });
      touched.push(p.pair.skuId);
    }

    await replacePairs(tx, pairs, []);
    const runId = await insertRun(tx, {
      kind: 'apply',
      status: 'awaiting_close',
      inputSha256: stock.sha256,
      inputSnapshotAt: stock.snapshotAt,
      cutoverAt: null,
      uploadFile: null,
    });
    const uploadFile = path.join(d.outDir, `sellmate-reconcile-${runId}-upload.csv`);
    await setRunUploadFile(tx, runId, uploadFile);
    await insertRunItems(
      tx,
      runId,
      planned.map((p) => ({
        optionSerial: p.pair.optionSerial,
        skuId: p.pair.skuId,
        sellmateCurrent: p.current,
        sellmateUnshipped: p.unshipped,
        s: p.s,
        baselineBefore: p.baselineBefore,
        carryBefore: p.carryBefore,
        delta: p.plan.delta,
        carryAfter: p.plan.carryAfter,
        uploadAvail: p.plan.uploadAvail,
        uploadedCurrent: p.plan.uploadCurrent,
        refUnshipped: p.unshipped,
      })),
    );
    // 기준값은 close 가 확정한다 — 여기서는 이월(원장과 같이 커밋된다)과 새 품목·얼린 품목만 쓴다
    await dropFrozenStates(
      tx,
      cmp.fresh.map((p) => p.optionSerial),
    );
    await upsertStates(tx, [
      ...planned.map((p) => ({
        skuId: p.pair.skuId,
        optionSerial: p.pair.optionSerial,
        baseline: p.baselineBefore,
        carry: p.plan.carryAfter,
        frozen: false,
        lastRunId: runId,
      })),
      ...cmp.toFreeze.map((s) => ({ ...s, frozen: true, lastRunId: runId })),
    ]);

    const lines: UploadLine[] = planned.map((p) => ({ barcode: p.pair.barcode, current: p.plan.uploadCurrent }));
    if (apply) {
      fs.mkdirSync(d.outDir, { recursive: true });
      writeUploadCsv(uploadFile, lines);
      d.log(`\n✅ 반영(회차 ${runId}, 업로드 대기). 업로드 파일 ${lines.length}품목: ${uploadFile}`);
      d.log('   셀메이트 재고수정에 올린 뒤 재고 현황을 다시 받아 close 를 돌린다.');
    } else {
      d.log(`\n✅ DRY-RUN — DB 미반영, 파일 안 씀(업로드 ${lines.length}품목). 반영은 --apply.`);
    }
    return { outcome: { exitCode: 0, touchedSkuIds: touched, uploadFile: apply ? uploadFile : null }, commit: true };
  });
}

// ── close ─────────────────────────────────────────────────────────────────────

type Judged = {
  item: RunItemRow;
  /** 이번 닫기의 비교 기준(회차 품목 칸, 고친 CSV 를 만들었으면 고친 값) */
  uploadedCurrent: number;
  refUnshipped: number;
  verdict: CloseVerdict;
  accept: Accept;
  now: { current: number; unshipped: number } | null;
  corrected: number | null;
};

export async function runClose(
  d: Deps,
  stock: StockInput,
  accept: { landed: string[]; notLanded: string[] },
  apply: boolean,
): Promise<RunOutcome> {
  return inTx(d, apply, async (tx) => {
    const refusal = await commonRefusal(tx, d, stock);
    if (refusal) return refuse(d, refusal);
    const run = await openRun(tx);
    if (!run) return refuse(d, '열린 회차가 없다 — apply 뒤에만 닫는다');
    // 닫지 못한 시도가 있었으면 그 입력보다도 늦어야 한다 — 같은 CSV 를 고친 기준에 다시 대지 않게
    const attempt = run.closeSnapshotAt;
    const floor = attempt && attempt.getTime() > run.inputSnapshotAt.getTime() ? attempt : run.inputSnapshotAt;
    if (stock.snapshotAt.getTime() <= floor.getTime()) {
      return refuse(
        d,
        `닫기 CSV 시각 ${stock.snapshotAt.toISOString()} 이 ${floor === attempt ? '직전 닫기 시도' : '회차'} 입력 ${floor.toISOString()} 보다 늦지 않다 — ` +
          '업로드(고친 파일이 있으면 그것까지) 뒤에 새로 받은 파일이어야 한다',
      );
    }
    const items = await loadRunItems(tx, run.id);
    const serials = new Set(items.map((i) => i.optionSerial));
    const unknown = [...accept.landed, ...accept.notLanded].filter((s) => !serials.has(s));
    if (unknown.length) return refuse(d, `회차에 없는 품목을 지목했다: ${unknown.join(', ')}`);

    const rowBySerial = new Map(stock.rows.map((r) => [r.optionSerial, r]));
    const judged: Judged[] = items.map((item) => {
      const { uploadedCurrent, refUnshipped, uploadAvail } = item;
      if (uploadedCurrent === null || refUnshipped === null || uploadAvail === null) {
        throw new Error(`apply 회차 품목에 올린 값이 없다: 회차 ${run.id} ${item.optionSerial}`);
      }
      const row = rowBySerial.get(item.optionSerial);
      const now = row ? { current: row.current, unshipped: row.unshipped } : null;
      const fixPending = isFixPending({
        uploadAvail,
        sellmateUnshipped: item.sellmateUnshipped,
        uploadedCurrent,
        refUnshipped,
        closeVerdict: item.closeVerdict,
      });
      const { verdict, correctedCurrent } = judgeClose({ uploadedCurrent, refUnshipped, now, fixPending });
      const a: Accept = accept.landed.includes(item.optionSerial)
        ? 'landed'
        : accept.notLanded.includes(item.optionSerial)
          ? 'not_landed'
          : null;
      return { item, uploadedCurrent, refUnshipped, verdict, accept: a, now, corrected: correctedCurrent };
    });
    const failed = judged.filter((j) => j.accept === null && !isOkVerdict(j.verdict));

    // 고친 CSV 를 만드는 품목은 비교 기준을 바꿔 저장한다 — 올린 현재재고 := 고친 값, 기준 미발송 := 이번 닫기의 미발송.
    // 그래야 고친 파일을 올리고 다시 닫을 때 같은 ✗ 가 되풀이되지 않는다(설계 «닫기 확인»).
    const fixes: { serial: string; barcode: string; current: number }[] = [];
    for (const j of judged) {
      let reference: { uploadedCurrent: number; refUnshipped: number } | Record<string, never> = {};
      if (j.accept === null && j.verdict === 'shipped_before_upload' && j.corrected !== null && j.now !== null) {
        reference = { uploadedCurrent: j.corrected, refUnshipped: j.now.unshipped };
        const barcode = requireValue(rowBySerial, j.item.optionSerial, '재고 행').barcode;
        fixes.push({ serial: j.item.optionSerial, barcode, current: j.corrected });
      }
      await updateRunItemClose(tx, run.id, j.item.optionSerial, { verdict: j.verdict, accept: j.accept, ...reference });
    }

    const accepted = judged.filter((j) => j.accept !== null).length;
    if (failed.length) {
      d.log(
        `닫기 ✗ ${failed.length}품목 · 정상 ${judged.length - failed.length - accepted}품목 · 지목 ${accepted}품목`,
      );
      d.log('   옵션정보일련번호  판정  올린현재재고  기준미발송  지금현재재고  지금미발송  고친값');
      for (const j of failed) {
        d.log(
          `   ${j.item.optionSerial}  ${j.verdict}  ${j.uploadedCurrent}  ${j.refUnshipped}  ` +
            `${j.now?.current ?? '-'}  ${j.now?.unshipped ?? '-'}  ${j.corrected ?? '-'}`,
        );
      }
      let fixFile: string | null = null;
      if (fixes.length) {
        const lines: UploadLine[] = fixes.map((f) => ({ barcode: f.barcode, current: f.current }));
        if (apply) {
          fixFile = path.join(d.outDir, `sellmate-reconcile-${run.id}-fix.csv`);
          fs.mkdirSync(d.outDir, { recursive: true });
          writeUploadCsv(fixFile, lines);
          d.log(`\n고친 업로드 파일 ${lines.length}품목: ${fixFile} — 올리고 다시 받아 close 를 다시 돌린다.`);
        } else {
          d.log(`\n(DRY-RUN) --apply 면 고친 업로드 파일 ${lines.length}품목을 쓰고 비교 기준을 바꾼다.`);
        }
      }
      d.log(
        '\n원인을 알고 그대로 닫으려면 품목을 지목한다: --accept-landed=<업로드는 먹음> / --accept-not-landed=<업로드가 안 먹음>',
      );
      d.log(`⛔ 회차 ${run.id} 를 닫지 않았다.`);
      // R2: --apply 면 판정·고친 비교 기준·고친 파일·이 시도의 입력 시각은 남기고(커밋) 회차는 열어 둔다
      await recordCloseAttempt(tx, run.id, stock.sha256, stock.snapshotAt);
      return { outcome: { exitCode: 1, touchedSkuIds: [], uploadFile: fixFile }, commit: true };
    }

    const states = await loadStates(tx);
    const stateBySku = new Map(states.map((s) => [s.skuId, s]));
    await upsertStates(
      tx,
      judged.map((j) => {
        const st = requireValue(stateBySku, j.item.skuId, '품목 상태');
        const baseline = confirmedBaseline({
          uploadedCurrent: j.uploadedCurrent,
          refUnshipped: j.refUnshipped,
          applyS: j.item.s,
          accept: j.accept,
        });
        return { ...st, baseline, lastRunId: run.id };
      }),
    );
    await closeRunRow(tx, run.id, stock.sha256, stock.snapshotAt, {
      landed: accept.landed,
      notLanded: accept.notLanded,
    });
    d.log(`닫기 ✓ ${judged.length}품목 (지목 landed ${accept.landed.length} · not_landed ${accept.notLanded.length})`);
    d.log(apply ? `\n✅ 회차 ${run.id} 를 닫고 기준값을 확정했다.` : '\n✅ DRY-RUN — DB 미반영. 반영은 --apply.');
    return { outcome: { exitCode: 0, touchedSkuIds: [], uploadFile: null }, commit: true };
  });
}

// ── status ────────────────────────────────────────────────────────────────────

export async function runStatus(d: Deps): Promise<RunOutcome> {
  return inTx(d, false, async (tx) => {
    const refusal = await commonRefusal(tx, d, null);
    if (refusal) return refuse(d, refusal);
    const init = await initRun(tx);
    const open = await openRun(tx);
    const last = await lastClosedRun(tx);
    const states = await loadStates(tx);
    const unpaired = await loadUnpairedPairs(tx);
    const carrying = states.filter((s) => !s.frozen && s.carry > 0);

    d.log(
      init
        ? `init: 회차 ${init.id} · T=${init.cutoverAt?.toISOString() ?? '-'} · 입력 ${init.inputSnapshotAt.toISOString()}`
        : 'init: 없음',
    );
    d.log(
      open
        ? `열린 회차: ${open.id} awaiting_close · 입력 ${open.inputSnapshotAt.toISOString()} · 만든 시각 ${open.createdAt.toISOString()} · 업로드 ${open.uploadFile ?? '-'}`
        : '열린 회차: 없음',
    );
    if (last) {
      d.log(
        `마지막 닫힌 회차: ${last.id} (${last.kind}) · 입력 ${last.inputSnapshotAt.toISOString()} · 닫기 입력 ${last.closeSnapshotAt?.toISOString() ?? '-'}`,
      );
    }
    d.log(
      `품목 상태 ${states.length} · 얼린 품목 ${states.filter((s) => s.frozen).length} · 이월 ${carrying.length}품목`,
    );
    for (const s of carrying) d.log(`   이월 ${s.optionSerial}  ${s.carry}`);
    d.log(`짝 못 지은 품목(마지막 짝 표) ${unpaired.length}`);
    for (const u of unpaired) d.log(`   ${u.optionSerial}  ${u.reason}`);
    return { outcome: { exitCode: 0, touchedSkuIds: [], uploadFile: null }, commit: false };
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

class RefusedError extends Error {}

async function handedOverFromOrders(
  medusa: Sql,
  ordersFile: string,
  ownMallChannel: string,
): Promise<{ displayId: number; medusaOrderId: string }[]> {
  const { displayIds, errors } = parseOwnMallDisplayIds(await readRows(ordersFile), ownMallChannel);
  if (errors.length) {
    for (const e of errors.slice(0, 30)) console.log(`   ${e}`);
    throw new RefusedError(`미발송 주문 파일 오류 ${errors.length}건 — 추정하지 않는다`);
  }
  console.log(`📄 미발송 주문 파일: 자사몰(판매처 "${ownMallChannel}") 주문 ${displayIds.length}건`);
  if (displayIds.length === 0) {
    console.log('   ⚠️ 자사몰 주문이 0건이다 — 판매처 이름(--own-mall-channel)이 맞는지 확인한다.');
  }
  const resolved = await resolveMedusaOrderIds(medusa, displayIds);
  const out: { displayId: number; medusaOrderId: string }[] = [];
  const unresolved: number[] = [];
  for (const id of displayIds) {
    const medusaOrderId = resolved.get(id);
    if (medusaOrderId === undefined) unresolved.push(id);
    else out.push({ displayId: id, medusaOrderId });
  }
  if (unresolved.length) {
    throw new RefusedError(
      `Medusa 주문을 못 찾은 display_id ${unresolved.length}건: ${unresolved.slice(0, 30).join(', ')} — init 을 반영하지 않는다`,
    );
  }
  return out;
}

const USAGE =
  '사용: evening-reconcile <pair|apply|close> <재고 CSV> [--apply] [--accept-landed=…] [--accept-not-landed=…]\n' +
  '      evening-reconcile init <재고 CSV> --cutover-at=<T> --sellmate-orders=<파일> --own-mall-channel=<판매처> [--apply]\n' +
  '      evening-reconcile status';

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    throw new RefusedError(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new RefusedError('DATABASE_URL 이 필요하다 (테넌트 1 core 논리 DB). 라이브는 run.sh 로 돌린다');
  const outDir = path.resolve(process.env.OUT_DIR || 'apps/core/tmp');
  const core = postgres(url, { max: 2, onnotice: () => undefined });
  let medusa: Sql | null = null;
  try {
    const d: Deps = { core, medusa: null, outDir, now: new Date(), log: (line) => console.log(line) };
    const stockFile = args.stockFile;
    let outcome: RunOutcome;
    if (args.sub === 'status') {
      outcome = await runStatus(d);
    } else {
      if (stockFile === null) throw new RefusedError(`${args.sub} 에는 재고 CSV 가 필요하다`);
      if (args.sub === 'init') {
        const medusaUrl = process.env.MEDUSA_DATABASE_URL;
        if (!medusaUrl) {
          throw new RefusedError(
            'init 에는 MEDUSA_DATABASE_URL 이 필요하다 — WITH_MEDUSA=1 bash scripts/sellmate/run.sh …',
          );
        }
        if (args.cutoverAt === null || args.ordersFile === null || args.ownMallChannel === null) {
          throw new RefusedError('init 인자가 모자란다');
        }
        const stock = await readStockCsv(stockFile);
        medusa = postgres(medusaUrl, { max: 2, onnotice: () => undefined });
        const handedOver = await handedOverFromOrders(medusa, args.ordersFile, args.ownMallChannel);
        outcome = await runInit({ ...d, medusa }, stock, handedOver, args.cutoverAt, args.apply);
      } else {
        const stock = await readStockCsv(stockFile);
        console.log(
          `📄 ${path.basename(stockFile)} · 스냅샷 ${stock.snapshotAt.toISOString()} · 품목 ${stock.rows.length}`,
        );
        if (args.sub === 'pair') outcome = await runPair(d, stock, args.apply);
        else if (args.sub === 'apply') outcome = await runApply(d, stock, args.apply);
        else
          outcome = await runClose(
            d,
            stock,
            { landed: args.acceptLanded, notLanded: args.acceptNotLanded },
            args.apply,
          );
      }
    }

    if (outcome.touchedSkuIds.length) {
      // 커밋 뒤에만 부른다. 실패하면 손으로: bash scripts/sellmate/run.sh live recalc-sellable .
      // recalc-sellable 은 core 앱 서비스를 끌어오므로, 인자 파싱 스펙이 그걸 싣지 않게 여기서만 불러온다.
      const { recalcSellableForSkus } = await import('./recalc-sellable');
      try {
        const n = await recalcSellableForSkus(url, outcome.touchedSkuIds, !args.apply);
        console.log(`\n📊 sellable 재계산 대상 variant ${n}개${args.apply ? '' : ' (DRY-RUN — 재계산 안 함)'}`);
      } catch (err) {
        if (!args.apply) throw err;
        // recalc-sellable 의 main 은 최근 SINCE_HOURS(기본 24)시간 안의 셀메이트 출처(sellmate-reconcile 포함) 원장 이벤트가
        // 건드린 SKU 를 전부 다시 계산한다 — 이번에 바뀐 SKU 를 덮는다.
        console.error(`\n❌ sellable 재계산 실패: ${err instanceof Error ? err.message : String(err)}`);
        console.error(
          `   ⚠️ 원장 변경(${outcome.touchedSkuIds.length}개 SKU)과 회차는 이미 커밋됐다 — apply 를 다시 돌리지 말 것.`,
        );
        console.error('   sellable 만 다시 계산한다(24시간 안에, 늦으면 SINCE_HOURS 를 늘린다. dev 면 live 대신 dev):');
        console.error('   bash scripts/sellmate/run.sh live recalc-sellable .');
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = outcome.exitCode;
  } finally {
    await core.end();
    if (medusa) await medusa.end();
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
