/**
 * 셀메이트 저녁 맞추기 명령(#1304) 통합 스펙. 각 run* 은 스스로 트랜잭션을 열고 커밋하므로, 이 스펙은 롤백으로 감싸지
 * 않고 매 케이스 앞뒤에서 맞추기 테이블 5개 전부와 sellmate-reconcile·sellmate-handover 원장 이벤트 전부를 **커밋으로 지운다**.
 * 그래서 DB 이름에 `scratch` 가 들어간 DATABASE_URL 에서만 돈다(아니면 skip, 접속 뒤 current_database() 로 다시 확인해 던진다).
 * 로컬 `core` 를 가리키는 npm run test:core:integration:local 에서는 skip 된다 — 아래처럼 스크래치 DB 를 직접 준다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_reconcile_scratch \
 *         npx jest scripts/sellmate/evening-reconcile.integration --runInBand
 *       (처음이면 createdb core_reconcile_scratch 후 같은 URL 로 npx drizzle-kit migrate --config apps/core/drizzle.config.ts)
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import * as postgres from 'postgres';
import type { Sql } from 'postgres';
import { parseCutoff } from './clear-reservations';
import { BUCHEON_WAREHOUSE_ID, applyStockDelta } from './stock-delta';
import { parseReconcileStock } from './reconcile/stock-csv';
import {
  ensureBucheon,
  seedLedger,
  seedSalesOrder,
  seedSku,
  seedZone,
  uid,
} from './reconcile/__support__/reconcile-seed';
import { Deps, RunOutcome, StockInput, runApply, runClose, runInit, runPair, runStatus } from './evening-reconcile';

const DATABASE_URL = process.env.DATABASE_URL;
const isScratchName = (name: string): boolean => name.includes('scratch');
function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}
const describeIfDb = DATABASE_URL && isScratchName(databaseName(DATABASE_URL)) ? describe : describe.skip;

const HEADER = ['옵션정보일련번호', '상품일련번호', '상품명', '바코드번호', '현재재고', '미발송주문수'];
/** productSerial 은 기본 TEST-P. excluded.ts 의 제외 상품일련번호를 주면 그 행은 제외된다 */
type Row = { serial: string; barcode: string; current: number; unshipped: number; productSerial?: string };

/** 파일 이름 시각(KST `YYYYMMDD_HHMMSS`)으로 메모리 입력을 만든다. sha 는 내용+이름에서 */
function stock(at: string, rows: readonly Row[]): StockInput {
  const file = `stk_stockList_${at}.csv`;
  const table = [
    HEADER,
    ...rows.map((r) => [
      r.serial,
      r.productSerial ?? 'TEST-P',
      'TEST-ITEM',
      r.barcode,
      String(r.current),
      String(r.unshipped),
    ]),
  ];
  const sha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(table) + file)
    .digest('hex');
  return { ...parseReconcileStock(table, file), sha256, snapshotAt: parseCutoff(file) };
}

const T = new Date('2026-11-17T00:00:00Z');

