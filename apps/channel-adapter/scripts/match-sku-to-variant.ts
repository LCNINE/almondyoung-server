/**
 * match-sku-to-variant.ts — 셀메이트 sku ↔ Medusa variant SKU 구성 매칭 (일괄)
 *
 * 경로: 셀메이트(카페코드+바코드) → Medusa variant(barcode 앞8=카페코드) → pimVariantId
 *       → core product_matchings(pending) → resolve 를 직접 SQL 로 재현.
 *
 * 매칭 규칙 셋. C 를 먼저 태우고, 안 붙으면 카페코드로 후보를 좁혀 A/B 로 내려간다:
 *   C) 옵션코드 직결 — 셀메이트 `옵션코드` == Medusa `variant.title`(`ON01043`).
 *      이름을 안 보므로 가장 정확하고 **카페코드가 없어도 붙는 유일한 경로**다.
 *      단 ON 코드를 가진 variant 가 전체의 2% 뿐이라 만능 키는 아니다.
 *      CSV 에 `옵션코드` 컬럼을 포함해 받아야 동작한다.
 *   A) 카페코드 1:1  — 그 카페코드에 셀메이트 옵션 1개 & Medusa variant 1개. 옵션 모호성 0.
 *   B) 그룹 내 옵션명 1:1 — 카페코드에 여러 variant 가 걸릴 때, 옵션명이 양쪽에서
 *      각각 유일하게 하나씩만 대응될 때만 매칭. 전역 상품명 매칭이 아니므로
 *      다른 상품끼리 옵션명이 겹쳐 오매칭될 여지가 없다.
 * B 에서 비교하는 Medusa 옵션명은 variant.title(=`ON00804` 같은 코드) 이 아니라
 * product_option_value 조합 (예: `J / 0.10 / 7mm`) 이다.
 *
 * 매칭 = admin "SKU 구성 매칭" 과 동일한 3테이블 변경:
 *   1) product_matchings: strategy='variant', status='matched', is_resolved=true, 정책
 *   2) product_variant_sku_links: (matching_id, sku_id, quantity=1) insert
 *   3) sales_variant_policies: variant 정책 upsert
 * ⚠️ 후속 recalc(sellable)·Kafka 발행은 하지 않는다 — DB 매칭까지만. (별도 처리)
 *
 * 사용:
 *   ... match-sku-to-variant.ts <csv> [--limit N] [--rule ABC] [--report out.csv] [--apply]
 *   기본 dry-run(rollback). --limit 로 소량. --apply 로 커밋.
 *   --rule 기본 ABC. 특정 규칙만 돌리려면 --rule C 처럼 지정.
 *   --report 로 대상 목록을 CSV 로 덤프 (육안 검토용, apply 여부와 무관).
 *
 * ENV: CORE_DB_URL, MEDUSA_DB_URL
 */
import * as postgresNs from 'postgres';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as Papa from 'papaparse';

const postgres = (postgresNs as any).default ?? postgresNs;
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '');

/** 옵션명 비교 키. 공백 차이·대소문자만 흡수한다 — 그 이상 느슨하게 풀면 오매칭이 품절로 이어진다. */
const optKey = (s: string) => (s ?? '').replace(/\s+/g, '').toLowerCase();
/**
 * 옵션 없는 상품의 옵션명을 셀메이트는 '단일상품', Medusa 는 '기본 옵션값' 으로 채운다.
 * (variant.title 은 '기본 품목' 이지만 여기서 비교하는 건 option_value 라 '기본 옵션값' 이다.)
 */
const SELLMATE_SINGLE = new Set(['단일상품', '단일옵션', '없음']);
const MEDUSA_SINGLE = '기본 옵션값';
const sellmateOptKey = (s: string) => optKey(SELLMATE_SINGLE.has((s ?? '').trim()) ? MEDUSA_SINGLE : s);

/** 값이 정확히 하나뿐인 후보만 돌려준다 (양방향 1:1 강제). */
const onlyOne = <T>(xs: T[]): T | undefined => (xs.length === 1 ? xs[0] : undefined);

