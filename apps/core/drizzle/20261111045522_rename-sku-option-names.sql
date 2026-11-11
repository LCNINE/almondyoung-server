-- SKU 이름 "상품명 옵션" → "상품명 (옵션)". 송장·창고앱·어드민이 옵션을 상품명과 구분해 보여 주도록.
UPDATE "skus"
SET "name" = left("name", length("name") - length("option_key") - 1) || ' (' || "option_key" || ')',
  "updated_at" = now()
WHERE "option_key" <> ''
  AND length("name") > length("option_key") + 1
  AND right("name", length("option_key") + 1) = ' ' || "option_key"
  AND length("name") + 2 <= 255;
