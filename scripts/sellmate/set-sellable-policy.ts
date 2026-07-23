/**
 * 셀메이트 CSV 로 고른 variant 의 판매정책 플래그를 일괄 변경한다.
 *
 * 런북 §②-B 가 임시 SQL(temp table + \copy) 로 하던 걸 스크립트로 승격시킨 것.
 * 한국상품 always_sellable_zero_stock 적용도, 해외 특정 브랜드 선판매 예외도 같은 경로다.
 *
 *   # 마스트 머신/서플라이/배터리 선판매 ON (dry-run → apply)
 *   NAME_FILTER='마스트|MAST' KIND_FILTER='머신|서플라이|배터리' \
 *     bash scripts/sellmate/run.sh live set-sellable-policy <csv> --flag pre_stock_sellable --on
 *   … 같은 명령에 --apply 추가
 *
 *   # 런북 §②-B (한국상품 항상판매)
 *   bash scripts/sellmate/run.sh live set-sellable-policy <한국csv> \
 *     --flag always_sellable_zero_stock --on --apply
 *
 * ⚠️ 이 스크립트는 이벤트를 발행하지 않는다 (sync-stock 과 같은 이유 — raw UPDATE 라 outbox 를
 *    안 탄다). 끝나면 반드시 recalc-sellable 을 돌려야 Medusa 에 반영된다. 대상 variant 목록을
 *    stdout 과 --out 파일에 찍으므로 그대로 VARIANT_IDS 로 넘기면 된다.
 *
 * 환경변수:
 *   DATABASE_URL   core 논리 DB (run.sh 가 주입)
 *   NAME_FILTER    상품명 정규식 (예 '마스트|MAST'). 미지정이면 CSV 전체
 *   KIND_FILTER    상품명 2차 정규식 (예 '머신|서플라이|배터리'). NAME_FILTER 와 AND
 *   EXCLUDE_FILTER 제외할 상품명 정규식 (예 'RCA|어댑터')
 */
import * as fs from 'fs';
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns } from './parse';

const FLAGS = ['pre_stock_sellable', 'always_sellable_zero_stock'] as const;
type Flag = (typeof FLAGS)[number];

const COLUMN_CANDIDATES = {
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  productName: ['상품명', '인쇄용상품명', '상품명(서식)'],
  optionName: ['옵션명', '사입옵션명'],
  stock: ['현재재고', '재고'],
} as const;

type Target = { itemCode: string; productName: string; optionName: string; stock: string };

function parseArgs(argv: string[]) {
  const file = argv.find((a) => !a.startsWith('--'));
  const flag = argv[argv.indexOf('--flag') + 1] as Flag | undefined;
  const on = argv.includes('--on');
  const off = argv.includes('--off');
  const outIdx = argv.indexOf('--out');
  if (!file) throw new Error('CSV 경로가 필요합니다.');
  if (!flag || !FLAGS.includes(flag)) throw new Error(`--flag 는 ${FLAGS.join(' | ')} 중 하나여야 합니다.`);
  if (on === off) throw new Error('--on 또는 --off 중 정확히 하나를 주세요.');
  if (argv.includes('--set-manual-oos') && argv.includes('--clear-manual-oos')) {
    throw new Error('--set-manual-oos 와 --clear-manual-oos 는 같이 못 씁니다.');
  }
  return {
    file,
    flag,
    value: on,
    apply: argv.includes('--apply'),
    // 수동품절(availability_override) 이 걸려 있으면 플래그를 켜도 계산기가 품절로 판정한다.
    clearManualOos: argv.includes('--clear-manual-oos'),
    // 반대로 강제 품절시킬 때. 계산기가 가장 먼저 보는 값이라 재고·플래그와 무관하게 품절이 된다.
    setManualOos: argv.includes('--set-manual-oos'),
    out: outIdx > -1 ? argv[outIdx + 1] : undefined,
  };
}

