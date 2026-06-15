/**
 * 셀메이트 재고량 → core 재고 동기화 스크립트 (언제든 반복 실행 가능)
 *
 * 입력: 셀메이트 "재고관리 > 재고 현황 목록 > 엑셀 다운로드" 파일.
 *       import-products.ts 와 같은 파일을 그대로 쓰면 된다 (옵션정보일련번호 + 현재재고).
 *
 * 동작: 각 품목의 현재고(core, 부천 물류창고 ON_HAND 합계)를 셀메이트의 "현재재고" 값에
 *       맞추도록 차이(delta)만큼 ADJUST_UP / ADJUST_DOWN 이벤트를 기록한다.
 *       - delta = 0 → 아무것도 안 함 → 같은 파일 다시 돌려도 안전(idempotent)
 *       - 이벤트소싱: stock_events(불변 로그) insert + stock_ledgers(프로젝션) 갱신을
 *         InventoryCommandService.adjustUp/Down 과 동일하게 raw SQL 로 재현
 *
 * 무결성 보장:
 *   - 전체 동기화를 단일 트랜잭션으로 처리 → 중간 실패 시 전부 롤백(부분 반영 없음).
 *   - 시작 시 advisory lock 으로 다른 sync 실행을 직렬화 → 동시 실행이 같은 delta 를
 *     중복 적용하는 사고 방지.
 *   - 현재고는 트랜잭션 안에서 FOR UPDATE 로 다시 읽어 계산 → 운영 재고변경과의 경합 방지.
 *   - 감소는 잠근 행에서 조건부 차감(qty >= take)하고 영향 행 수를 검증 → 음수/유실 방지.
 *
 * ⚠️ sellable(스토어프론트 노출 수량) 재계산은 이 스크립트가 하지 않는다.
 *    재고매칭(SKU↔변형) 전이면 어차피 no-op 이라 괜찮지만, 매칭이 붙은 SKU 의 재고를
 *    바꿨다면 스토어프론트가 stale 해진다. 그 경우 종료 시 경고하고 non-zero 로 끝낸다
 *    (SKIP_SELLABLE_CHECK=1 로 무시 가능). 매칭 후에는 SKU별 recalculateAndPublishForSku
 *    재계산을 별도로 돌려야 한다.
 *
 * ── 실행 ─────────────────────────────────────────────────────────────────────
 *   # 1) dry-run: 어떤 품목을 얼마나 +/- 할지 미리보기 (DB 안 건드림)
 *   DRY_RUN=1 npx tsx scripts/sellmate/sync-stock.ts ~/Downloads/stk_stockList_*.xls
 *
 *   # 2) 실제 반영 (import-products 먼저 돌려 SKU 가 존재해야 함)
 *   DATABASE_URL=postgres://... npx tsx scripts/sellmate/sync-stock.ts apps/core/tmp/
 *
 * ── 환경변수 ─────────────────────────────────────────────────────────────────
 *   DATABASE_URL        core 논리 DB 접속 문자열 (실제 반영 시 필수)
 *   DRY_RUN=1           조정 계획만 출력
 *   WAREHOUSE_ID        재고를 잡을 창고 (기본: 부천 물류창고)
 *   LOCATION_ID         증가분을 넣을 로케이션 (기본: 부천 입고기본존)
 *   ALLOW_MISSING=1     core 에 없는 품목이 있어도 나머지만 반영(기본: 중단)
 *   ALLOW_DUP_FILES=1   여러 파일에 같은 품목이 다른 재고로 있어도 진행(기본: 중단)
 *   SKIP_SELLABLE_CHECK=1  매칭된 SKU stale 경고를 무시하고 0 으로 종료
 *   SELLMATE_ENCODING   HTML-xls 인코딩 (기본 euc-kr)
 *   COL_ITEM_CODE / COL_STOCK   자동감지 실패 시 헤더 이름 직접 지정
 */
import * as path from 'path';
import * as fs from 'fs';
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';

