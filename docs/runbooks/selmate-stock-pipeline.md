# 셀메이트 → Core/Medusa 재고 동기화 · 입고예정 파이프라인

셀메이트(창고관리)에서 받은 재고 CSV 를 Core/Medusa 에 반영하는 스크립트 모음과 실행 순서. 두 갈래다:

- **Ⓐ 재고 동기화 (일일)** — 재고량을 WMS 로 강제 동기화하고 변동분 이벤트를 재발행해 **품절 처리**가 돌게 한다.
- **Ⓑ 예약 정리 (일일, Ⓐ 직전)** — Medusa 에 영원히 남는 예약(reservation)을 걷어내고 `reserved` 카운터를 예약 원장과 정합시킨다. 안 하면 재고가 이중으로 깎인다.
- **①②③ 입고예정 (수시)** — **스토어프론트에 입고예정일을 표시**한다.

> 이 문서는 "나중에 다시 돌릴 때 / Claude 에게 시킬 때" 를 위한 런북이다. 각 스크립트는 멱등(중복 실행 안전)하게 작성돼 있다.

## 전체 그림

```
셀메이트 재고 CSV (EUC-KR, "상품코드(카페)" + "미발송주문수" 포함해서 다운로드)
   │
   │ Ⓑ clear-reservations   (스냅샷 이전 Medusa 예약 해제 — Ⓐ 보다 먼저)
   │ Ⓐ import-products → sync-stock → recalc-sellable   (재고 동기화 + 이벤트 발행)
   │      ↑ 반영값 = 현재재고 − 미발송주문수
   ▼
core: skus / stock_events / stock_ledgers → ProductSellableQuantityChanged
   ▼
channel-adapter inbox → Medusa 재고 반영 (품절 처리)

셀메이트 재고 CSV (같은 파일)
   │
   │ ① import-inbound-plans.ts          (core 에 입고예정 적재)
   ▼
core: inbound_plans / inbound_plan_items  (발주+입고예정, 해외=중국 2-plan)
   │
   │ ② match-sku-to-variant.ts           (셀메이트 sku ↔ Medusa variant 매칭)
   ▼
core: product_variant_sku_links          (SKU 구성 매칭, admin "매칭"과 동일)
   │
   │ ③ sync-restock-to-medusa.ts         (입고예정 → Medusa variant.metadata)
   ▼
Medusa: variant.metadata.inboundDate / inboundApproximate
   │
   ▼
스토어프론트 restock-notice UI  "○월 ○일 입고 예정"
```

**핵심 매칭 다리**: 셀메이트 `상품코드(카페)`(cafe24 코드, 예 `P0000GYJ`) = Medusa `variant.barcode` 앞 8자. 이걸로 창고 sku ↔ 판매 variant 를 자동 연결한다 (창고/판매가 코드 체계가 달라 이 다리 없이는 매칭 불가).

**카페코드가 뭔지** — 셀메이트가 관리하는 코드가 아니라 **두 시스템이 같은 조상(cafe24)을 가졌다는 흔적**이다. Medusa 상품은 cafe24 에서 이관돼 `variant.barcode` 에 그 코드가 남았고, 셀메이트는 `상품코드(카페)` 컬럼에 참조용으로 들고 있다. 그래서 **cafe24 이후 셀메이트에만 추가된 상품은 이 값이 비어 있는 게 정상**이다 (2026-07-21 기준 4,002행). 이런 건 카페코드로는 영영 못 붙으므로 `옵션코드`(규칙 C)나 수동 매칭이 필요하다.

카페코드는 **상품** 단위라, 옵션이 여러 개인 상품은 카페코드 하나에 variant 가 여러 개 걸린다. 이때는 **옵션명**으로 한 번 더 가른다 (②의 규칙 B).

## 사전 준비 (공통)

- **live RDS 터널**: `cd deployments/lcnine/services && npx sst tunnel --stage live` (sudo, 유지)
- **DB 접속**: host/secret 은 메모리 `lcnine-services live` 참조. 비번은 Secrets Manager `lcnine-services-live-DbProxySecret-bazfzmnx` 에서 런타임 조회 (파일에 박지 말 것).
- **Medusa Admin**: `MEDUSA_API_URL=https://medusa.almondyoung.com`, `MEDUSA_API_KEY` = `cd deployments/lcnine/services && npx sst secret list --stage live | grep MedusaApiKey`
  - 옛 `medusa.almondyoung-next.com` 은 NXDOMAIN 이다 (도메인 이관). curl 이 `HTTP 000` 이면 여기부터 확인.
  - 인증은 **HTTP Basic** — `curl -u "$MEDUSA_API_KEY:"`. `x-medusa-access-token` 헤더는 `{"message":"Unauthorized"}` 가 난다.
- **CSV**: 셀메이트에서 컬럼 **상품코드(카페) / 바코드번호(서식) / 상품명 / 옵션명 / 현재재고 / 미발송주문수 / 입고예정일 / 입고예정수량** 포함해 다운로드.
  - ★ **`미발송주문수` 는 필수다.** 셀메이트 `현재재고` 는 아직 안 나간 주문분을 포함한 **물리 재고**라,
    그대로 넣으면 이미 팔린 수량을 다시 파는 셈이 된다. 반영할 값은 **`현재재고 - 미발송주문수`** 이고
    `sync-stock` 이 이 계산을 한다 (음수는 0 = 품절로 clamp, 몇 건인지 찍는다).
    이 열이 없는 CSV 는 스크립트가 **중단**한다 (`ALLOW_NO_UNSHIPPED=1` 로만 우회 — 오버셀 각오할 때만).
    2026-07-29 live 실측: 5,852행 / 현재재고 429,907 중 **미발송 24,094개**, 미발송>현재고인 행 153.
  - CSV 로 받으면 셀메이트가 코드·바코드를 `="P0000EXQ"` 로 감싸서 내보낸다(엑셀이 숫자로 바꾸는 걸 막는 장치).
    `scripts/sellmate/parse.ts` 의 `unarmor()` 가 벗겨내므로 그대로 넣으면 된다. 2026-07-22 이전에는 이걸
    안 벗겨서 `sku_barcodes` 절반과 `sku_groups` 2,319건에 `="..."` 가 그대로 저장됐고, 상품코드가 빈 행은
    전부 `=""` 라는 **한 그룹**으로 뭉쳤다(서로 다른 상품 70개 SKU). 그 잔재는 아직 DB 에 남아 있다.
  - 셀메이트가 **마이너스 재고**(`-1`)를 내보내는 행이 있다. `sync-stock` 은 0 으로 추정하지 않고 중단한다 —
    셀메이트에서 실재고를 정정하는 게 원칙이고, 급하면 그 셀만 0 으로 고친 사본으로 돌린다.
- **러너 사용 권장**: 아래 ①②③ 은 `CORE_DB_URL` 을 손으로 만드는 예시지만, 실제로는 러너가 RDS 엔드포인트·시크릿을 런타임 조회해 주입한다. 비번이 transcript 에 안 남는다.
  - `scripts/sellmate/run.sh <stage> <import-products|sync-stock|recalc-sellable|check> <경로>`
  - `scripts/sellmate/inbound-run.sh <stage> <import-inbound|match-sku|sync-restock> [args]`

## Ⓐ-0 동기화 금지 목록 — `scripts/sellmate/excluded.ts`

**셀메이트 재고를 반영하면 안 되는 상품**이 있다. 셀메이트에 재고가 잡혀 있어도 그게 "팔아도 되는 재고" 를
뜻하지 않는 경우다. 동기화하면 재고가 채워지면서 **품절이 풀려 팔린다.**