async function readTargets(file: string): Promise<Target[]> {
  const rows = await readRows(file);
  const cols = detectColumns(rows[0], COLUMN_CANDIDATES);
  if (cols.itemCode < 0) throw new Error(`옵션정보일련번호 열을 못 찾았습니다. 헤더: ${rows[0].join(' | ')}`);

  const re = (v?: string) => (v ? new RegExp(v, 'i') : null);
  const name = re(process.env.NAME_FILTER);
  const kind = re(process.env.KIND_FILTER);
  const exclude = re(process.env.EXCLUDE_FILTER);

  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
  const out: Target[] = [];
  for (const row of rows.slice(1)) {
    const itemCode = get(row, cols.itemCode);
    const productName = get(row, cols.productName);
    if (!itemCode) continue;
    if (name && !name.test(productName)) continue;
    if (kind && !kind.test(productName)) continue;
    if (exclude && exclude.test(productName)) continue;
    out.push({ itemCode, productName, optionName: get(row, cols.optionName), stock: get(row, cols.stock) });
  }
  return out;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');

  const targets = await readTargets(opt.file);
  console.log(
    `📄 CSV 대상 품목 ${targets.length}개 (필터: name=${process.env.NAME_FILTER ?? '-'}, kind=${process.env.KIND_FILTER ?? '-'}, exclude=${process.env.EXCLUDE_FILTER ?? '-'})`,
  );
  if (targets.length === 0) return console.log('대상 없음 — 필터를 확인하세요.');

  const codes = [...new Set(targets.map((t) => t.itemCode))];
  const sql = postgres(url, { max: 2 });
  try {
    // 셀메이트 옵션정보일련번호 = skus.code (import-products 규약).
    // 매칭이 안 붙은 SKU 는 애초에 MATCHING_PENDING 이라 게이팅 자체가 없어 손댈 게 없다.
    const rows = await sql<
      {
        variant_id: string;
        code: string;
        pre_stock_sellable: boolean;
        always_sellable_zero_stock: boolean;
        availability_override: string | null;
        is_sellable: boolean | null;
        reason: string | null;
        sellable_quantity: number | null;
        calculated_at: Date | null;
      }[]
    >`
      SELECT pm.variant_id, s.code, pm.pre_stock_sellable, pm.always_sellable_zero_stock,
             p.availability_override, j.is_sellable, j.reason, j.sellable_quantity, j.calculated_at
      FROM skus s
      JOIN product_variant_sku_links l ON l.sku_id = s.id
      JOIN product_matchings pm ON pm.id = l.product_matching_id AND pm.status = 'matched'
      LEFT JOIN sales_variant_policies p ON p.variant_id = pm.variant_id
      LEFT JOIN product_sellable_quantity_projections j ON j.variant_id = pm.variant_id
      WHERE s.code = ANY(${codes})
    `;

    const byCode = new Map(rows.map((r) => [r.code, r]));
    const unmatched = targets.filter((t) => !byCode.has(t.itemCode));
    const variantIds = [...new Set(rows.map((r) => r.variant_id))];
    const already = rows.filter((r) => r[opt.flag] === opt.value).length;
    const manualOos = rows.filter((r) => r.availability_override === 'manual_out_of_stock');

    console.log(
      `🔗 매칭된 variant ${variantIds.length}개 (미매칭 품목 ${unmatched.length}개 — 매칭 전이라 이미 판매됨)`,
    );
    console.log(`   ${opt.flag} = ${opt.value} 로 변경: ${rows.length - already}건 (이미 그 값 ${already}건)`);
    if (manualOos.length) {
      console.log(
        `   ⚠️ 수동품절(manual_out_of_stock) ${manualOos.length}건 — 플래그만 켜도 계산기가 품절로 판정한다.` +
          (opt.clearManualOos ? ' → --clear-manual-oos 로 함께 해제' : ' → 해제하려면 --clear-manual-oos'),
      );
    }
    // 매칭된 것부터 보여준다 — 실제로 이 실행이 건드리는 게 그쪽이다.
    // Core 가 계산해 Medusa 로 내보낸 결론(projection)을 같이 찍는다 — "적용했는데 왜 아직 품절?" 의 1차 분기.
    // 여기가 판매가능인데 스토어프론트가 품절이면 원인은 Core 가 아니라 하류(inbox 지연/Medusa/캐시)다.
    const matched = targets.filter((t) => byCode.has(t.itemCode));
    for (const t of matched) {
      const r = byCode.get(t.itemCode)!;
      const proj =
        r.is_sellable === null
          ? '프로젝션없음'
          : `${r.is_sellable ? '판매가능' : '품절'}/${r.reason} 수량${r.sellable_quantity} @${r.calculated_at?.toISOString().slice(0, 16)}`;
      console.log(`   ✓ ${t.productName} / ${t.optionName} (재고 ${t.stock}) — Core판정 ${proj}`);
      console.log(`     variant=${r.variant_id}`);
    }
    for (const t of unmatched.slice(0, 10))
      console.log(`   · ${t.productName} / ${t.optionName} (재고 ${t.stock})  [미매칭 — 이미 무제한 판매]`);
    if (unmatched.length > 10) console.log(`   · … 미매칭 외 ${unmatched.length - 10}개`);

    if (!opt.apply) {
      console.log('\n✅ DRY-RUN 종료 — DB 미반영. 적용하려면 --apply');
      return;
    }
    if (variantIds.length === 0) return console.log('\n적용할 variant 없음.');

    // 컬럼명을 문자열로 조립하지 않는다 — 고르지 않은 쪽은 null 을 넣고 COALESCE 로 원값 유지.
    const pre = opt.flag === 'pre_stock_sellable' ? opt.value : null;
    const always = opt.flag === 'always_sellable_zero_stock' ? opt.value : null;

    await sql.begin(async (txRaw) => {
      // postgres TransactionSql 는 Omit 기반이라 호출 시그니처가 사라진다(TS 한계) → 호출 가능한 Sql 로 취급.
      const tx = txRaw as unknown as Sql;
      // 두 테이블을 함께 쓴다: product_matchings 는 매칭/어드민 기준, sales_variant_policies 는
      // 계산기가 실제로 읽는 정책. 하나만 바꾸면 어드민 표시와 판매동작이 갈라진다.
      await tx`
        UPDATE product_matchings SET
          pre_stock_sellable = COALESCE(${pre}::boolean, pre_stock_sellable),
          always_sellable_zero_stock = COALESCE(${always}::boolean, always_sellable_zero_stock),
          updated_at = now()
        WHERE variant_id = ANY(${variantIds}) AND status = 'matched'
      `;
      await tx`
        INSERT INTO sales_variant_policies (variant_id, pre_stock_sellable, always_sellable_zero_stock, updated_at)
        SELECT unnest(${variantIds}::uuid[]), COALESCE(${pre}::boolean, false), COALESCE(${always}::boolean, false), now()
        ON CONFLICT (variant_id) DO UPDATE SET
          pre_stock_sellable = COALESCE(${pre}::boolean, sales_variant_policies.pre_stock_sellable),
          always_sellable_zero_stock = COALESCE(${always}::boolean, sales_variant_policies.always_sellable_zero_stock),
          updated_at = now()
      `;
      if (opt.clearManualOos) {
        await tx`
          UPDATE sales_variant_policies SET availability_override = NULL, updated_at = now()
          WHERE variant_id = ANY(${variantIds}) AND availability_override = 'manual_out_of_stock'
        `;
      }
      if (opt.setManualOos) {
        await tx`
          UPDATE sales_variant_policies SET availability_override = 'manual_out_of_stock', updated_at = now()
          WHERE variant_id = ANY(${variantIds})
        `;
      }
    });

    console.log(`\n✅ 적용 완료: variant ${variantIds.length}개 ${opt.flag}=${opt.value}`);
    if (opt.out) {
      fs.writeFileSync(opt.out, variantIds.join('\n') + '\n');
      console.log(`   variant 목록 → ${opt.out}`);
    }
    console.log('\n▶ 다음 단계 (필수) — Medusa 반영:');
    console.log(
      `   VARIANT_IDS="${variantIds.slice(0, 3).join(',')}${variantIds.length > 3 ? ',…' : ''}" bash scripts/sellmate/run.sh live recalc-sellable .`,
    );
    if (opt.out)
      console.log(`   VARIANT_IDS="$(paste -sd, ${opt.out})" bash scripts/sellmate/run.sh live recalc-sellable .`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ 실패:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
