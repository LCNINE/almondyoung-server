#!/usr/bin/env bash
# cafe24 시절 URL(/product/{slug}/{product_no}) → 새 스토어프론트 masterId 매핑 생성.
#
# cafe24 이관은 끝났고 product_code ↔ master_id 는 불변이라 런타임 조회 대신
# 정적 JSON 으로 굽는다. 라이브 sitemap 과 교집합해 발행되지 않은 상품은 제외한다.
#
#   ./scripts/ops/build-cafe24-redirect-map.sh
#
# 로컬 docker PG 의 core DB 를 읽는다. 라이브 기준으로 다시 구우려면
# refresh-from-live.sh 로 core 를 갱신한 뒤 실행.
set -euo pipefail

OUT=web/almondyoung-storefront/src/lib/seo/cafe24-legacy-map.json
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo "1/3 core 에서 cafe24 product_code → master_id 추출"
docker exec almondyoung-server-postgres-1 psql -U postgres -d core -t -A -F'|' -c "
  select regexp_replace(product_code, '^cafe24-', ''), master_id
  from product_master_versions
  where status='active' and product_code ~ '^cafe24-[0-9]+$'
" > "$TMP/core.txt"

echo "2/3 라이브 sitemap 으로 발행된 handle 확인"
curl -sf -m 120 https://almondyoung.com/sitemap.xml \
  | grep -oE '/products/[0-9a-f-]{36}' | sed 's|/products/||' | sort -u > "$TMP/live.txt"

echo "3/3 medusa 카테고리 handle 추출 + JSON 생성"
docker exec almondyoung-server-postgres-1 psql -U postgres -d medusa -t -A -c "
  select regexp_replace(handle, '^cafe24-cat-', '')
  from product_category
  where handle ~ '^cafe24-cat-[0-9]+$' and (deleted_at is null)
" > "$TMP/cats.txt"

mkdir -p "$(dirname "$OUT")"
python3 - "$TMP" "$OUT" <<'PY'
import json, sys
tmp, out = sys.argv[1], sys.argv[2]
live = {l.strip() for l in open(f"{tmp}/live.txt") if l.strip()}
products = {}
for line in open(f"{tmp}/core.txt"):
    line = line.strip()
    if not line or "|" not in line:
        continue
    no, mid = line.split("|", 1)
    if mid in live:
        products[no] = mid
cats = sorted({c.strip() for c in open(f"{tmp}/cats.txt") if c.strip()}, key=int)
json.dump({"products": products, "categories": cats},
          open(out, "w"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
print(f"products={len(products)} (core 중 미발행 제외) categories={len(cats)} -> {out}")
PY