목록은 `scripts/sellmate/excluded.ts` 에 코드로 박혀 있고, `import-products` 와 `sync-stock` 이 파싱 단계에서
해당 행을 잘라낸다 (실행 시 `⛔ 동기화 제외 N행 — <사유>` 로 찍힘). **런북 문구만으론 사람이 빠뜨리므로
스크립트가 강제한다.**

| 상품                                                                                       | 상품일련번호        | 조치                                                                                                                                        | 등록일     |
| ------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `akf쌍커풀테이프`                                                                          | 13248               | **재고동기화 금지 + 품절 유지**                                                                                                             | 2026-07-23 |
| `미스티 래쉬` (중국 소싱, 카페코드 `P0000FJA`)                                             | 13333               | **재고동기화 금지 + 품절 유지**                                                                                                             | 2026-07-23 |
| `씨엠 쌍커풀 테이프` (카페코드 `P0000EAZ`, Medusa `prod_01KT8JM7CESNJAB3C66NV3ERGP` draft) | — (셀메이트에 없음) | **재고동기화 금지 + 품절 유지** — 셀메이트 미등록이라 name pattern 만, 품절은 Medusa `manage_inventory=true` 로 강제 (3 variant 전부 재고0) | 2026-07-24 |

제외 판정은 **상품일련번호 + 상품명 정규식** 두 갈래다 — 한쪽 열이 비어 있어도 다른 쪽이 잡는다.
추가할 땐 `EXCLUDED_PRODUCT_SERIALS` / `EXCLUDED_NAME_PATTERNS` 양쪽에 사유와 날짜를 남기고 이 표도 갱신한다.

**제외는 "안 건드림" 이지 "품절" 이 아니다.** 품절까지 걸어두려면 별도로:

```bash
NAME_FILTER='akf\s*쌍커풀\s*테이프' bash scripts/sellmate/run.sh live set-sellable-policy <csv> \
  --flag pre_stock_sellable --off --set-manual-oos --apply --out akf.txt
VARIANT_IDS="$(paste -sd, akf.txt)" bash scripts/sellmate/run.sh live recalc-sellable .
```

미스티 래쉬도 같은 절차지만 **2026-07-23 기준 품절 고정을 걸 대상이 없다.** 상태를 남겨둔다:

- Medusa 에 `미스티 래쉬`(handle `894de710-32f7-4092-b952-b7a7dc4a325b`) 가 **`draft` 로 존재**한다. variant 6개
  (`P0000FJA000A`~`000F`) 전부 `manage_inventory=false` / `allow_backorder=false`. draft 라 스토어프론트 노출은 없다.
- Core 매칭은 6옵션 중 3개(LC/8·9·10)에만 있는데, **그 매칭이 가리키는 Medusa variant UUID 3개가 Medusa 에 존재하지 않는다**
  (admin `product-variants?id[]=…` → `count 0`). Core 판정이 `NOT_ACTIVE_VERSION` 인 것도 같은 이야기다. 즉 **유령 매칭**이고,
  실제 draft 상품의 variant 6개는 Core 매칭이 하나도 없다.
- 그래서 `set-sellable-policy --set-manual-oos` 는 유령 variant 에만 걸려 실효가 없다. 걸지 않았다.
- **대신 Medusa 에 직접 `manage_inventory=true` 를 걸었다** (6 variant 전부, `allow_backorder=false` 유지).
  inventory level 이 아예 없어(`location-levels` 0건) available=0 → 품절 확정이다. published 로 바뀌어도 안 팔린다.

```bash
K=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaApiKey=//p')
# ⚠️ URL 의 <prod_id> 는 handle 이 아니라 `prod_…` id 다. handle 을 넣으면 본문 없는 500 이 난다.
curl -s -u "$K:" -X POST https://medusa.almondyoung.com/admin/products/<prod_id>/variants/<variant_id> \
  -H 'Content-Type: application/json' -d '{"manage_inventory":true,"allow_backorder":false}'
```

⚠️ **published 로 돌리기 전에** 매칭을 정상 variant 로 다시 붙일 것 — 지금은 유령 매칭이라 Core 가
이 상품의 재고를 관리하지 못한다.

일반화하면: **`excluded.ts` 등록은 "셀메이트 재고가 안 들어옴" 까지만 보장한다.** 판매 차단은 Medusa 쪽
`manage_inventory` / `availability_override` 가 하는 일이고, 매칭이 유령이거나 없으면 Core 로는 손댈 수 없다.

`--set-manual-oos` 는 `availability_override='manual_out_of_stock'` 을 건다. 계산기가 **가장 먼저** 보는 값이라
재고·플래그와 무관하게 품절이 된다 (`calculator.ts:98`).

⚠️ **미매칭 품목은 이 방법으로 못 막는다** — variant 를 모르니 정책을 걸 대상이 없다. 2026-07-23 기준
akf쌍커풀테이프 7옵션 중 6개는 매칭돼 품절 처리했고, `혼합(체험)` 1개는 미매칭이다. 이 상품은 Medusa 에서
`draft` 라 스토어프론트에 노출 자체가 안 돼 문제가 없지만, **published 로 바뀌면 그 옵션이 팔릴 수 있다.**

## Ⓑ 예약 정리 (일일, Ⓐ 직전) — `scripts/sellmate/clear-reservations.ts`

**Medusa 에서 예약이 풀리는 유일한 경로는 fulfillment 인데, 우리는 fulfillment 를 만들지 않는다.**
출고는 셀메이트에서 하고 Core `sales_orders.status` 만 직접 UPDATE 하기 때문이다. 그래서 주문 때 잡힌
예약이 영원히 남는다.

2026-07-29 live 실측:

|                           |                                                                 |
| ------------------------- | --------------------------------------------------------------- |
| `fulfillment` 테이블      | **0건** (한 번도 만든 적 없음)                                  |
| 살아있는 예약             | **2,830건 / 수량 12,358개** (주문 894건, 6/19~, 전부 `pending`) |
| 예약 > 창고재고인 variant | **197개** ← 재고가 있는데 품절로 보이는 구간                    |

스토어프론트가 보는 값은 `available = stocked - reserved` 다. `sync-stock` 이 `stocked` 를
`현재재고 - 미발송주문수` 로 정확히 맞춰도, **그 미발송분이 예약으로 한 번 더 빠져 이중 차감**된다.
매일 동기화할수록 격차가 벌어진다.

```bash
# dry-run (기본) — CSV 파일명에서 스냅샷 시각을 읽는다
DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations <csv>
DB_NAME=medusa bash scripts/sellmate/run.sh live clear-reservations <csv> --apply
```

- **기준은 "출고 여부" 가 아니라 "CSV 스냅샷 시각"** 이다. 그 시점까지의 미발송분은 CSV 의
  `미발송주문수` 로 이미 재고에서 빠졌고 출고분은 `현재재고` 에서 빠졌으니, **스냅샷 이전 예약은
  어느 쪽이든 이중 차감**이다. 스냅샷 이후 예약만 유효하다.
  (Medusa order ↔ Core sales_order 는 orderId 불일치 이력이 있어 출고 판정이 못 미덥다 — 시각은 CSV 자체가 증거다.)
- **Ⓐ 보다 먼저** 돌린다. 순서가 반대면 예약이 남은 채 재고가 내려가 `available` 이 잠깐 음수로 보인다.
- `reservation_item` soft delete → `inventory_level.reserved_quantity` **재정합**을 한 트랜잭션에서 한다.
  재정합 후에도 어긋난 칸이 남으면 부분 반영 없이 전체 롤백한다.
- 멱등: 조건이 `created_at < 기준시각` 고정이고 재정합은 덮어쓰기라 같은 CSV 로 다시 돌려도 안전.
- **정리 대상이 0건이어도 그냥 돌려라.** 카운터 재정합은 예약 삭제와 별개로 매번 실행된다 (아래).

### ★ `reserved` 는 캐시다 — 예약 원장이 정답

