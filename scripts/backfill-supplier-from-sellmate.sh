#!/usr/bin/env bash
# 셀메이트 상품목록 export 의 '공급처' 를 Core 상품(product_master_versions.supplier_id)에 백필한다.
#
# 사용법:
#   DATABASE_URL=postgresql://... ./scripts/backfill-supplier-from-sellmate.sh <셀메이트CSV>
#
# 셀메이트 CSV 는 셀메이트 > 상품관리 > 상품목록 의 엑셀 다운로드(cp949, 47컬럼)를 그대로 넣는다.
# 매칭 경로:
#   셀메이트 바코드 → sku_barcodes → product_variant_sku_links
#   → product_matchings.master_id → product_master_versions
# 바코드 표기가 제각각(`="123"`, `1-123`)이라 숫자만 남겨 매칭한다.
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
NORMALIZED="$WORK/sellmate-supplier.csv"

python3 - "$CSV" "$NORMALIZED" <<'PY'
import csv, re, sys
src, dst = sys.argv[1], sys.argv[2]

def norm(s):
    return re.sub(r'[^0-9]', '', s or '')

seen = {}
with open(src, newline='', encoding='cp949', errors='replace') as f:
    for row in csv.DictReader(f):
        barcode = norm(row.get('바코드번호(서식)') or row.get('바코드번호'))
        supplier = (row.get('공급처') or '').strip()
        if barcode and supplier:
            seen[barcode] = supplier

with open(dst, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['barcode', 'supplier'])
    for barcode, supplier in sorted(seen.items()):
        w.writerow([barcode, supplier])

print(f'정규화: 바코드 {len(seen)}건, 공급처 {len(set(seen.values()))}종', file=sys.stderr)
PY

psql "$DATABASE_URL" <<EOF
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE sellmate_supplier (barcode text, supplier text) ON COMMIT DROP;

\copy sellmate_supplier FROM '$NORMALIZED' WITH (FORMAT csv, HEADER true)

-- 1) 공급처 마스터에 없는 이름만 추가한다.
INSERT INTO suppliers (name)
SELECT DISTINCT s.supplier
FROM sellmate_supplier s
WHERE s.supplier <> ''
  AND NOT EXISTS (SELECT 1 FROM suppliers e WHERE e.name = s.supplier);

-- 2) 상품(master)의 모든 버전에 공급처를 심는다.
--    공급처는 버전마다 달라질 속성이 아니라 상품 자체의 조달 출처다.
--    updated_at 은 일부러 건드리지 않는다 — 운영자의 수정이 아니라 과거 데이터 정정이므로
--    '최근 수정' 정렬과 변경 이력을 오염시키면 안 된다.
WITH master_supplier AS (
  SELECT DISTINCT m.master_id, ss.supplier
  FROM sku_barcodes b
  JOIN product_variant_sku_links l ON l.sku_id = b.sku_id
  JOIN product_matchings m ON m.id = l.product_matching_id
  JOIN sellmate_supplier ss
    ON ss.barcode = regexp_replace(b.barcode, '[^0-9]', '', 'g')
  WHERE m.master_id IS NOT NULL
)
UPDATE product_master_versions v
SET supplier_id = sup.id
FROM master_supplier ms
JOIN suppliers sup ON sup.name = ms.supplier
WHERE v.master_id = ms.master_id
  AND v.supplier_id IS DISTINCT FROM sup.id;

COMMIT;

SELECT sup.name AS supplier, count(DISTINCT v.master_id) AS products
FROM product_master_versions v
JOIN suppliers sup ON sup.id = v.supplier_id
GROUP BY sup.name
ORDER BY 2 DESC;
EOF