// seeding 의 FIXED_UUIDS 와 동일 (scripts/seeding/constants/uuids.ts)
const BUCHEON_WAREHOUSE_ID = process.env.WAREHOUSE_ID || '019d0001-0001-7000-a000-000000000001';
const BUCHEON_RECEIVING_LOC_ID = process.env.LOCATION_ID || '019d0002-0001-7000-a000-000000000001';

const ALLOW_MISSING = process.env.ALLOW_MISSING === '1' || process.env.ALLOW_MISSING === 'true';
const ALLOW_DUP_FILES = process.env.ALLOW_DUP_FILES === '1' || process.env.ALLOW_DUP_FILES === 'true';
const SKIP_SELLABLE_CHECK = process.env.SKIP_SELLABLE_CHECK === '1' || process.env.SKIP_SELLABLE_CHECK === 'true';

const COLUMN_CANDIDATES = {
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  stock: ['현재재고', '가용재고', '재고', '재고수량'],
} as const;
type LogicalField = keyof typeof COLUMN_CANDIDATES;

const OVERRIDES: Partial<Record<LogicalField, string | undefined>> = {
  itemCode: process.env.COL_ITEM_CODE,
  stock: process.env.COL_STOCK,
};

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/** 비음수 정수만 허용. 빈값/소수/문자/음수는 null 을 돌려 호출부가 오류로 처리하게 한다. */
export function parseStock(s: string): number | null {
  const cleaned = (s ?? '').toString().replace(/,/g, '').trim();
  if (!/^\d+$/.test(cleaned)) return null; // 빈값·기호·소수점·음수 전부 거부
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

export type Target = { itemCode: string; target: number };
export type StockParseError = { file: string; rowNumber: number; itemCode: string; raw: string };

export function parseStockRows(
  rows: string[][],
  file: string,
  quiet = false,
): { targets: Target[]; errors: StockParseError[] } {
  if (rows.length < 2) return { targets: [], errors: [] };
  const header = rows[0];
  const cols = detectColumns(header, COLUMN_CANDIDATES, OVERRIDES);
  if (!quiet) {
    console.log(`\n📄 ${path.basename(file)} — 감지된 열 매핑:`);
    for (const field of Object.keys(COLUMN_CANDIDATES) as LogicalField[]) {
      const idx = cols[field];
      console.log(`   ${field.padEnd(10)} → [${idx}] "${idx >= 0 ? header[idx] : '(없음)'}"`);
    }
  }
  if (cols.itemCode < 0 || cols.stock < 0) {
    throw new Error(
      `[${path.basename(file)}] 필수 열(품목 고유키/현재재고)을 못 찾았습니다.\n   헤더: ${header.join(' | ')}`,
    );
  }
  const targets: Target[] = [];
  const errors: StockParseError[] = [];
  for (let i = 1; i < rows.length; i++) {
    const itemCode = (rows[i][cols.itemCode] ?? '').toString().trim();
    if (!itemCode) continue;
    const raw = (rows[i][cols.stock] ?? '').toString();
    const target = parseStock(raw);
    if (target === null) {
      errors.push({ file: path.basename(file), rowNumber: i, itemCode, raw });
      continue;
    }
    targets.push({ itemCode, target });
  }
  return { targets, errors };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('사용법: npx tsx scripts/sellmate/sync-stock.ts <파일 또는 폴더경로>');
    process.exit(1);
  }
  const stat = fs.statSync(arg);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(arg)
        .filter((f) => ['.csv', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b)) // 파일명(타임스탬프) 오름차순 → 마지막=최신 결정적
        .map((f) => path.join(arg, f))
    : [arg];

  // 1) 파싱 + 엄격 검증. 같은 품목이 여러 파일에 다른 값으로 있으면 모호 → 기본 중단.
  const targetByCode = new Map<string, number>();
  const allErrors: StockParseError[] = [];
  const conflicts: { itemCode: string; values: number[] }[] = [];
  for (const file of files) {
    const rows = await readRows(file);
    const { targets, errors } = parseStockRows(rows, file);
    console.log(`   → ${targets.length}개 품목 재고 읽음${errors.length ? `, 형식오류 ${errors.length}건` : ''}`);
    allErrors.push(...errors);
    for (const t of targets) {
      const prev = targetByCode.get(t.itemCode);
      if (prev !== undefined && prev !== t.target) {
        const c = conflicts.find((x) => x.itemCode === t.itemCode);
        if (c) c.values.push(t.target);
        else conflicts.push({ itemCode: t.itemCode, values: [prev, t.target] });
      }
      targetByCode.set(t.itemCode, t.target); // 마지막(최신 파일) 우선
    }
  }

  if (allErrors.length) {
    console.error(
      `\n❌ 재고 값 형식 오류 ${allErrors.length}건 (비음수 정수만 허용) — 0 으로 추정하지 않고 중단합니다:`,
    );
    for (const e of allErrors.slice(0, 30)) {
      console.error(`   ${e.file} 행${e.rowNumber}: itemCode=${e.itemCode} 재고="${e.raw}"`);
    }
    process.exit(1);
  }
  if (conflicts.length && !ALLOW_DUP_FILES) {
    console.error(
      `\n❌ 여러 파일에 같은 품목이 다른 재고로 존재 ${conflicts.length}건 — 어느 값을 쓸지 모호. 중단합니다:`,
    );
    for (const c of conflicts.slice(0, 30)) {
      console.error(`   itemCode=${c.itemCode} 값들=[${c.values.join(', ')}]`);
    }
    console.error('   → 최신 파일 하나만 두거나, 의도된 경우 ALLOW_DUP_FILES=1 로 재실행(마지막 파일 우선).');
    process.exit(1);
  }
  if (conflicts.length) {
    console.warn(`⚠️  중복 품목 ${conflicts.length}건 — 마지막(최신) 파일 값을 사용합니다.`);
  }
  console.log(`\n📊 대상 품목 ${targetByCode.size}개`);

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL && !DRY_RUN) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB).');
    process.exit(1);
  }
  if (DRY_RUN && !DATABASE_URL) {
    console.log('\nℹ️  DRY_RUN 이지만 DATABASE_URL 이 없어 현재고 비교는 생략하고 파싱 결과만 보여줍니다.');
    let shown = 0;
    for (const [code, target] of targetByCode) {
      if (shown++ >= 10) break;
      console.log(`   code=${code} → target=${target}`);
    }
    return;
  }

  const sql = postgres(DATABASE_URL!, { max: 4 });
  try {
    // ── DRY_RUN: 읽기 전용으로 계획만 산출 ──────────────────────────────────────
    if (DRY_RUN) {
      const { plans, missing } = await computePlans(sql, targetByCode);
      const ups = plans.filter((p) => p.delta > 0);
      const downs = plans.filter((p) => p.delta < 0);
      if (missing.length) {
        console.warn(
          `\n⚠️  core 에 없는 품목 ${missing.length}개: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`,
        );
      }
      console.log(
        `\n📋 조정 계획: 증가 ${ups.length}건, 감소 ${downs.length}건, 변동없음 ${targetByCode.size - missing.length - plans.length}건`,
      );
      console.log('\n🔎 [DRY-RUN] 샘플 12건:');
      for (const p of plans.slice(0, 12)) {
        console.log(`   code=${p.code} | 현재 ${p.current} → 목표 ${p.target} | ${p.delta > 0 ? '+' : ''}${p.delta}`);
      }
      console.log('\n✅ DRY-RUN 종료 — DB 미반영.');
      return;
    }

    // ── 실제 반영: 단일 트랜잭션 + advisory lock + FOR UPDATE 재읽기 ─────────────
    const result = await sql.begin(async (txRaw) => {
      // postgres TransactionSql 는 Omit 기반이라 호출 시그니처가 사라진다(TS 한계) → 호출 가능한 Sql 로 취급.
      const tx = txRaw as unknown as Sql;

      // 다른 sellmate sync 실행을 직렬화(트랜잭션 종료 시 자동 해제).
      await tx`SELECT pg_advisory_xact_lock(hashtext('sellmate-stock-sync'))`;

      // code → sku id
      const codes = [...targetByCode.keys()];
      const skuByCode = new Map<string, string>();
      for (const part of chunk(codes, 1000)) {
        const found = await tx<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE code IN ${tx(part)}`;
        for (const r of found) skuByCode.set(r.code, r.id);
      }
      const missing = codes.filter((c) => !skuByCode.has(c));
      if (missing.length && !ALLOW_MISSING) {
        throw new MissingSkuError(missing);
      }

      const skuIds = [...skuByCode.values()];

      // 현재고를 같은 트랜잭션 안에서 FOR UPDATE 로 잠그고 다시 읽는다.
      const ledgerBySku = new Map<string, { locationId: string; qty: number }[]>();
      for (const part of chunk(skuIds, 1000)) {
        const led = await tx<{ sku_id: string; location_id: string; qty: number }[]>`
          SELECT sku_id, location_id, qty FROM stock_ledgers
          WHERE warehouse_id = ${BUCHEON_WAREHOUSE_ID} AND stock_state = 'ON_HAND' AND sku_id IN ${tx(part)}
          FOR UPDATE
        `;
        for (const r of led) {
          const a = ledgerBySku.get(r.sku_id) ?? [];
          a.push({ locationId: r.location_id, qty: r.qty });
          ledgerBySku.set(r.sku_id, a);
        }
      }

      const now = new Date();
      let applied = 0;
      const changedSkuIds: string[] = [];
      for (const [code, target] of targetByCode) {
        const skuId = skuByCode.get(code);
        if (!skuId) continue; // ALLOW_MISSING 경로
        const locs = ledgerBySku.get(skuId) ?? [];
        const current = locs.reduce((s, l) => s + l.qty, 0);
        const delta = target - current;
        if (delta === 0) continue;

        if (delta > 0) {
          await tx`
            INSERT INTO stock_events (sku_id, to_warehouse_id, to_location_id, to_state, transition_type, quantity, occurred_at, reason)
            VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${BUCHEON_RECEIVING_LOC_ID}, 'ON_HAND', 'ADJUST_UP', ${delta}, ${now}, 'sellmate-sync')
          `;
          await tx`
            INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty, updated_at)
            VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${BUCHEON_RECEIVING_LOC_ID}, 'ON_HAND', ${delta}, ${now})
            ON CONFLICT (sku_id, warehouse_id, location_id, stock_state)
            DO UPDATE SET qty = stock_ledgers.qty + ${delta}, updated_at = ${now}
          `;
        } else {
          // 잠근 위치들에서 많은 곳부터 조건부 차감(qty >= take). 영향 행 검증으로 유실 방지.
          let remaining = -delta;
          const sorted = [...locs].sort((a, b) => b.qty - a.qty);
          for (const loc of sorted) {
            if (remaining <= 0) break;
            const take = Math.min(loc.qty, remaining);
            if (take <= 0) continue;
            await tx`
              INSERT INTO stock_events (sku_id, from_warehouse_id, from_location_id, from_state, transition_type, quantity, occurred_at, reason)
              VALUES (${skuId}, ${BUCHEON_WAREHOUSE_ID}, ${loc.locationId}, 'ON_HAND', 'ADJUST_DOWN', ${take}, ${now}, 'sellmate-sync')
            `;
            const res = await tx`
              UPDATE stock_ledgers SET qty = qty - ${take}, updated_at = ${now}
              WHERE sku_id = ${skuId} AND warehouse_id = ${BUCHEON_WAREHOUSE_ID}
                AND location_id = ${loc.locationId} AND stock_state = 'ON_HAND' AND qty >= ${take}
            `;
            if (res.count !== 1) {
              // FOR UPDATE 로 잠갔으니 정상이면 발생 불가. 발생하면 경합/불일치 → 전체 롤백.
              throw new Error(
                `재고 차감 경합/불일치: code=${code} loc=${loc.locationId} take=${take} (영향행 ${res.count})`,
              );
            }
            remaining -= take;
          }
          if (remaining > 0) {
            throw new Error(`차감할 재고 부족으로 목표 미달: code=${code} (${remaining} 부족) — 전체 롤백`);
          }
        }
        applied++;
        changedSkuIds.push(skuId);
      }

      // 매칭된(스토어프론트 노출) SKU 중 이번에 바뀐 것 탐지 → 커밋 후 경고용.
      const matchedChanged: string[] = [];
      for (const part of chunk(changedSkuIds, 1000)) {
        if (part.length === 0) continue;
        const m = await tx<{ sku_id: string }[]>`
          SELECT DISTINCT sku_id FROM product_variant_sku_links WHERE sku_id IN ${tx(part)}
        `;
        for (const r of m) matchedChanged.push(r.sku_id);
      }

      return { applied, missing, matchedChanged };
    });

    if (result.missing.length && ALLOW_MISSING) {
      console.warn(
        `\n⚠️  core 에 없는 품목 ${result.missing.length}개 건너뜀(ALLOW_MISSING): ${result.missing.slice(0, 10).join(', ')}${result.missing.length > 10 ? ' …' : ''}`,
      );
    }
    console.log(`\n✅ 동기화 완료: ${result.applied}건 조정.`);

    if (result.matchedChanged.length && !SKIP_SELLABLE_CHECK) {
      console.error(
        `\n⚠️  매칭된 SKU ${result.matchedChanged.length}개의 재고가 바뀌었습니다. sellable 프로젝션은 갱신하지 않았으므로 스토어프론트가 stale 합니다.`,
      );
      console.error('   → 각 SKU 에 대해 recalculateAndPublishForSku 재계산을 돌려야 노출 수량이 반영됩니다.');
      console.error('   (매칭 전 단계라 무시해도 되면 SKIP_SELLABLE_CHECK=1 로 재실행)');
      process.exit(2);
    }
  } finally {
    await sql.end();
  }
}

class MissingSkuError extends Error {
  constructor(public readonly missing: string[]) {
    super(`core 에 없는 품목 ${missing.length}개 — import-products 먼저 실행하거나 ALLOW_MISSING=1`);
    this.name = 'MissingSkuError';
  }
}

type PlanRow = { code: string; current: number; target: number; delta: number };

/** DRY_RUN 용 읽기 전용 계획 산출(잠금/쓰기 없음). */
async function computePlans(
  sql: Sql,
  targetByCode: Map<string, number>,
): Promise<{ plans: PlanRow[]; missing: string[] }> {
  const codes = [...targetByCode.keys()];
  const skuByCode = new Map<string, string>();
  for (const part of chunk(codes, 1000)) {
    const found = await sql<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE code IN ${sql(part)}`;
    for (const r of found) skuByCode.set(r.code, r.id);
  }
  const missing = codes.filter((c) => !skuByCode.has(c));

  const skuIds = [...skuByCode.values()];
  const currentBySku = new Map<string, number>();
  for (const part of chunk(skuIds, 1000)) {
    if (part.length === 0) continue;
    const led = await sql<{ sku_id: string; qty: number }[]>`
      SELECT sku_id, COALESCE(SUM(qty), 0)::int AS qty FROM stock_ledgers
      WHERE warehouse_id = ${BUCHEON_WAREHOUSE_ID} AND stock_state = 'ON_HAND' AND sku_id IN ${sql(part)}
      GROUP BY sku_id
    `;
    for (const r of led) currentBySku.set(r.sku_id, r.qty);
  }

  const plans: PlanRow[] = [];
  for (const [code, target] of targetByCode) {
    const skuId = skuByCode.get(code);
    if (!skuId) continue;
    const current = currentBySku.get(skuId) ?? 0;
    const delta = target - current;
    if (delta !== 0) plans.push({ code, current, target, delta });
  }
  return { plans, missing };
}

if (require.main === module) {
  main().catch((err: unknown) => {
    if (err instanceof MissingSkuError) {
      console.error(
        `\n❌ ${err.message}: ${err.missing.slice(0, 10).join(', ')}${err.missing.length > 10 ? ' …' : ''}`,
      );
    } else {
      console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  });
}