Medusa 는 재고를 두 군데 적는다:

|                                     |                                                  |
| ----------------------------------- | ------------------------------------------------ |
| `reservation_item`                  | 예약 **원장**. 행 하나 = 예약 하나 (soft delete) |
| `inventory_level.reserved_quantity` | 그 합계를 미리 계산해둔 **캐시**                 |

스토어프론트가 보는 값은 `available = stocked − reserved` 라 **캐시가 틀어지면 재고가 있어도 품절**이다.
그래서 Ⓑ 는 `reserved − qty` 로 차감하지 않고 **살아있는 예약 합계로 덮어쓴다**. 차감식은 카운터가 이미
틀어져 있으면 그 틀어짐을 영구히 이어받지만, 덮어쓰기는 매번 원장이 정답이라 **과거 잔재까지 같이 낫는다.**

**2026-07-30 사고**: 예약 행은 지워졌는데 캐시가 안 내려간 칸이 **243칸 / 9,465개** 누적돼 있었다
(살아있는 예약 7개 vs 캐시 합계 9,472개). 그 탓에 **재고가 있는데 품절인 상품 47개 / 묻힌 재고 2,355개** —
`노몬드 아이패치 50개입`(stocked 187 / reserved 200 / available **−13**), `하이드로겔 아이패치 무지 고급형`(1,054개),
`롤리킹 펌제 1제2제`(179개) 등. 어긋남은 **전부 한 방향**(reserved 과다)이었고 **243칸 전부 예약 삭제 이력이 있는 칸**이라,
원인은 "예약 생성 경로" 가 아니라 "삭제 시 카운터 미차감" 으로 특정됐다. 덮어쓰기로 바꾼 뒤 전량 복구
(`available` 음수 61칸 → 0, revalidate 47건).

**"재고 있는데 품절" 신고를 받으면 이 카운터를 1번으로 의심한다** — Ⓐ·매칭·플래그를 다 파보기 전에 여기다.
Ⓑ dry-run 이 한 줄로 알려준다:

```
🧮 reserved 카운터 어긋남: 243칸 / 9465개 — 살아있는 예약 합계로 맞춥니다.   ← 0칸이면 정상
```

### ⚠️ 반영은 캐시 2겹 — 순서를 지켜야 한다 (Ⓑ 의 진짜 함정)

**Ⓑ 는 Medusa DB 직접 쓰기라 이벤트를 발행하지 않는다.** `recalc-sellable` 로도 안 풀린다 (Core 는 애초에
정상 판정 중이었다). 그리고 그 아래로 캐시가 **두 겹** 있다:

| 겹 | 무엇 | TTL | 어떻게 깨지나 |
|----|------|-----|---------------|
| 1 | **live Medusa 응답 캐시** (`@medusajs/caching-redis`, namespace `{medusa-cache}`, valkey 사이드카) | **1시간** (`@medusajs/caching` 기본값) | 태그 무효화는 **Medusa 이벤트로만** 돈다 → DB 직접 쓰기는 **안 깨진다** |
| 2 | 스토어프론트 fetch 캐시 (`product-{handle}` 태그) | 1시간 | `/api/revalidate` |

**순서가 반대면 헛수고다.** 1겹이 stale 한 상태에서 2겹을 무효화하면, 스토어프론트가 stale 값을 **다시 받아가
캐시에 새로 굳는다.** 2026-07-30 이 실수를 했다: DB 를 187/0 으로 고치고 revalidate 47건을 때렸는데
store API 가 `inventory_quantity −14` / `allow_backorder true`(둘 다 옛 값)를 계속 줘서 화면이 그대로였다.
쿼리 문자열을 바꿔도 같은 값이 나오면 **1겹 캐시**다 (admin API 는 캐시를 안 타므로 admin 과 store 응답이
다르면 확정).

```bash
# 1겹이 stale 한지 확인 — admin(진실) vs store(캐시) 대조
K=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaApiKey=//p')
curl -s -u "$K:" https://medusa.almondyoung.com/admin/inventory-items/<iitem_id>/location-levels   # DB 값
PK=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaPublishableKey=//p')
curl -s -H "x-publishable-api-key: $PK" -G https://medusa.almondyoung.com/store/products \
  --data-urlencode "handle=<handle>" --data-urlencode "fields=*variants,+variants.inventory_quantity"
```

**깨는 방법 두 가지:**

- **(a) 그냥 기다린다 — TTL 최대 1시간.** 리스크 0. 급하지 않으면 이게 정답이다.
- **(b) Medusa 이벤트를 유발한다** — admin API 로 그 재고칸에 **같은 값**을 다시 써서 무효화를 태운다.
  (live 쓰기라 승인 필요. `reserved` 는 건드리지 않고 `stocked_quantity` 만 동일값으로 PUT)

  ```bash
  curl -s -u "$K:" -X POST \
    https://medusa.almondyoung.com/admin/inventory-items/<iitem_id>/location-levels/<sloc_id> \
    -H 'Content-Type: application/json' -d '{"stocked_quantity":<현재값과 동일>}'
  ```

**그 다음에** 2겹(스토어프론트)을 무효화한다 — 복구된 handle 만 골라 때린다:

```bash
S=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^StorefrontRevalidateSecret=//p')
while IFS=$'\t' read -r h _; do
  curl -s -o /dev/null -w "%{http_code} $h\n" -X POST https://almondyoung.com/api/revalidate \
    -H 'content-type: application/json' -H "x-revalidate-secret: $S" -d "{\"handle\":\"$h\"}"
done < handles.tsv
```

⚠️ **최종 확인은 브라우저(시크릿 창)로 한다.** SSR HTML 의 CTA 는 항상 "옵션을 선택해주세요"(disabled) 라
`curl | grep 품절` 로는 판정이 안 된다 (②-C 의 같은 경고 참조).

복구 대상 handle 목록은 **--apply 전에** 뽑아야 한다 (적용 후엔 조건이 사라져 못 찾는다):

```sql
-- DB_NAME=medusa. reserved 재정합으로 품절이 풀릴 상품
WITH live AS (
  SELECT inventory_item_id, location_id, SUM(quantity)::int AS q
  FROM reservation_item WHERE deleted_at IS NULL GROUP BY 1,2
)
SELECT DISTINCT p.handle, il.stocked_quantity, il.reserved_quantity, p.title
FROM inventory_level il
LEFT JOIN live ON live.inventory_item_id = il.inventory_item_id AND live.location_id = il.location_id
JOIN product_variant_inventory_item pvii
  ON pvii.inventory_item_id = il.inventory_item_id AND pvii.deleted_at IS NULL
JOIN product_variant v ON v.id = pvii.variant_id AND v.deleted_at IS NULL
JOIN product p ON p.id = v.product_id AND p.deleted_at IS NULL
WHERE il.deleted_at IS NULL
  AND il.reserved_quantity > COALESCE(live.q, 0)
  AND il.stocked_quantity > 0
  AND il.stocked_quantity - il.reserved_quantity <= 0
ORDER BY il.stocked_quantity DESC;
```

⚠️ **이건 증상 치료다.** 근본은 셀메이트 출고 수집 시 Medusa fulfillment 를 만들거나(또는 예약을 해제)
하는 것이고, 그 전까지는 매일 Ⓑ 를 돌려야 한다.

## Ⓐ 재고 동기화 (일일) — `import-products` → `sync-stock` → `recalc-sellable`

물류팀이 셀메이트를 계속 쓰는 동안, **셀메이트 재고량을 WMS 로 강제 동기화하고 변동분 이벤트를 재발행**하는 경로.
이게 있어야 스토어프론트 품절 처리가 현실적으로 돌아간다. 적어도 하루 1회, 주문수집과 같이 돌린다.