/**
 * 한자(CJK) 3블록 + 깨진문자. 셀메이트가 중국 공급처 원문을 옵션명에 병기하는데
 * (`핑크 粉色`), CP949 로 내보내며 `?` 로 깨진다. Medusa 엔 한글만 있으므로 버리고 비교한다.
 *
 * ⚠️ **반드시 코드포인트 escape 로 쓸 것.** 리터럴로 `豈-﫿` 를 쓰면 겉보기가 똑같은
 * U+8C48(일반 한자)이 섞여 범위가 `U+8C48–U+FAFF` 가 되고 **한글 전체(U+AC00–U+D7A3)를 삼킨다.**
 * 아래 assert 가 그 사고를 막는다 — 지우지 말 것.
 */
const CJK = /[㐀-䶿一-鿿豈-﫿?]+/g;

/**
 * 복합 옵션명을 조각 집합으로. 구분자·순서·한자·`컬` 접미만 흡수한다.
 *   `JC컬,0.15,13mm` ↔ `JC컬 / 0.15 / 13mm`   (구분자·순서)
 *   `핑크 粉色`        ↔ `핑크`                  (한자)
 *   `J,0.15,9mm`     ↔ `J컬 / 9mm / 0.15`     (래쉬 도메인에서 J = J컬)
 *
 * 조각 값 자체는 건드리지 않는다 — `JC` ≠ `C`, `0.15` ≠ `0.20` 이 유지된다.
 * `0.15mm`→`0.15`, `대형`→`대` 같은 단위·축약 제거는 하지 않는다: 얻는 건 적고
 * (`8mm`↔`8`) 오매칭이 곧 잘못된 품절로 이어진다.
 */
const optSet = (s: string) =>
  [
    ...new Set(
      (s ?? '')
        .replace(CJK, '')
        .split(/[,/\s]+/)
        .map((p) => optKey(p).replace(/컬$/, ''))
        .filter(Boolean),
    ),
  ]
    .sort()
    .join('|');
const sellmateOptSet = (s: string) => optSet(SELLMATE_SINGLE.has((s ?? '').trim()) ? MEDUSA_SINGLE : s);

// 정규화 자체검증 — 눈으로는 절대 못 잡는 종류의 버그라 기동 시 강제한다.
if (optSet('밍크 C/0.15/12mm') === optSet('C / 0.15 / 12mm')) throw new Error('optSet: 한글이 지워진다');
if (optSet('핑크 粉色') !== optSet('핑크')) throw new Error('optSet: 한자가 안 지워진다');
if (optSet('J,0.15,9mm') !== optSet('J컬 / 9mm / 0.15')) throw new Error('optSet: 컬 접미 정규화 실패');
if (optSet('JC,0.15,9mm') === optSet('C컬 / 9mm / 0.15')) throw new Error('optSet: JC 와 C 가 뭉개진다');

/**
 * 규칙 A 는 옵션명을 안 보고 1:1 이면 붙인다. 그런데 카페코드 하나에 창고/판매가
 * 서로 **다른** 옵션만 남은 경우가 있다 (창고 '블랙' ↔ 판매 '로즈골드'). 이때 붙이면
 * 엉뚱한 옵션에 재고가 실린다. 양쪽 다 실제 옵션명을 가졌는데 다르면 사람이 볼 몫으로 남긴다.
 */
const ruleAOptionConflict = (smOpt: string, medOpt: string) => {
  const [a, b] = [sellmateOptKey(smOpt), optKey(medOpt)];
  if (!a || !b || a === optKey(MEDUSA_SINGLE) || b === optKey(MEDUSA_SINGLE)) return false;
  return optSet(smOpt) !== optSet(medOpt);
};

