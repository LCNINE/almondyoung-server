-- SKU 이름 "상품명 (옵션)" → "상품명 [옵션]". 셀메이트 송장처럼 옵션을 대괄호로 감싼다. 길이는 그대로다.
UPDATE "skus"
SET "name" = left("name", length("name") - length("option_key") - 2) || '[' || "option_key" || ']',
  "updated_at" = now()
WHERE "option_key" <> ''
  AND right("name", length("option_key") + 3) = ' (' || "option_key" || ')';