> ⚠️ **①②③(입고예정) 보다 먼저 돌려야 한다.** ① 이 바코드로 `sku_barcodes` 를 조회하는데, 신규 SKU 는 `import-products` 가 만들어야 존재한다.

```bash
# A-1. 신규 SKU/그룹/바코드 등록 (재고는 안 건드림, code 기준 upsert)
DRY_RUN=1 bash scripts/sellmate/run.sh live import-products <csv>
bash scripts/sellmate/run.sh live import-products <csv>

# A-2. 현재고를 셀메이트 값에 맞춤 (delta 만큼 ADJUST_UP/DOWN)
DRY_RUN=1 bash scripts/sellmate/run.sh live sync-stock <csv>
bash scripts/sellmate/run.sh live sync-stock <csv>

# A-3. ★ 이벤트 발행 — 이걸 빼먹으면 스토어프론트가 stale 하다
bash scripts/sellmate/run.sh live recalc-sellable .
```

- **A-2 는 이벤트를 발행하지 않는다.** `stock_events`/`stock_ledgers` 를 raw SQL 로 직접 쓰기 때문에 outbox 를 안 탄다. DB 트리거·CDC 도 없다. 그래서 A-3 이 필수다.
- A-2 는 매칭된 SKU 재고가 바뀌면 경고 후 **exit 2** 로 끝난다 — A-3 을 빼먹지 못하게 하는 장치다. (매칭 전 단계라 무시해도 되면 `SKIP_SELLABLE_CHECK=1`)
- A-3 이 발행하는 `ProductSellableQuantityChanged` 가 **품절 반영의 유일한 경로**다: `channel-adapter` 의 `ProductSellableQuantityConsumer` → `inbox_events` → `InboxWorkerService` → Medusa. (`StockReceived`/`StockAdjusted` 등은 Kafka 로 나가지만 컨슈머가 없다.)
- 멱등: A-1 은 code 기준 upsert, A-2 는 delta=0 이면 no-op, A-3 은 프로젝션이 이전과 같으면 publish 스킵. 같은 파일을 여러 번 돌려도 안전하다.
- A-2 는 단일 트랜잭션 + advisory lock + `FOR UPDATE` 라 부분 반영이 없다.

### ⚠️ A-3 는 배치로 돈다 — 한 트랜잭션에 몰지 말 것

`ProductSellableQuantityService.recalculateAndPublishForVariants()` 는 **넘긴 목록 전체를 트랜잭션 하나로** 처리한다 (`dbService.run` 이 루프를 통째로 감쌈). 원래 이벤트 하나당 variant 몇 개를 다루는 함수라, 수만 개를 그대로 넘기면:

- 끝까지 가야 커밋 → 중간에 끊기면 **전부 롤백**
- 진행률이 밖에서 안 보임 (`product_sellable_quantity_projections` 가 그대로)
- live 에 장시간 트랜잭션 → vacuum·DDL 이 막히고 `idle in transaction` 이 쌓임

그래서 `recalc-sellable.ts` 가 `RECALC_CHUNK`(기본 200) 단위로 잘라 넘긴다. 배치마다 독립 트랜잭션이라 끊겨도 그때까지는 남고, 진행률·처리속도·남은시간이 찍힌다. **이 배치 구조를 되돌리지 말 것.**

특정 건만 다시 계산하려면 `VARIANT_IDS` 로 지정한다 (복구용):

```bash
VARIANT_IDS="uuid1,uuid2" npx tsx scripts/sellmate/recalc-sellable.ts
```

실측(2026-07-21 live): 초당 약 5.6건, 19,000건에 약 1시간.

### ⚠️ `SINCE_HOURS` 함정

A-3 은 최근 `sellmate-sync` stock_events 를 훑어 대상 variant 를 찾는데, **기본 조회 범위가 24시간**이다.
하루 간격을 지키면 맞지만 **주말·휴일로 하루라도 건너뛰면 그 사이 재고변동이 통째로 누락**된다. 중복 실행은 무해하므로 넉넉히 주는 편이 안전하다:

```bash
SINCE_HOURS=72 bash scripts/sellmate/run.sh live recalc-sellable .
```

재고가 아예 어긋나기 시작하면 A-2 를 다시 돌리면 delta 가 다시 잡히므로 복구된다.

### 발행 검증

A-3 이후 outbox 가 실제로 비워졌는지 확인한다 (core DB):

```sql
SELECT status, count(*) FROM outbox_events
WHERE event_type = 'ProductSellableQuantityChanged'
  AND created_at >= now() - make_interval(mins => 60)
GROUP BY status;

SELECT count(*) FROM outbox_events WHERE status = 'failed';  -- 0 이어야 정상
```

`published` 만 있고 `failed` 0 이면 Kafka 까지 나간 것이다. `pending` 이 안 줄면 live core 앱의 outbox 디스패처를 확인한다.

## ① 입고예정 적재 — `apps/core/scripts/import-inbound-plans.ts`

셀메이트 입고예정(`입고예정일`/`입고예정수량`)을 core 발주+입고예정으로 적재.

```bash
CORE_DB_URL="postgresql://postgres:<pw>@<live-host>:5432/core?sslmode=require" \
  npx ts-node -r tsconfig-paths/register apps/core/scripts/import-inbound-plans.ts <csv> [--apply]
```

- 기본 dry-run(insert→rollback, 리포트만), `--apply` 로 커밋.
- 바코드 숫자정규화로 `sku_barcodes` 매칭. 입고예정일별로 PO 1건, 중국 공급처=해외 2-plan(source+destination).
- 멱등: 같은 (sku, 예정일) 로 pending plan 있으면 skip.

## ② SKU 매칭 — `apps/channel-adapter/scripts/match-sku-to-variant.ts`

셀메이트 sku 를 Medusa 판매 variant 에 "SKU 구성 매칭"(admin 의 그것과 동일하게 3테이블) 으로 연결.

**매칭이 왜 중요한가**: 매칭이 안 붙은 variant 는 `manage_inventory=false` 로 남아 **재고와 무관하게 무한정 팔린다** (`NON_STOCK_GATED_REASONS` 의 `MATCHING_MISSING`). 품절 처리가 도는 유일한 조건이 매칭이다.

### 매칭 규칙

둘 다 **카페코드로 후보를 먼저 좁힌 뒤** 판정한다. 전역 상품명 매칭은 하지 않는다 — 다른 상품끼리 옵션명이 겹치면 멀쩡한 상품이 품절돼 버린다.

| 규칙  | 조건                                                                          | 비고                          |
| ----- | ----------------------------------------------------------------------------- | ----------------------------- |
| **C** | 셀메이트 `옵션코드` == Medusa `variant.title` (`ON01043` 형식)                | **가장 정확. 이름을 안 본다** |
| **A** | 카페코드 하나에 셀메이트 옵션 1개 **&** Medusa variant 1개                    | 옵션 모호성 0                 |
| **B** | 카페코드에 여러 개가 걸릴 때, **옵션명이 양쪽에서 각각 유일하게** 하나씩 대응 | 옵션 상품 대부분이 여기       |

**규칙 C (옵션코드)** — CSV 다운로드 시 `옵션코드` 컬럼을 포함시켜야 쓸 수 있다 (셀메이트 엑셀 양식 설정에서 추가). 2026-07-21 기준 카페코드 교차검증에서 **불일치 0건**. 다만 Medusa 27,068 variant 중 `ON*` title 을 가진 건 **501개뿐**이라 만능 키가 아니라 래쉬 계열 전용 다리다. 있으면 최우선으로 쓰고, 없으면 A/B 로 내려간다.