describeIfDb('evening-reconcile (DB integration)', () => {
  jest.setTimeout(120_000);
  let sql: Sql;
  let outDir: string;
  let lines: string[];
  let d: Deps;
  // 케이스마다 새로 만드는 품목 둘(부천 실 로케이션에 A=10, B=5)
  let A: { serial: string; sku: string; barcode: string };
  let B: { serial: string; sku: string; barcode: string };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 2, onnotice: () => undefined });
    const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
    if (!isScratchName(db)) {
      await sql.end({ timeout: 5 });
      throw new Error(`스크래치 DB 가 아니다(${db}) — 이 스펙은 맞추기 테이블을 통째로 지운다`);
    }
  });
  afterAll(async () => {
    // 커밋한 맞추기 행을 남기면 같은 DB 의 다른 스펙(reconcile-store 의 init 시드 등)이 unique 에 걸린다
    await clearReconcile();
    await sql.end({ timeout: 5 });
  });

  async function clearReconcile(): Promise<void> {
    await sql`DELETE FROM sellmate_handed_over_orders`;
    await sql`DELETE FROM sellmate_reconcile_states`;
    await sql`DELETE FROM sellmate_reconcile_runs`;
    await sql`DELETE FROM sellmate_item_pairs`;
    await sql`DELETE FROM stock_events WHERE reason IN ('sellmate-reconcile', 'sellmate-handover')`;
  }

  beforeEach(async () => {
    await clearReconcile();
    await ensureBucheon(sql);
    const zone = await seedZone(sql, BUCHEON_WAREHOUSE_ID);
    const mk = async (qty: number, barcodeTail: string) => {
      const serial = 'TEST-' + uid();
      const sku = await seedSku(sql, serial);
      await seedLedger(sql, sku, BUCHEON_WAREHOUSE_ID, zone, qty);
      return { serial, sku, barcode: '88000000' + barcodeTail };
    };
    A = await mk(10, '00001');
    B = await mk(5, '00002');
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evening-reconcile-'));
    lines = [];
    d = { core: sql, medusa: null, outDir, now: new Date(), log: (l) => lines.push(l) };
  });

  const row = (item: typeof A, current: number, unshipped: number): Row => ({
    serial: item.serial,
    barcode: item.barcode,
    current,
    unshipped,
  });

  async function onHand(sku: string): Promise<number> {
    const [r] = await sql<{ q: number }[]>`
      SELECT COALESCE(SUM(qty), 0)::int AS q FROM stock_ledgers
      WHERE sku_id = ${sku} AND warehouse_id = ${BUCHEON_WAREHOUSE_ID} AND stock_state = 'ON_HAND'`;
    return r.q;
  }
  async function reconcileEvents(): Promise<{ sku_id: string; transition_type: string; quantity: number }[]> {
    return sql<{ sku_id: string; transition_type: string; quantity: number }[]>`
      SELECT sku_id, transition_type, quantity FROM stock_events WHERE reason = 'sellmate-reconcile' ORDER BY sku_id`;
  }
  async function tableCounts(): Promise<Record<string, number>> {
    const [r] = await sql<Record<string, number>[]>`
      SELECT (SELECT count(*)::int FROM sellmate_reconcile_runs) AS runs,
             (SELECT count(*)::int FROM sellmate_reconcile_items) AS items,
             (SELECT count(*)::int FROM sellmate_reconcile_states) AS states,
             (SELECT count(*)::int FROM sellmate_handed_over_orders) AS handed,
             (SELECT count(*)::int FROM sellmate_item_pairs) AS pairs,
             (SELECT count(*)::int FROM stock_events) AS events`;
    return r;
  }
  async function state(sku: string): Promise<{ baseline: number; carry: number; frozen: boolean } | undefined> {
    const [r] = await sql<{ baseline: number; carry: number; frozen: boolean }[]>`
      SELECT baseline, carry, frozen FROM sellmate_reconcile_states WHERE sku_id = ${sku}`;
    return r;
  }
  async function runs(): Promise<{ kind: string; status: string; cutover_at: Date | null }[]> {
    return sql<{ kind: string; status: string; cutover_at: Date | null }[]>`
      SELECT kind, status, cutover_at FROM sellmate_reconcile_runs ORDER BY created_at`;
  }
  const uploadLines = (file: string): string[] =>
    iconv.decode(fs.readFileSync(file), 'euc-kr').split('\r\n').filter(Boolean);

  /** init: A S=5(현재 5, 미발송 0), B S=3(현재 4, 미발송 1). 넘긴 주문 없음 */
  const INIT_STOCK = () => stock('20261117_090000', [row(A, 5, 0), row(B, 4, 1)]);
  async function init(): Promise<void> {
    expect((await runInit(d, INIT_STOCK(), [], T, true)).exitCode).toBe(0);
    lines.length = 0; // 이어지는 명령의 출력만 보게
  }
  /** 첫 apply: A 에 마켓 주문 2(미발송 0→2), B 는 그대로 */
  const APPLY_STOCK = () => stock('20261117_180000', [row(A, 5, 2), row(B, 4, 1)]);
  async function initAndApply(): Promise<RunOutcome> {
    await init();
    const out = await runApply(d, APPLY_STOCK(), true);
    expect(out.exitCode).toBe(0);
    return out;
  }

  describe('pair', () => {
    it('dry-run 은 짝 표를 쓰지 않고, --apply 는 짝 표를 통째로 쓴다', async () => {
      const input = stock('20261117_090000', [
        row(A, 1, 0),
        { serial: 'TEST-NOPE-' + uid(), barcode: '8800000000009', current: 1, unshipped: 0 },
      ]);
      const dry = await runPair(d, input, false);
      expect(dry.exitCode).toBe(1); // 짝 못 지은 품목이 있다
      expect((await tableCounts()).pairs).toBe(0);
      await runPair(d, input, true);
      const pairs =
        await sql`SELECT option_serial, sku_id, unpaired_reason FROM sellmate_item_pairs ORDER BY option_serial`;
      expect(pairs.find((p) => p.option_serial === A.serial)?.sku_id).toBe(A.sku);
      expect(pairs.filter((p) => p.unpaired_reason === 'no_core_sku')).toHaveLength(1);
    });
  });

  describe('init', () => {
    it('1. dry-run 은 테이블·원장 행 수를 바꾸지 않는다', async () => {
      const before = await tableCounts();
      const out = await runInit(d, INIT_STOCK(), [], T, false);
      expect(out.exitCode).toBe(0);
      expect(await tableCounts()).toEqual(before);
    });

    it('2. --apply 는 기준값=S·이월=max(0,−S), 넘긴 주문, 닫힌 init 회차를 쓴다(원장은 안 쓴다)', async () => {
      const medusaOrderId = 'TEST-M-' + uid();
      const so = await seedSalesOrder(sql, medusaOrderId);
      const input = stock('20261117_090000', [row(A, 3, 5), row(B, 4, 1)]);
      const out = await runInit(d, input, [{ displayId: 101, medusaOrderId }], T, true);

      expect(out.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: -2, carry: 2, frozen: false });
      expect(await state(B.sku)).toEqual({ baseline: 3, carry: 0, frozen: false });
      const handed = await sql`SELECT sales_order_id, display_id FROM sellmate_handed_over_orders`;
      expect(handed.map((h) => [h.sales_order_id, h.display_id])).toEqual([[so, 101]]);
      expect(await runs()).toEqual([{ kind: 'init', status: 'closed', cutover_at: T }]);
      expect(await reconcileEvents()).toEqual([]);
    });

    it('3. 두 번째 init 은 1 로 끝나고 쓰지 않는다', async () => {
      await init();
      const before = await tableCounts();
      const out = await runInit(d, stock('20261117_100000', [row(A, 5, 0), row(B, 4, 1)]), [], T, true);
      expect(out.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
    });

    it('core 판매주문을 못 찾은 넘긴 주문이 있으면 1 로 끝나고 쓰지 않는다', async () => {
      const before = await tableCounts();
      const missing = 'TEST-M-NONE-' + uid();
      const out = await runInit(d, INIT_STOCK(), [{ displayId: 7, medusaOrderId: missing }], T, true);
      expect(out.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
      expect(lines.join('\n')).toContain(missing);
    });
  });

  describe('apply', () => {
    it('4. 짝 못 지은 품목이 있으면 1 로 끝나고 원장·회차를 쓰지 않는다', async () => {
      await init();
      const before = await tableCounts();
      const input = stock('20261117_180000', [
        row(A, 5, 2),
        row(B, 4, 1),
        { serial: 'TEST-NOPE-' + uid(), barcode: '8800000000009', current: 1, unshipped: 0 },
      ]);
      const out = await runApply(d, input, true);
      expect(out.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
      expect(await onHand(A.sku)).toBe(10);
    });

    it('5. 마켓 주문 2 → ADJUST_DOWN 2(sellmate-reconcile), 회차 awaiting_close, 업로드 파일', async () => {
      const out = await initAndApply();

      expect(await reconcileEvents()).toEqual([{ sku_id: A.sku, transition_type: 'ADJUST_DOWN', quantity: 2 }]);
      expect(await onHand(A.sku)).toBe(8);
      expect(await onHand(B.sku)).toBe(5);
      expect(out.touchedSkuIds).toEqual([A.sku]);
      expect((await runs()).map((r) => [r.kind, r.status])).toEqual([
        ['init', 'closed'],
        ['apply', 'awaiting_close'],
      ]);
      // 상태는 이월만 쓰고 기준값은 닫기 전까지 그대로
      expect(await state(A.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });
      // 올릴 현재재고 = U + 미발송 — A: (8)+2, B: 5+1
      expect(out.uploadFile).toBe(path.join(outDir, path.basename(out.uploadFile as string)));
      expect(uploadLines(out.uploadFile as string)).toEqual([
        '바코드번호,재고수량',
        `${A.barcode},10`,
        `${B.barcode},6`,
      ]);
      expect(lines[0]).toBe('UP 0품목 · DOWN 1품목 · 이월 0품목 · 짝 못 지음 0품목 · 새 품목 0');
    });

    it('dry-run 은 원장·회차·파일을 쓰지 않는다', async () => {
      await init();
      const before = await tableCounts();
      const out = await runApply(d, APPLY_STOCK(), false);
      expect(out.exitCode).toBe(0);
      expect(out.uploadFile).toBeNull();
      expect(await tableCounts()).toEqual(before);
      expect(fs.readdirSync(outDir)).toEqual([]);
      expect(lines[0]).toBe('UP 0품목 · DOWN 1품목 · 이월 0품목 · 짝 못 지음 0품목 · 새 품목 0');
    });

    it('6. 같은 sha 로 다시 돌리면 0 으로 끝나고 원장이 바뀌지 않는다(멱등)', async () => {
      const first = await initAndApply();
      const before = await tableCounts();
      const again = await runApply(d, APPLY_STOCK(), true);
      expect(again.exitCode).toBe(0);
      expect(again.uploadFile).toBe(first.uploadFile);
      expect(again.touchedSkuIds).toEqual([]);
      expect(await tableCounts()).toEqual(before);
    });

    it('7. 열린 회차가 있으면 다른 sha 의 apply 는 1', async () => {
      await initAndApply();
      const before = await tableCounts();
      const out = await runApply(d, stock('20261117_190000', [row(A, 5, 3), row(B, 4, 1)]), true);
      expect(out.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
    });

    it('11. 직전 닫기 입력보다 이르거나 같은 스냅샷의 apply 는 1', async () => {
      await initAndApply();
      expect(
        (
          await runClose(
            d,
            stock('20261117_183000', [row(A, 10, 2), row(B, 6, 1)]),
            { landed: [], notLanded: [] },
            true,
          )
        ).exitCode,
      ).toBe(0);
      const before = await tableCounts();
      const earlier = await runApply(d, stock('20261117_182000', [row(A, 10, 3), row(B, 6, 1)]), true);
      expect(earlier.exitCode).toBe(1);
      const same = await runApply(d, stock('20261117_183000', [row(A, 10, 3), row(B, 6, 1)]), true);
      expect(same.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
      // 더 늦은 입력은 통과: 닫기 뒤 새 주문 1 → −1
      const later = await runApply(d, stock('20261118_180000', [row(A, 10, 3), row(B, 6, 1)]), true);
      expect(later.exitCode).toBe(0);
      expect(await onHand(A.sku)).toBe(7);
    });

    it('init 입력보다 이른 스냅샷의 첫 apply 는 1', async () => {
      await init();
      const out = await runApply(d, stock('20261117_080000', [row(A, 5, 2), row(B, 4, 1)]), true);
      expect(out.exitCode).toBe(1);
    });

    it('init 이 없으면 apply 는 1', async () => {
      const out = await runApply(d, APPLY_STOCK(), true);
      expect(out.exitCode).toBe(1);
      expect((await tableCounts()).runs).toBe(0);
    });

    it('12. sellmate-handover 이벤트가 있으면 apply·init 은 1', async () => {
      await applyStockDelta(sql, { skuId: B.sku, delta: 1, source: 'sellmate-handover' });
      expect((await runInit(d, INIT_STOCK(), [], T, true)).exitCode).toBe(1);
      expect((await tableCounts()).runs).toBe(0);

      await sql`DELETE FROM stock_events WHERE reason = 'sellmate-handover'`;
      await init();
      await applyStockDelta(sql, { skuId: B.sku, delta: 1, source: 'sellmate-handover' });
      const before = await tableCounts();
      expect((await runApply(d, APPLY_STOCK(), true)).exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
    });

    it('13. init 뒤 새로 짝지어진 품목은 기준값 S·이월 미발송으로 시작해 같은 회에 미발송만큼 core 에서 뺀다', async () => {
      expect((await runInit(d, stock('20261117_090000', [row(A, 5, 0)]), [], T, true)).exitCode).toBe(0);
      lines.length = 0;
      // B: 현재 2, 미발송 3 → S = −1. core 5 는 그 미발송 3 과 상계된 적이 없다
      const out = await runApply(d, stock('20261117_180000', [row(A, 5, 0), row(B, 2, 3)]), true);

      expect(out.exitCode).toBe(0);
      expect(await reconcileEvents()).toEqual([{ sku_id: B.sku, transition_type: 'ADJUST_DOWN', quantity: 3 }]);
      expect(await onHand(B.sku)).toBe(2);
      expect(out.touchedSkuIds).toEqual([B.sku]);
      expect(await state(B.sku)).toEqual({ baseline: -1, carry: 0, frozen: false });
      expect(lines[0]).toBe('UP 0품목 · DOWN 1품목 · 이월 0품목 · 짝 못 지음 0품목 · 새 품목 1');
      expect(lines.join('\n')).toContain('[새 품목]');
      // 업로드는 planApply 값: U = 5 − 3 = 2, 현재 = 2 + 미발송 3
      expect(uploadLines(out.uploadFile as string)).toContain(`${B.barcode},5`);
    });

    it('새 품목의 미발송이 여유보다 많으면 여유만큼 빼고 나머지는 이월로 둔다', async () => {
      expect((await runInit(d, stock('20261117_090000', [row(A, 5, 0)]), [], T, true)).exitCode).toBe(0);
      const out = await runApply(d, stock('20261117_180000', [row(A, 5, 0), row(B, 0, 7)]), true);
      expect(out.exitCode).toBe(0);
      expect(await onHand(B.sku)).toBe(0);
      expect(await state(B.sku)).toEqual({ baseline: -7, carry: 2, frozen: false });
      expect(uploadLines(out.uploadFile as string)).toContain(`${B.barcode},7`);
    });

    it('제외 목록에 새로 들어간 품목은 상태를 얼리고 올리지 않으며, 빠지면 새 품목으로 다시 시작한다', async () => {
      await init();
      // excluded.ts 의 제외 상품일련번호(공개 코드에 이미 있는 값)
      const excludedB = { ...row(B, 4, 1), productSerial: '13248' };
      const out = await runApply(d, stock('20261117_180000', [row(A, 5, 0), excludedB]), true);
      expect(out.exitCode).toBe(0);
      expect(await state(B.sku)).toEqual({ baseline: 3, carry: 0, frozen: true });
      expect(uploadLines(out.uploadFile as string)).toEqual(['바코드번호,재고수량', `${A.barcode},10`]);
      expect(
        (await runClose(d, stock('20261117_183000', [row(A, 10, 0), excludedB]), { landed: [], notLanded: [] }, true))
          .exitCode,
      ).toBe(0);

      const back = await runApply(d, stock('20261118_180000', [row(A, 10, 0), row(B, 1, 3)]), true);
      expect(back.exitCode).toBe(0);
      // 다시 시작: 기준값 S = −2, 이월 = 미발송 3 → 같은 회에 3 을 뺀다
      expect(await state(B.sku)).toEqual({ baseline: -2, carry: 0, frozen: false });
      expect(await onHand(B.sku)).toBe(2);
    });

    it('14. 상태가 있는 품목이 CSV 에서 사라지면 1', async () => {
      await init();
      const before = await tableCounts();
      const out = await runApply(d, stock('20261117_180000', [row(A, 5, 2)]), true);
      expect(out.exitCode).toBe(1);
      expect(await tableCounts()).toEqual(before);
    });

    it('취소·반품 +1 은 ADJUST_UP 을 SKU 의 유일한 실 로케이션에 넣는다', async () => {
      await init();
      const out = await runApply(d, stock('20261117_180000', [row(A, 6, 0), row(B, 4, 1)]), true);
      expect(out.exitCode).toBe(0);
      expect(await reconcileEvents()).toEqual([{ sku_id: A.sku, transition_type: 'ADJUST_UP', quantity: 1 }]);
      const locs = await sql`SELECT l.is_system FROM stock_ledgers sl JOIN locations l ON l.id = sl.location_id
        WHERE sl.sku_id = ${A.sku} AND sl.qty > 0`;
      expect(locs.map((r) => r.is_system)).toEqual([false]);
    });
  });

  describe('close', () => {
    const noAccept = { landed: [] as string[], notLanded: [] as string[] };

    it('8. 정상 닫기 → 기준값 = 올린 현재재고 − 기준 미발송, 회차 closed', async () => {
      await initAndApply();
      // A: 업로드 먹음(현재 10) + 새 마켓 주문 1(미발송 2→3), B: 그대로
      const out = await runClose(d, stock('20261117_183000', [row(A, 10, 3), row(B, 6, 1)]), noAccept, true);
      expect(out.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: 8, carry: 0, frozen: false });
      expect(await state(B.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'closed']);
      const verdicts = await sql`SELECT close_verdict FROM sellmate_reconcile_items i
        JOIN sellmate_reconcile_runs r ON r.id = i.run_id WHERE r.kind = 'apply' ORDER BY option_serial`;
      expect(verdicts.map((v) => v.close_verdict)).toEqual(['ok_new_orders', 'ok_new_orders']);
    });

    it('열린 회차가 없으면 1', async () => {
      await init();
      const out = await runClose(d, stock('20261117_183000', [row(A, 5, 0), row(B, 4, 1)]), noAccept, true);
      expect(out.exitCode).toBe(1);
    });

    it('apply 입력보다 이르거나 같은 스냅샷의 닫기는 1', async () => {
      await initAndApply();
      const same = await runClose(d, stock('20261117_180000', [row(A, 10, 2), row(B, 6, 1)]), noAccept, true);
      expect(same.exitCode).toBe(1);
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'awaiting_close']);
    });

    it('9. shipped_before_upload → 1, 고친 업로드 파일, 회차 품목 기준 갱신, 회차는 열린 채', async () => {
      await initAndApply();
      // A: 업로드 전에 1 출고(미발송 2→1)했는데 업로드가 10 으로 덮었다
      const closeInput = stock('20261117_183000', [row(A, 10, 1), row(B, 6, 1)]);

      const dry = await runClose(d, closeInput, noAccept, false);
      expect(dry.exitCode).toBe(1);
      expect(dry.uploadFile).toBeNull();
      expect(fs.readdirSync(outDir).filter((f) => f.endsWith('-fix.csv'))).toEqual([]);

      const out = await runClose(d, closeInput, noAccept, true);
      expect(out.exitCode).toBe(1);
      expect(out.uploadFile).toMatch(/-fix\.csv$/);
      expect(uploadLines(out.uploadFile as string)).toEqual(['바코드번호,재고수량', `${A.barcode},9`]);
      const [item] = await sql`
        SELECT i.uploaded_current, i.ref_unshipped, i.close_verdict FROM sellmate_reconcile_items i
        JOIN sellmate_reconcile_runs r ON r.id = i.run_id
        WHERE r.kind = 'apply' AND i.option_serial = ${A.serial}`;
      expect(item).toEqual({ uploaded_current: 9, ref_unshipped: 1, close_verdict: 'shipped_before_upload' });
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'awaiting_close']);
      expect(await state(A.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });

      // 사람이 고친 파일을 올리고 다시 받아 닫는다
      const reclose = await runClose(d, stock('20261117_190000', [row(A, 9, 1), row(B, 6, 1)]), noAccept, true);
      expect(reclose.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: 8, carry: 0, frozen: false });
    });

    it('C1. 고친 파일을 기다리는 품목은 같은 CSV·고친 파일을 안 올린 CSV 로 닫히지 않고, 고친 파일이 먹으면 B = U 로 닫힌다', async () => {
      await initAndApply();
      const notUploaded = (at: string) => stock(at, [row(A, 10, 1), row(B, 6, 1)]);
      expect((await runClose(d, notUploaded('20261117_183000'), noAccept, true)).exitCode).toBe(1);
      const before = await tableCounts();
      const itemA = async () =>
        (
          await sql`
            SELECT i.uploaded_current, i.ref_unshipped, i.close_verdict FROM sellmate_reconcile_items i
            JOIN sellmate_reconcile_runs r ON r.id = i.run_id
            WHERE r.kind = 'apply' AND i.option_serial = ${A.serial}`
        )[0];

      // 같은 CSV 를 다시 — 닫지 못한 시도의 입력보다 늦지 않아 거절
      expect((await runClose(d, notUploaded('20261117_183000'), noAccept, true)).exitCode).toBe(1);
      expect(await state(A.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });

      // 새로 받았지만 고친 파일을 안 올렸다(현재 10 그대로) — 반품처럼 보여도 ✗
      expect((await runClose(d, notUploaded('20261117_184000'), noAccept, true)).exitCode).toBe(1);
      expect(await itemA()).toEqual({ uploaded_current: 9, ref_unshipped: 1, close_verdict: 'mismatch' });
      // 세 번째도 마찬가지(저장된 판정이 mismatch 로 바뀌어도 여전히 기다린다)
      expect((await runClose(d, notUploaded('20261117_185000'), noAccept, true)).exitCode).toBe(1);
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'awaiting_close']);
      expect(await state(A.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });
      expect((await tableCounts()).events).toBe(before.events);

      // 고친 파일이 먹었다(현재 9, 미발송 1) → 닫히고 기준값 = U = 8
      const done = await runClose(d, stock('20261117_190000', [row(A, 9, 1), row(B, 6, 1)]), noAccept, true);
      expect(done.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: 8, carry: 0, frozen: false });
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'closed']);
    });

    it('10. --accept-not-landed 로 닫으면 그 품목 기준값 = apply 의 S', async () => {
      await initAndApply();
      // A 업로드가 안 먹었다(현재 5 그대로) → mismatch
      const closeInput = stock('20261117_183000', [row(A, 5, 2), row(B, 6, 1)]);
      expect((await runClose(d, closeInput, noAccept, true)).exitCode).toBe(1);
      // 닫지 못한 시도의 입력은 다시 쓸 수 없다 — 지목하더라도 새로 받은 파일로
      expect((await runClose(d, closeInput, { landed: [], notLanded: [A.serial] }, true)).exitCode).toBe(1);

      const later = stock('20261117_184000', [row(A, 5, 2), row(B, 6, 1)]);
      const out = await runClose(d, later, { landed: [], notLanded: [A.serial] }, true);
      expect(out.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: 3, carry: 0, frozen: false });
      expect(await state(B.sku)).toEqual({ baseline: 5, carry: 0, frozen: false });
      const [run] = await sql`SELECT accepted FROM sellmate_reconcile_runs WHERE kind = 'apply'`;
      expect(run.accepted).toEqual({ landed: [], notLanded: [A.serial] });
    });

    it('--accept-landed 로 닫으면 그 품목 기준값 = U', async () => {
      await initAndApply();
      const closeInput = stock('20261117_183000', [row(A, 5, 2), row(B, 6, 1)]);
      const out = await runClose(d, closeInput, { landed: [A.serial], notLanded: [] }, true);
      expect(out.exitCode).toBe(0);
      expect(await state(A.sku)).toEqual({ baseline: 8, carry: 0, frozen: false });
    });

    it('회차에 없는 품목을 지목하면 1', async () => {
      await initAndApply();
      const out = await runClose(
        d,
        stock('20261117_183000', [row(A, 10, 2), row(B, 6, 1)]),
        { landed: ['TEST-NOPE'], notLanded: [] },
        true,
      );
      expect(out.exitCode).toBe(1);
      expect((await runs()).map((r) => r.status)).toEqual(['closed', 'awaiting_close']);
    });
  });

  it('status 는 쓰지 않고 열린 회차를 보여 준다', async () => {
    await initAndApply();
    const before = await tableCounts();
    const out = await runStatus(d);
    expect(out.exitCode).toBe(0);
    expect(await tableCounts()).toEqual(before);
    expect(lines.join('\n')).toContain('awaiting_close');
  });
});
