#!/usr/bin/env bash
# 셀메이트 상품목록 export 의 '원가' 를 Core 상품(product_master_versions.supply_price)에 백필한다.
#
# 사용법:
#   DATABASE_URL=postgresql://... ./scripts/backfill-cost-from-sellmate.sh <셀메이트CSV>
#   DRY_RUN=1 DATABASE_URL=... ./scripts/backfill-cost-from-sellmate.sh <셀메이트CSV>
#
# 셀메이트 CSV 는 셀메이트 > 상품관리 > 상품목록 의 엑셀 다운로드(cp949, 47컬럼)를 그대로 넣는다.
# 매칭 경로는 backfill-supplier-from-sellmate.sh 와 같다:
#   셀메이트 바코드 → sku_barcodes → product_variant_sku_links
#   → product_matchings.master_id → product_master_versions
#
# ⚠️ 원가는 셀메이트에서 옵션(variant) 단위인데 supply_price 는 버전(master) 단위다.
#    한 상품 안에서 옵션별 원가가 갈리면 최댓값을 대표원가로 쓴다 — 마진을 과소평가하는
#    쪽이 안전하기 때문이다. 옵션별 정확한 원가가 필요해지면 product_variants 에
#    supply_price 를 신설해야 한다.
#
# SQL 을 이 파일 안에 둔 이유: .gitignore 가 `*.sql` 을 통째로 무시해서
# 별도 .sql 파일로 두면 레포에 남지 않는다.
set -euo pipefail

CSV="${1:-}"
if [[ -z "$CSV" || ! -f "$CSV" ]]; then
  echo "usage: DATABASE_URL=... $0 <셀메이트 상품목록 CSV>" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 이 필요하다." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
NORMALIZED="$WORK/sellmate-cost.csv"

python3 - "$CSV" "$NORMALIZED" <<'PY'
import csv, re, sys
src, dst = sys.argv[1], sys.argv[2]

def norm(s):
    return re.sub(r'[^0-9]', '', s or '')

# 같은 바코드가 여러 행에 나오면 큰 값을 남긴다 (아래 대표원가 규약과 같은 방향).
seen = {}
with open(src, newline='', encoding='cp949', errors='replace') as f:
    for row in csv.DictReader(f):
        barcode = norm(row.get('바코드번호(서식)') or row.get('바코드번호'))
        raw = (row.get('원가') or '').strip().replace(',', '')
        if not barcode or not raw.isdigit():
            continue
        cost = int(raw)
        if cost <= 0:
            continue
        seen[barcode] = max(seen.get(barcode, 0), cost)

with open(dst, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['barcode', 'cost'])
    for barcode, cost in sorted(seen.items()):
        w.writerow([barcode, cost])

print(f'정규화: 원가 있는 바코드 {len(seen)}건', file=sys.stderr)
PY

APPLY_SQL="
-- 상품별 대표원가 = 매칭된 옵션 원가의 최댓값
WITH master_cost AS (
  SELECT m.master_id, max(sc.cost) AS cost
  FROM sku_barcodes b
  JOIN product_variant_sku_links l ON l.sku_id = b.sku_id
  JOIN product_matchings m ON m.id = l.product_matching_id
  JOIN sellmate_cost sc
    ON sc.barcode = regexp_replace(b.barcode, '[^0-9]', '', 'g')
  WHERE m.master_id IS NOT NULL
  GROUP BY m.master_id
)
UPDATE product_master_versions v
SET supply_price = mc.cost
FROM master_cost mc
WHERE v.master_id = mc.master_id
  AND v.supply_price IS DISTINCT FROM mc.cost;
"

if [[ "${DRY_RUN:-}" = 1 ]]; then
  APPLY_SQL="
WITH master_cost AS (
  SELECT m.master_id, max(sc.cost) AS cost, count(DISTINCT sc.cost) AS distinct_costs
  FROM sku_barcodes b
  JOIN product_variant_sku_links l ON l.sku_id = b.sku_id
  JOIN product_matchings m ON m.id = l.product_matching_id
  JOIN sellmate_cost sc
    ON sc.barcode = regexp_replace(b.barcode, '[^0-9]', '', 'g')
  WHERE m.master_id IS NOT NULL
  GROUP BY m.master_id
)
SELECT count(*) AS 대상_상품,
       count(*) FILTER (WHERE distinct_costs > 1) AS 옵션별_원가_갈림,
       min(cost) AS 최소원가, max(cost) AS 최대원가
FROM master_cost;
"
fi

psql "$DATABASE_URL" <<EOF
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE sellmate_cost (barcode text, cost bigint) ON COMMIT DROP;

\copy sellmate_cost FROM '$NORMALIZED' WITH (FORMAT csv, HEADER true)

$APPLY_SQL

COMMIT;

SELECT count(*) AS 원가_채워진_상품_버전,
       count(DISTINCT master_id) AS 원가_채워진_상품
FROM product_master_versions
WHERE supply_price IS NOT NULL AND deleted_at IS NULL;
EOF