- B 에서 비교하는 Medusa 옵션명은 `variant.title`(=`ON00804` 같은 내부코드) 이 **아니라** `product_option_value` 조합(예 `J / 0.10 / 7mm`) 이다. 셀메이트 `옵션명` 과 대조된다.
- 셀메이트 `단일상품`/`단일옵션`/`없음` ↔ Medusa **`기본 옵션값`**. (`variant.title` 은 `기본 품목` 이지만 B 가 비교하는 `option_value` 는 `기본 옵션값` 이다 — 헷갈리기 쉽다.)

**B 의 옵션명 정규화 — 여기까지만 한다:**

| 정규화                  | 예                                | 근거                                                                                                        |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 구분자 `,` `/` 공백     | `골드,소형` ↔ `골드 / 소형`       | 같은 값을 다르게 이었을 뿐                                                                                  |
| 토큰 순서 무시          | `0.20,13mm` ↔ `13mm / 0.20`       | 〃                                                                                                          |
| 한자·깨진문자(`?`) 제거 | `핑크 粉色` ↔ `핑크`              | 셀메이트가 중국 공급처 원문을 병기. CP949 로 내보내며 `?` 로 깨진다 (셀메이트에 UTF-8 내보내기 옵션은 없다) |
| **`컬` 접미 제거**      | `J,0.15,9mm` ↔ `J컬 / 9mm / 0.15` | 래쉬 도메인에서 `J` = `J컬` (같은 컬 종류)                                                                  |

**하지 않는 정규화** — `0.15mm`→`0.15`, `대형`→`대` 같은 단위·축약 제거는 안 한다. `8mm`↔`8` 오매칭이 곧 잘못된 품절이라 이득 대비 위험이 크다.

⚠️ **한자 제거 정규식은 코드포인트 escape 로만 쓸 것.** 리터럴로 `豈-﫿` 를 쓰면 겉보기가 똑같은 **U+8C48**(일반 한자)이 섞여 범위가 `U+8C48–U+FAFF` 가 되고, **한글 전체(U+AC00–U+D7A3)를 삼킨다**. 2026-07-21 이 버그로 `밍크 C/0.15/12mm` 가 `C / 0.15 / 12mm` 와 매칭되는 걸 측정 단계에서 잡았다 (적용 전이라 피해 없음). 정규화 함수에는 **한글 보존 / 한자 제거 assert 를 반드시 남긴다.**

- 한 variant 에 셀메이트 SKU 가 둘 이상 걸리면 **양쪽 다 버린다**. 어느 쪽이 맞는지 알 수 없는데 재고를 잘못 붙이면 되돌리기 비싸다.
- Medusa variant 1개인데 셀메이트 옵션이 여러 개인 카페코드도 이 규칙에 걸려 제외된다 (2026-07-21 기준 약 1,500건). 수동 매칭 대상.

```bash
CORE_DB_URL=...core MEDUSA_DB_URL=...medusa \
  npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/match-sku-to-variant.ts <csv> \
    [--rule A|B|AB] [--limit N] [--report out.csv] [--apply]
```

- 기본 dry-run(rollback), 기본 `--rule AB`.
- `--report out.csv` 로 대상 전체를 CSV 덤프 (rule/상품명/양쪽 옵션명/현재재고 포함). **apply 전에 재고 있는 행 위주로 눈으로 훑을 것** — 재고 0 은 틀려도 품절, 재고 있는 걸 잘못 붙이면 멀쩡한 상품이 죽는다.
- 권장 순서: `--rule A --apply` (리스크 0) → `--rule B --report` 로 검토 → `--rule B --limit 20 --apply` 검증 → `--rule B --apply`.
- 실행하면 매칭 건수와 함께 **"그중 재고 0 이하 N개가 품절 전환"** 을 찍는다. 이 숫자가 이번 실행의 실제 영향 규모다.
- 변경 테이블: `product_matchings`(strategy='variant', status='matched'), `product_variant_sku_links`(insert), `sales_variant_policies`(정책 upsert).
- ⚠️ **`pre_stock_sellable` 은 false 로 쓴다. 절대 true 로 되돌리지 말 것.** 계산기(`product-sellable-quantity.calculator.ts`) 순서가 `재고>0 → SELLABLE` / `preStockSellable → PRE_STOCK_SELLABLE(무한판매)` / `else → 품절` 이라, 이 값이 true 면 **재고 0 일 때만** 발동해서 정확히 품절시키려는 케이스를 무력화한다. `PRE_STOCK_SELLABLE` 은 `NON_STOCK_GATED_REASONS` 에 있어 Medusa `manage_inventory=false` 로 이어진다.
  - 2026-07-21 이전 버전은 매칭마다 `true` 를 박았다. 그래서 **매칭이 붙어 있는데도 품절이 안 걸리는** 상태가 17,420건 누적됐다. 선판매는 상품별로 사람이 admin 에서 켜는 것이지 매칭의 부수효과가 아니다.
- ⚠️ **후속 recalc(sellable)·Kafka 발행은 안 한다** — 매칭의 Medusa 재고 반영(품절/선판매)은 별도. 매칭 후 **Ⓐ A-3 `recalc-sellable` 을 넉넉한 `SINCE_HOURS` 로 다시 돌려야** 품절이 실제로 반영된다. 입고예정 표시(③)는 links 만으로 동작.
- 멱등: 이미 matched 는 pending 조회에서 자동 제외. 대량은 300건씩 배치 커밋(timeout 회피).
- **분석 전용**: `match-dryrun.ts` 는 매칭 가능 규모만 측정(쓰기 없음). 매칭률/미매칭 원인 확인용.

### ②-B ★ 매칭 직후 반드시: 한국상품 `always_sellable_zero_stock` 적용

**이걸 빼먹으면 한국상품이 재고 0 인 순간 전부 품절된다.** 매칭 스크립트는 이 플래그를 켜지 않는다.

정책은 "**한국상품은 재고 0 이어도 계속 판매, 해외(중국 등)만 품절**" 이다. 국내는 조달이 빨라서다. 그런데 **한국/해외 구분은 셀메이트에만 있는 정보**라 Core 스키마에 없다 — 그래서 코드가 아니라 **이 런북의 절차**로 유지한다. CSV 를 받을 때마다 다시 걸어야 한다.

```bash
# 1) 셀메이트에서 CSV 를 두 벌 받는다 — 한국 / 한국·한국직배 제외(=해외)
#    (둘의 옵션정보일련번호는 겹치지 않고 합치면 전체가 된다)

# 2) 한국 CSV 로 플래그 ON (dry-run → apply). 옵션정보일련번호 → skus.code 조인은 스크립트가 한다.
bash scripts/sellmate/run.sh live set-sellable-policy <한국csv> --flag always_sellable_zero_stock --on
bash scripts/sellmate/run.sh live set-sellable-policy <한국csv> --flag always_sellable_zero_stock --on --apply \
  --out kr-variants.txt

# 3) ★ Medusa 반영 — 스크립트는 이벤트를 발행하지 않는다
VARIANT_IDS="$(paste -sd, kr-variants.txt)" bash scripts/sellmate/run.sh live recalc-sellable .
```

`set-sellable-policy.ts` 는 이 절차 전용이 아니라 **"CSV 로 고른 variant 의 판매정책 플래그를 바꾸는"** 범용
스크립트다 (`--flag pre_stock_sellable | always_sellable_zero_stock`, `--on|--off`). 예전엔 여기 임시 SQL
(temp table + `\copy`)이 적혀 있었는데, variant_id 목록을 손으로 뽑아야 해서 매번 틀렸다. 지금은 CSV 를 그대로 넣는다.