class Rollback extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const opt = (name: string) => {
    const a = args.find((x) => x.startsWith(`--${name}`));
    return a ? a.split('=')[1] ?? args[args.indexOf(a) + 1] : undefined;
  };
  const limit = opt('limit') != null ? Number(opt('limit')) : undefined;
  const rule = (opt('rule') ?? 'ABC').toUpperCase();
  if (!/^[ABC]+$/.test(rule)) throw new Error('--rule 은 A|B|C 조합 (기본 ABC)');
  const report = opt('report');
  const CSV = args.find((a) => a.endsWith('.csv') && a !== report);
  if (!CSV) throw new Error('csv path required');
  for (const k of ['CORE_DB_URL', 'MEDUSA_DB_URL']) if (!process.env[k]) throw new Error(`${k} required`);

  const core = postgres(process.env.CORE_DB_URL!, { max: 1 });
  const medusa = postgres(process.env.MEDUSA_DB_URL!, { max: 1 });

  try {
    // --- 셀메이트 CSV: 카페코드별 그룹 ---
    const text = iconv.decode(fs.readFileSync(CSV), 'euc-kr');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const g = (d: any, k: string) => (d[k] ?? '').replace(/"/g, '').replace(/^=/, '').trim();
    type SmRow = { barcode: string; optKey: string; name: string; option: string; stock: number;
                   optionCode: string };
    const byCafe = new Map<string, SmRow[]>();
    const allRows: SmRow[] = [];
    for (const d of parsed.data) {
      const barcode = onlyDigits(g(d, '바코드번호(서식)'));
      if (!barcode) continue;
      const option = g(d, '옵션명');
      const row: SmRow = {
        barcode,
        optKey: sellmateOptSet(option),
        name: g(d, '상품명'),
        option,
        stock: Number(onlyDigits(g(d, '현재재고')) || 0),
        // CSV 에 '옵션코드' 컬럼을 포함시켜 받아야 규칙 C 가 동작한다 (셀메이트 엑셀 양식 설정에서 추가)
        optionCode: g(d, '옵션코드'),
      };
      allRows.push(row);
      const cafe = g(d, '상품코드(카페)');
      if (cafe) (byCafe.get(cafe) ?? byCafe.set(cafe, []).get(cafe)!).push(row);
    }

    // --- Medusa: 카페코드별 variant 목록 (+ 옵션값 조합 라벨) ---
    // variant.title 은 `ON00804` 같은 내부코드라 셀메이트 옵션명과 대조 불가.
    // 사람이 보는 옵션명은 product_option_value 를 옵션명 순으로 이어붙인 것.
    const mv: { code: string; pimv: string | null; opt_label: string | null; product_title: string;
                vtitle: string | null }[] =
      await medusa.unsafe(`
        SELECT left(v.barcode,8) AS code,
               v.metadata->>'pimVariantId' AS pimv,
               p.title AS product_title,
               v.title AS vtitle,
               (SELECT string_agg(ov.value, ' / ' ORDER BY o.title)
                  FROM product_variant_option pvo
                  JOIN product_option_value ov ON ov.id = pvo.option_value_id
                  JOIN product_option o ON o.id = ov.option_id
                 WHERE pvo.variant_id = v.id) AS opt_label
        FROM product_variant v
        JOIN product p ON p.id = v.product_id AND p.deleted_at IS NULL
        WHERE v.deleted_at IS NULL AND (v.barcode ~ '^P' OR v.title ~ '^ON[0-9]')`);
    const medByCafe = new Map<string, typeof mv>();
    for (const r of mv) (medByCafe.get(r.code) ?? medByCafe.set(r.code, []).get(r.code)!).push(r);
    // 규칙 C: 셀메이트 옵션코드 == Medusa variant.title (`ON01043`). 이름을 안 보므로 가장 정확하다.
    // 다만 ON 코드를 가진 variant 가 전체의 2% 뿐이라 만능 키가 아니다 — 있으면 우선 쓰고 없으면 A/B.
    const medByOptionCode = new Map<string, (typeof mv)[number]>();
    for (const r of mv) if (r.vtitle && /^ON[0-9]/.test(r.vtitle)) medByOptionCode.set(r.vtitle, r);

    // --- core: 바코드 → sku_id (후보 그룹에 등장한 바코드 전부) ---
    const codes = [...new Set([...byCafe.values()].flat().map((r) => r.barcode))];
    const skuRows: { norm: string; sku_id: string }[] = await core.unsafe(
      `SELECT regexp_replace(barcode,'[^0-9]','','g') AS norm, sku_id FROM sku_barcodes
       WHERE regexp_replace(barcode,'[^0-9]','','g') = ANY($1)`, [codes]);
    const skuByBarcode = new Map(skuRows.map((r) => [r.norm, r.sku_id]));

    // --- core: pimVariantId → pending matching_id ---
    const pimvs = [...new Set(mv.map((r) => r.pimv).filter(Boolean))] as string[];
    const matchRows: { variant_id: string; id: string }[] = await core.unsafe(
      `SELECT variant_id, id FROM product_matchings WHERE variant_id = ANY($1) AND status='pending'`, [pimvs]);
    const matchByVariant = new Map(matchRows.map((r) => [r.variant_id, r.id]));

    // --- 매칭 후보 ---
    type Pair = { matchingId: string; skuId: string; variantId: string;
                  rule: 'A' | 'B' | 'C'; cafe: string; name: string; option: string;
                  medOption: string; stock: number };
    const pairs: Pair[] = [];
    const skipped = { 카페코드_medusa에없음: 0, 옵션명_해소실패: 0, sku_없음: 0, 이미매칭: 0, 규칙A_옵션명충돌: 0 };
    const claimed = new Set<SmRow>();

    // --- 규칙 C: 옵션코드 직결 (카페코드가 없어도 붙는 유일한 경로) ---
    if (rule.includes('C')) {
      for (const sm of allRows) {
        const cand = sm.optionCode ? medByOptionCode.get(sm.optionCode) : undefined;
        if (!cand?.pimv) continue;
        const skuId = skuByBarcode.get(sm.barcode);
        if (!skuId) { skipped.sku_없음 += 1; claimed.add(sm); continue; }
        const matchingId = matchByVariant.get(cand.pimv);
        if (!matchingId) { skipped.이미매칭 += 1; claimed.add(sm); continue; }
        claimed.add(sm);
        pairs.push({ matchingId, skuId, variantId: cand.pimv, rule: 'C', cafe: cand.code,
                     name: sm.name, option: sm.option, medOption: cand.opt_label ?? '', stock: sm.stock });
      }
    }

    for (const [cafe, rows] of byCafe) {
      const med = medByCafe.get(cafe);
      if (!med) { skipped.카페코드_medusa에없음 += rows.length; continue; }

      for (const sm of rows) {
        if (claimed.has(sm)) continue; // 규칙 C 가 이미 처리
        // A: 카페코드 하나에 양쪽 다 1개 → 옵션명 볼 것도 없이 확정.
        // B: 여러 개면 옵션명이 양쪽에서 각각 유일할 때만.
        let cand: (typeof med)[number] | undefined;
        let matchedRule: 'A' | 'B';
        if (med.length === 1 && rows.length === 1) {
          if (ruleAOptionConflict(sm.option, med[0].opt_label ?? '')) {
            skipped.규칙A_옵션명충돌 += 1;
            console.warn(`  ⚠️ [A-충돌] ${cafe} ${sm.name} | 창고 '${sm.option}' ↔ 판매 '${med[0].opt_label}' (재고 ${sm.stock})`);
            continue;
          }
          cand = med[0];
          matchedRule = 'A';
        } else {
          const smSameOpt = rows.filter((r) => r.optKey === sm.optKey);
          cand = smSameOpt.length === 1
            ? onlyOne(med.filter((m) => optSet(m.opt_label ?? '') === sm.optKey))
            : undefined;
          matchedRule = 'B';
        }
        if (!cand) { skipped.옵션명_해소실패 += 1; continue; }
        if (!rule.includes(matchedRule)) continue;
        if (!cand.pimv) { skipped.카페코드_medusa에없음 += 1; continue; }

        const skuId = skuByBarcode.get(sm.barcode);
        if (!skuId) { skipped.sku_없음 += 1; continue; }
        const matchingId = matchByVariant.get(cand.pimv);
        if (!matchingId) { skipped.이미매칭 += 1; continue; }

        pairs.push({ matchingId, skuId, variantId: cand.pimv, rule: matchedRule, cafe,
                     name: sm.name, option: sm.option, medOption: cand.opt_label ?? '', stock: sm.stock });
      }
    }

    // 한 variant 에 셀메이트 SKU 가 둘 이상 걸리면 어느 쪽도 신뢰할 수 없다 — 통째로 버린다.
    const byVariant = new Map<string, Pair[]>();
    for (const p of pairs) (byVariant.get(p.variantId) ?? byVariant.set(p.variantId, []).get(p.variantId)!).push(p);
    const conflicted = [...byVariant.values()].filter((v) => v.length > 1);
    const clean = [...byVariant.values()].filter((v) => v.length === 1).map((v) => v[0]);

    const targets = limit != null ? clean.slice(0, limit) : clean;
    const soldOut = targets.filter((p) => p.stock <= 0).length;
    console.log(`rule=${rule} 매칭 후보 ${clean.length}개 (A ${clean.filter((p) => p.rule === 'A').length} / B ${clean.filter((p) => p.rule === 'B').length} / C ${clean.filter((p) => p.rule === 'C').length})`);
    console.log(`  → 이번 대상 ${targets.length}개, 그중 재고 0 이하 ${soldOut}개가 품절 전환 (${apply ? 'APPLY' : 'DRY-RUN'})`);
    console.log(`  skip: ${JSON.stringify(skipped)} / variant중복충돌 ${conflicted.length}건 제외`);
    targets.slice(0, 5).forEach((p) =>
      console.log(`  [${p.rule}] ${p.cafe} ${p.name} | ${p.option} → ${p.medOption} (재고 ${p.stock})`));

    if (report) {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      fs.writeFileSync(report, '﻿' + [
        'rule,cafe,상품명,셀메이트옵션명,medusa옵션명,현재재고,matching_id,sku_id,pim_variant_id',
        ...targets.map((p) => [p.rule, p.cafe, p.name, p.option, p.medOption, p.stock,
                               p.matchingId, p.skuId, p.variantId].map(esc).join(',')),
      ].join('\n'));
      console.log(`  📄 리포트 ${targets.length}행 → ${report}`);
    }

    // --- 쓰기 ---
    // ⚠️ pre_stock_sellable 은 반드시 false 다. true 면 재고 0 일 때 계산기가
    // PRE_STOCK_SELLABLE(무한판매) 로 빠져 매칭을 붙여놓고도 품절이 안 걸린다.
    // 선판매는 상품별로 사람이 켜는 것이지, 매칭의 부수효과로 켜질 값이 아니다.
    const writeMatch = async (tx: any, p: { matchingId: string; skuId: string; variantId: string }) => {
      await tx`UPDATE product_matchings SET strategy='variant', status='matched', is_resolved=true,
               pre_stock_sellable=false, always_sellable_zero_stock=false, updated_at=now() WHERE id=${p.matchingId}`;
      await tx`INSERT INTO product_variant_sku_links (product_matching_id, sku_id, quantity)
               VALUES (${p.matchingId}, ${p.skuId}, 1) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO sales_variant_policies (variant_id, inventory_management, pre_stock_sellable, always_sellable_zero_stock)
               VALUES (${p.variantId}, true, false, false)
               ON CONFLICT (variant_id) DO UPDATE SET inventory_management=true, pre_stock_sellable=false,
               always_sellable_zero_stock=false, updated_at=now()`;
    };

    if (!apply) {
      await core.begin(async (tx: any) => {
        for (const p of targets) await writeMatch(tx, p);
        throw new Rollback();
      });
      console.log(`🔍 DRY-RUN (rolled back) — --apply 로 커밋`);
    } else {
      // 배치 커밋 — 대량 트랜잭션 timeout/lock 회피. 중단돼도 진행분 유지(멱등: 이미 matched 는 pending 조회서 제외)
      const CHUNK = 300;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = targets.slice(i, i + CHUNK);
        await core.begin(async (tx: any) => {
          for (const p of batch) await writeMatch(tx, p);
        });
        console.log(`  진행 ${Math.min(i + CHUNK, targets.length)}/${targets.length}`);
      }
      console.log(`✅ APPLIED — ${targets.length}건 매칭 완료`);
    }
  } catch (e) {
    if (e instanceof Rollback) console.log(`🔍 DRY-RUN (rolled back) — --apply 로 커밋`);
    else throw e;
  } finally {
    await core.end();
    await medusa.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