- `NAME_FILTER` / `KIND_FILTER` / `EXCLUDE_FILTER` (정규식) 로 CSV 안에서 대상을 좁힌다. CSV 를 미리 자를 필요 없다.
- dry-run 이 기본. `--apply` 로 커밋, `--out <file>` 로 variant 목록을 받아 그대로 `VARIANT_IDS` 에 넘긴다.
- `product_matchings` 와 `sales_variant_policies` **양쪽**을 함께 쓴다. 하나만 바꾸면 어드민 표시와 실제 판매동작이 갈라진다.
- 수동품절(`availability_override='manual_out_of_stock'`)이 걸린 건은 플래그를 켜도 계산기가 품절로 판정한다.
  스크립트가 몇 건인지 경고하며, 함께 풀려면 `--clear-manual-oos` / 반대로 걸려면 `--set-manual-oos`.
- **매칭 안 된 품목은 건드리지 않는다** — `MATCHING_PENDING` 이라 애초에 게이팅이 없어 이미 무제한 판매 중이다.
  dry-run 이 `[미매칭]` 으로 표시하는 게 정상이며, 이 숫자가 크면 정책 문제가 아니라 ② 매칭이 안 붙은 것이다.

계산기 순서상 `always_sellable_zero_stock` 이 `pre_stock_sellable` 보다 **먼저** 평가된다. 둘 다 무한판매로 가지만 의미가 다르다 — **"항상 판매"는 `always_sellable_zero_stock`, "입고 전 선판매"는 `pre_stock_sellable`.** 한국상품 정책은 전자다. 매칭이 켜는 값(`pre_stock_sellable=false`)과 충돌하지 않는다.

미매칭(`pending`) 상품은 `MATCHING_PENDING` 이라 어차피 비-게이팅이므로 플래그가 없어도 팔린다. **문제는 새로 매칭되는 순간**이다 — 그래서 매칭할 때마다 이 절차를 같이 돌린다.

### ②-C 해외상품 중 품절시키면 안 되는 예외 — `pre_stock_sellable`

②-B 의 "해외는 품절" 은 기본값이지 전부가 아니다. **주문받고 들여오는 해외 브랜드**가 있고, 이건 재고 0 이
정상 영업상태다. 이때 쓰는 건 `always_sellable_zero_stock`(항상판매) 이 아니라 **`pre_stock_sellable`(선판매)** 이다 —
둘 다 무한판매로 가지만 "입고 전 선판매" 라는 의미가 맞고, 어드민 표시도 그렇게 나온다.

```bash
# 예: 마스트(MAST) 머신·파워서플라이·배터리. 부속류(RCA선/어댑터/부분품)는 제외.
NAME_FILTER='마스트|MAST' KIND_FILTER='머신|서플라이|배터리' EXCLUDE_FILTER='RCA|어댑터|앞 ?부분' \
  bash scripts/sellmate/run.sh live set-sellable-policy <csv> --flag pre_stock_sellable --on
# … 확인 후 --apply --out mast-variants.txt, 이어서 recalc-sellable
```

**이 예외 목록도 셀메이트에만 있는 정보라 Core 에 없다** — ②-B 와 같은 이유로 코드가 아니라 이 런북이 기억한다.
지금까지 적용한 예외:

| 브랜드/범위                       | 플래그               | 적용일     | 비고                                                                             |
| --------------------------------- | -------------------- | ---------- | -------------------------------------------------------------------------------- |
| 마스트(MAST) 머신·서플라이·배터리 | `pre_stock_sellable` | 2026-07-23 | 대상 77품목 중 **매칭된 7개만** 실제 적용 (나머지 70개는 미매칭이라 이미 판매중) |

⚠️ 그때 77품목 중 70개가 미매칭이었다. **"품절로 보인다" 는 신고를 받으면 플래그부터 의심하지 말 것** —
미매칭이면 Core 는 게이팅을 안 하므로 원인이 Medusa 쪽(`manage_inventory` 잔존 등)이다. dry-run 의
`[미매칭]` 카운트로 먼저 갈라본다.

### ②-C-1 해외 상품이면 "해외직구" 도 같이 켠다

**배송 상태가 해외직구인 상품은 어드민에서 `isOverseas`(해외직구 상품) 를 반드시 켠다.** 이걸 켜야
체크아웃에서 **개인통관고유부호 입력이 필수**가 된다 — 안 켜면 통관부호 없이 주문이 들어오고, 그 주문은
통관에서 막혀 출고가 안 된다. 판매정책 플래그(선판매/항상판매)와는 별개 설정이라 같이 챙기지 않으면 빠진다.

- 어드민 위치: 상품 상세 → **일반** 탭 (`apps/admin-web/src/features/mall/products-detail/components/general/index.tsx`)
- 여러 건은 상품 목록 → **일괄 정책 설정** (`features/mall/bulk/components/bulk-policy-modal`)
- 주문에 실린 값은 `shippingAddress.personalCustomsCode` 로 들어가고, 어드민 주문 목록·CS 조회·지역별 송장에 "통관부호" 로 노출된다
- 형식 검증: 영문 1자 + 숫자 12자 (`P123456789012`) — `web/almondyoung-storefront/src/domains/checkout/utils/customs.ts`

②-C 표의 예외 브랜드(해외 소싱)는 사실상 전부 이 대상이다. **선판매를 켰으면 `isOverseas` 도 켜져 있는지 확인할 것.**

### ⚠️ 재고가 있으면 두 플래그 다 안 먹는다

계산기(`product-sellable-quantity.calculator.ts:136`)는 `stockBoundQuantity > 0 → SELLABLE` 을
`alwaysSellableZeroStock`(`:147`)·`preStockSellable`(`:158`) **보다 먼저** 평가한다. 이름 그대로 두 플래그는
**재고 0 일 때만** 발동하는 장치다. 그러니 "이 브랜드는 무조건 안 품절되게" 를 플래그로 보장할 수 없다 —
재고가 1이라도 있으면 Medusa 재고 게이팅으로 넘어가고, 거기서 **예약(reserved)이 재고를 다 물고 있으면
`available=0` 이라 품절로 보인다.**

2026-07-23 "MAST 마스트 머신 무선 배터리"(`P0000EZZ000C`)가 정확히 이 케이스였다:
`stocked=1 / reserved=1 / available=0` + `allow_backorder=false`. Core 는 `SELLABLE 수량1` 로 정상 판정 중이었다.

게다가 이 상태는 **스스로 풀리지 않는다** — 선판매를 켜도 Medusa 로 발행되지 않는다 (이슈 #532).
`hasProductSellableQuantityProjectionChanged` 의 비교 항목에 `preStockSellable` 이 없어서, 재고 > 0 이면
`reason` 이 안 바뀌고 publish 가 스킵된다. 고쳐지기 전까지 우회는 Medusa Admin API 직접 쓰기다:

```bash
K=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaApiKey=//p')
# 인증은 Basic (curl -u "$K:"), x-medusa-access-token 헤더가 아니다
curl -s -u "$K:" -G https://medusa.almondyoung.com/admin/products \
  --data-urlencode "q=<상품명>" --data-urlencode "fields=id,title,*variants"     # id 확인
curl -s -u "$K:" -X POST https://medusa.almondyoung.com/admin/products/<prod_id>/variants/<variant_id> \
  -H 'Content-Type: application/json' -d '{"allow_backorder":true}'
```

**진단 순서** — dry-run 이 찍는 `Core판정` 이 1차 분기다.

| Core판정                   | 뜻                  | 다음                                                                                                                          |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `프로젝션없음`             | 아직 계산된 적 없음 | `recalc-sellable`                                                                                                             |
| `품절/MANUAL_OUT_OF_STOCK` | 수동품절            | `--clear-manual-oos`                                                                                                          |
| `품절/…` 그 외             | Core 가 품절로 판단 | 플래그·재고 확인                                                                                                              |
| **`판매가능/…`**           | **Core 는 정상**    | **원인은 하류** — **Ⓑ `reserved` 카운터** → inbox 지연 → Medusa `allow_backorder`/`available` → 스토어프론트 캐시 순으로 본다 |

**하류의 1번은 Ⓑ 다.** `available` 이 음수거나 `reserved` 가 살아있는 예약보다 크면 그 아래(inbox·캐시)를 볼
필요가 없다 — Ⓑ dry-run 한 방으로 갈린다 (`🧮 reserved 카운터 어긋남` 줄). 2026-07-30 노몬드 아이패치가
이 경로였다: Core 는 `판매가능`, Medusa `stocked 187 / reserved 200 / available −13`.

**하류 확인 3단**. Medusa 를 고쳐도 스토어프론트는 안 바뀐다 — 캐시를 따로 깨야 한다.

```bash
PK=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaPublishableKey=//p')
# ① Medusa store API 가 실제로 뭘 주는지 (캐시 무관 — 여기가 틀리면 스토어프론트 볼 필요 없음)
curl -s -H "x-publishable-api-key: $PK" -G https://medusa.almondyoung.com/store/products \
  --data-urlencode "handle=<handle>" --data-urlencode "fields=*variants,+variants.inventory_quantity"

# ② 재고가 예약에 물려 있는지 (available=0 이면 allow_backorder=false 일 때 품절)
K=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^MedusaApiKey=//p')
curl -s -u "$K:" https://medusa.almondyoung.com/admin/inventory-items/<iitem_id>/location-levels

# ③ 스토어프론트 캐시 무효화
S=$(cd deployments/lcnine/services && npx sst secret list --stage live | sed -n 's/^StorefrontRevalidateSecret=//p')
curl -s -X POST https://almondyoung.com/api/revalidate -H 'content-type: application/json' \
  -H "x-revalidate-secret: $S" -d '{"handle":"<handle>"}'
```

`handle` 은 스토어프론트 URL 의 UUID 다 (`/kr/products/<handle>`).

⚠️ **무효화했는데도 품절이 안 풀리면 `id` 로 조회하는 fetch 를 의심한다.**

`listProducts` 는 `queryParams.handle` 이 있을 때만 `product-{handle}` 태그를 붙인다(`toProductHandleTags`).
**`id` 로 조회하면 방문자별 태그(`products-{cache_id}`)만 남아 `/api/revalidate` 가 영영 못 깬다** — TTL(1시간)
만료까지 stale 이다. 2026-07-23 "MAST 마스트 머신 무선 배터리" 가 이 사고였다: `ProductActionsWrapper` 가
CTA 용 상품을 `id` 로 가져와서, Medusa 를 고치고 revalidate 를 5회 넘게 때려도 품절 버튼이 안 풀렸다.
(고침: handle 조회로 전환)

진단 신호 — 한 HTML 안에 같은 variant 의 `allow_backorder` 가 **true 와 false 로 동시에** 보인다:

```bash
curl -s "https://almondyoung.com/kr/products/<handle>" | grep -oE 'allow_backorder\\":(true|false)' | sort | uniq -c
```

태그 붙은 fetch 만 갱신되고 태그 없는 fetch 는 옛 값으로 남은 상태다. **CTA 를 그리는 쪽이 후자**면 화면은 품절이다.

⚠️ **`품절` 문자열 개수로 판단하지 말 것.** 렌더된 UI 가 아니라 next-intl 메시지 사전(`soldOut`, `soldOutToast` …)이
같이 실려 있어, 정상 판매중인 상품도 똑같이 8개가 잡힌다. 또 SSR HTML 의 CTA 는 항상 "옵션을 선택해주세요"
(disabled) 다 — 품절 판정은 hydration 후 클라이언트에서 일어나므로 **curl 로는 최종 화면을 알 수 없다.**
확인은 브라우저(시크릿 창)로 한다.

### 미매칭이 남는 이유

dry-run 이 찍는 `skip` 카운터로 원인이 갈린다:

| 사유                    | 뜻                                          | 대응                                              |
| ----------------------- | ------------------------------------------- | ------------------------------------------------- |
| `이미매칭`              | 정상. pending 아님                          | —                                                 |
| `옵션명_해소실패`       | 카페코드는 잡히나 옵션명이 양쪽에서 안 맞음 | 옵션명 정리 또는 admin 수동 매칭                  |
| `카페코드_medusa에없음` | 셀메이트에만 있는 상품 / Medusa 미등록      | 상품 등록 여부 확인                               |
| `sku_없음`              | 바코드가 `sku_barcodes` 에 없음             | **Ⓐ A-1 `import-products` 를 먼저 돌렸는지 확인** |

## ③ 입고예정 → Medusa — `apps/channel-adapter/scripts/sync-restock-to-medusa.ts`

매칭된 variant 의 입고예정일을 Medusa `variant.metadata` 에 직접 쓴다(restock-notice UI 가 읽음).

```bash
CORE_DB_URL=...core MEDUSA_API_URL=... MEDUSA_API_KEY=... \
  npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/sync-restock-to-medusa.ts [--apply]
```

- 기본 dry-run. `--apply` 로 Medusa 반영.
- variant 구성 sku 의 source plan 중 **가장 이른 expected_date** + 해외 발주면 `inboundApproximate=true`.
- 멱등: 이미 같은 inboundDate 면 skip. Medusa 502(일시) 나면 재실행하면 이어서 채워짐.
- **stale 제거가 기본 동작이다** — 입고완료/취소로 예정이 사라진 variant 의 `inboundDate` 를 지운다.
  그래서 handle 별 조회가 아니라 **전 상품을 페이지네이션으로 훑는다**(예정이 사라진 상품은 handle 로는 영영 안 만나므로).
  안 지우면 그 상품이 **다시 품절되는 순간 지난 날짜가 "재입고 예정"으로 노출된다** — 2026-07-22 에
  LED UV 블랙 아이패치가 7/14(과거) 날짜를 띄운 사고가 이것이었다. 스토어프론트도 `pickEarliestRestock` 에서
  지난 날짜를 후보에서 빼도록 방어를 넣었지만, 데이터를 지우는 게 근본이다.
- ⚠️ 한계: storefront 캐시는 즉시 무효화하지 않는다(TTL 후 반영). 급하면 해당 handle 을 revalidate.

## 반영이 늦을 때 — inbox 처리량과 동시성 (2026-07-22 실측)

A-3 이 이벤트를 발행해도 Medusa 에 실제로 반영하는 건 channel-adapter 의 `InboxWorkerService` 다.
여기에 큐가 밀리면 "스크립트는 다 돌았는데 스토어프론트는 그대로"인 상태가 며칠 간다.

**대기열 확인** (channel_adapter DB):

```sql
SELECT status, count(*), min(created_at) AS oldest
FROM inbox_events WHERE event_type='ProductSellableQuantityChanged' GROUP BY status;

-- 실제 처리 속도 (추정 말고 실측)
SELECT count(*) FROM inbox_events WHERE published_at >= now() - interval '5 minutes';
```

### ⚠️ 동시성을 올리면 느려진다

`INBOX_MAX_CONCURRENT_HANDLERS`(deployments/lcnine/services/infra/services.ts)를 올리고 싶어지는데,
**직관과 반대다.** live 실측:

| 설정               | 처리량(안정 상태) | Medusa CPU 평균 |
| ------------------ | ----------------- | --------------- |
| 동시성 1 / 10초    | 분당 6건          | 41%             |
| 동시성 3 / 3초     | 분당 20건         | **90~93%**      |
| **동시성 2 / 3초** | 분당 20~25건      | **30~35%**      |

**2 는 3 과 같은 속도를 CPU 3분의 1 로 낸다.** 동시 3 은 태운 CPU 가 처리량으로 돌아오지 않는다 —
Medusa 1 vCPU 를 셋이 경합하며 요청당 시간만 늘었다. 즉 처리량 상한을 정하는 건 워커 설정이 아니라
Medusa 쪽이고, Medusa 는 valkey 사이드카 탓에 `scaling max 1` 이라 스케일아웃으로 못 푼다.

> 측정 주의 두 가지.
> ① 롤아웃 직후 5분은 lease 가 한꺼번에 풀려 **분당 40건 같은 버스트**가 찍힌다 — 그 값으로 판단하지 말 것.
> 최소 15분(3회 측정) 이상 지켜본 뒤 안정값을 본다.
> ② 동시성 3 구간에는 `recalc-sellable` 이 아직 돌고 있었다. CPU 90% 에 그 효과가 일부 섞였을 수 있다.
> 다시 재려면 다른 작업이 없는 새벽에 한 번에 하나씩 바꿔 잰다. 게다가 Medusa CPU 포화는 **결제 콜백 타임아웃** 전력이
> 있는 구간이다 — 재고 반영이 늦는 건 참을 수 있어도 결제 실패는 고객이 즉시 체감한다.

더 빠르게 하려면 동시성이 아니라 Medusa 를 키우거나(valkey 분리 선행) 호출 수를 줄여야 한다.

### 이벤트가 수만 건 나오는 건 재고 동기화가 아니라 ② 매칭이다

같은 날 실측 (전체 기간 CSV 5,921행으로 Ⓐ 실행):

| 작업                                   | 결과                                                |
| -------------------------------------- | --------------------------------------------------- |
| **Ⓐ 일일 재고 동기화** (전체 기간 CSV) | 재고 조정 390건 → **이벤트 339건** (몇 분이면 소화) |
| **② 대량 SKU 매칭**                    | 20,689건 matched → **이벤트 18,176건** (시간 단위)  |

A-3 은 variant 20,748개를 전부 재계산하지만 **값이 바뀐 것만 발행**한다(변동없음 20,410건).
그래서 15년치 전체 CSV 를 받아도 일일 이벤트는 수백 건이다 — 전체 기간으로 받는 편이 오히려 안전하다.

**그러므로 ②(대량 매칭)·정책 일괄 변경은 새벽에 돌린다.** 주문이 없는 시간대면 Medusa CPU 를
끝까지 써도 결제에 영향이 없다. 낮에 돌리면 큐가 하루 이상 밀린 채로 영업시간을 지난다.

**언제가 새벽인가 — 최근 30일 주문 실측: 04~07시 (05시는 30일간 1건).** 02~03시는 심야 주문이
남아 있어 04시 이후가 안전하고, 13~16시가 최악이다(주문의 30%). 자세한 분포와 CPU 포화 대응은
`docs/runbooks/medusa-cpu-saturation.md` 참조.

⚠️ **배포 직후에 대량 작업을 붙이지 말 것.** 갓 뜬 콜드 태스크가 큐를 떠안으면 스스로 회복하지
못하고 CPU 100% 에 고착한다 (2026-07-29: 50분간 지속, 재배포로만 풀림). 배포와 시간을 띄운다.

## 실행 순서 (전체 반영)

0. **Ⓐ-0 동기화 금지 목록 확인** (`scripts/sellmate/excluded.ts`) — 스크립트가 자동으로 거르지만, 새로 금지할 상품이 생겼으면 먼저 등록
1. 터널 + CSV 준비 — **한국 / 해외 두 벌**, `옵션코드`·**`미발송주문수`** 컬럼 포함해서 받을 것
   1-B. **`Ⓑ clear-reservations --apply`** ← Ⓐ 보다 먼저. 빼먹으면 재고가 이중으로 깎인다.
   dry-run 의 `🧮 reserved 카운터 어긋남` 이 0칸이 아니면 **복구 handle 목록을 apply 전에 뽑아두고**,
   apply 후 **Medusa 응답 캐시(1시간) → 스토어프론트 캐시 순서로** 깬다. 순서가 반대면 stale 이 다시
   굳어 헛수고다 (Ⓑ 섹션 "반영은 캐시 2겹" 참조)
2. `Ⓐ import-products` → `sync-stock` → `recalc-sellable` → 재고 동기화 + 이벤트 발행
3. `① import-inbound-plans --apply` → core 입고예정
4. `② match-sku-to-variant` — `--rule A --apply` → `--rule B --report` 검토 → `--limit 20 --apply` 검증(admin "매칭됨" 확인) → 전체 `--apply`
5. **`②-B` 한국상품 `always_sellable_zero_stock` 적용** ← 빼먹으면 한국상품이 품절된다
   (+ `②-C` 표에 예외 브랜드가 있으면 같이 다시 걸 것 — 신규 매칭분에는 안 걸려 있다)
6. **`Ⓐ A-3 recalc-sellable` 재실행** (`SINCE_HOURS` 넉넉히) → 신규 매칭분 품절 반영
7. `③ sync-restock-to-medusa --apply` → Medusa metadata
8. (선택) 스토어프론트 재배포 — restock-notice UI 변경이 있을 때만

**4→5→6 은 세트다.** 4 만 하고 5 를 빼면 한국상품이 품절되고, 6 을 빼면 아무것도 반영되지 않는다.

**일일 운영은 Ⓐ 만** 돌리면 된다 (주문수집과 같이). ①②③ 은 입고예정/신규매칭이 생겼을 때.

## Claude 에게 시키는 법

다음처럼 요청하면 이 런북대로 진행한다:

- "셀메이트 재고 동기화 돌려줘 `<csv>`" → **Ⓑ → Ⓐ** (clear-reservations → A-1→A-2→A-3, A-3 까지 반드시 같이). Ⓐ-0 제외 목록은 스크립트가 자동 적용
- "재고가 셀메이트랑 다른데?" → ① `sync-stock` dry-run 으로 Core 대조(변동없음이면 Core 는 정상) → ② **Ⓑ 예약 누적** 확인 → ③ 미매칭 여부
- **"○○ 는 재고 있는데 왜 품절/일시품절이야?"** → **Ⓑ dry-run 이 1번**. `🧮 reserved 카운터 어긋남` 이 0칸이 아니면
  거기서 끝이다 (Ⓐ·매칭·플래그 파볼 필요 없음). 순서: Ⓑ dry-run → 복구 handle 목록 뽑기 → `--apply` → revalidate.
  0칸이면 그때 ②-C 진단표(Core판정)로 내려간다
- "○○ 는 재고동기화 하지 마 / 품절로 둬" → **Ⓐ-0** — `excluded.ts` 에 등록(코드로 강제) + `--set-manual-oos` 로 품절 고정 + 런북 표 갱신
- "셀메이트 입고예정 CSV `<경로>` core 에 반영해줘" → ①
- "셀메이트 sku 매칭 돌려줘 (소량 먼저)" → ②
- "셀메이트 매칭 리포트 뽑아줘 `<csv>`" → ② dry-run + `--report`, 쓰기 없음
- "품절 처리 안 되는 상품 매칭 붙여줘 `<csv>`" → ② `--rule A --apply` → `--rule B` 리포트 검토 → apply → **Ⓐ A-3 recalc-sellable 까지**
- "입고예정 Medusa 에 동기화해줘" → ③
- "○○ 브랜드는 해외라 품절되면 안 돼, 선판매로 바꿔줘" → **②-C** (`set-sellable-policy --flag pre_stock_sellable --on`) → **Ⓐ A-3 recalc-sellable 까지**. 적용한 예외는 ②-C 표에 한 줄 추가할 것
- "셀메이트 재고 파이프라인 전체 돌려줘 `<csv>`" → Ⓐ①②③ 순서대로 (각 단계 dry-run→검증→apply)

요청 시 CSV 경로만 주면 된다. live 운영 쓰기는 매번 dry-run 으로 먼저 검증하고 확인받은 뒤 `--apply` 한다.
