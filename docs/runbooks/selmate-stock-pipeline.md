# 셀메이트 → Core/Medusa 재고 동기화 · 입고예정 파이프라인

셀메이트(창고관리)에서 받은 재고 CSV 를 Core/Medusa 에 반영하는 스크립트 모음과 실행 순서. 두 갈래다:

- **Ⓐ 재고 동기화 (일일)** — 재고량을 WMS 로 강제 동기화하고 변동분 이벤트를 재발행해 **품절 처리**가 돌게 한다.
- **①②③ 입고예정 (수시)** — **스토어프론트에 입고예정일을 표시**한다.

> 이 문서는 "나중에 다시 돌릴 때 / Claude 에게 시킬 때" 를 위한 런북이다. 각 스크립트는 멱등(중복 실행 안전)하게 작성돼 있다.

## 전체 그림

```
셀메이트 재고 CSV (EUC-KR, "상품코드(카페)" 컬럼 포함해서 다운로드)
   │
   │ Ⓐ import-products → sync-stock → recalc-sellable   (재고 동기화 + 이벤트 발행)
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

카페코드는 **상품** 단위라, 옵션이 여러 개인 상품은 카페코드 하나에 variant 가 여러 개 걸린다. 이때는 **옵션명**으로 한 번 더 가른다 (②의 규칙 B).

## 사전 준비 (공통)

- **live RDS 터널**: `cd deployments/lcnine/services && npx sst tunnel --stage live` (sudo, 유지)
- **DB 접속**: host/secret 은 메모리 `lcnine-services live` 참조. 비번은 Secrets Manager `lcnine-services-live-DbProxySecret-bazfzmnx` 에서 런타임 조회 (파일에 박지 말 것).
- **Medusa Admin**: `MEDUSA_API_URL=https://medusa.almondyoung-next.com`, `MEDUSA_API_KEY` = `cd deployments/lcnine/services && npx sst secret list --stage live | grep MedusaApiKey`
- **CSV**: 셀메이트에서 컬럼 **상품코드(카페) / 바코드번호(서식) / 상품명 / 옵션명 / 입고예정일 / 입고예정수량** 포함해 다운로드.
- **러너 사용 권장**: 아래 ①②③ 은 `CORE_DB_URL` 을 손으로 만드는 예시지만, 실제로는 러너가 RDS 엔드포인트·시크릿을 런타임 조회해 주입한다. 비번이 transcript 에 안 남는다.
  - `scripts/sellmate/run.sh <stage> <import-products|sync-stock|recalc-sellable|check> <경로>`
  - `scripts/sellmate/inbound-run.sh <stage> <import-inbound|match-sku|sync-restock> [args]`

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

| 규칙 | 조건 | 비고 |
|------|------|------|
| **A** | 카페코드 하나에 셀메이트 옵션 1개 **&** Medusa variant 1개 | 옵션 모호성 0 |
| **B** | 카페코드에 여러 개가 걸릴 때, **옵션명이 양쪽에서 각각 유일하게** 하나씩 대응 | 옵션 상품 대부분이 여기 |

- B 에서 비교하는 Medusa 옵션명은 `variant.title`(=`ON00804` 같은 내부코드) 이 **아니라** `product_option_value` 조합(예 `J / 0.10 / 7mm`) 이다. 셀메이트 `옵션명` 과 대조된다.
- 셀메이트 `단일상품`/`단일옵션`/`없음` ↔ Medusa `기본 품목` 으로 정규화. 그 외 정규화는 공백·대소문자만 — 더 느슨하게 풀면 오매칭이 곧 품절이다.
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

### 미매칭이 남는 이유

dry-run 이 찍는 `skip` 카운터로 원인이 갈린다:

| 사유 | 뜻 | 대응 |
|------|-----|------|
| `이미매칭` | 정상. pending 아님 | — |
| `옵션명_해소실패` | 카페코드는 잡히나 옵션명이 양쪽에서 안 맞음 | 옵션명 정리 또는 admin 수동 매칭 |
| `카페코드_medusa에없음` | 셀메이트에만 있는 상품 / Medusa 미등록 | 상품 등록 여부 확인 |
| `sku_없음` | 바코드가 `sku_barcodes` 에 없음 | **Ⓐ A-1 `import-products` 를 먼저 돌렸는지 확인** |

## ③ 입고예정 → Medusa — `apps/channel-adapter/scripts/sync-restock-to-medusa.ts`

매칭된 variant 의 입고예정일을 Medusa `variant.metadata` 에 직접 쓴다(restock-notice UI 가 읽음).

```bash
CORE_DB_URL=...core MEDUSA_API_URL=... MEDUSA_API_KEY=... \
  npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/sync-restock-to-medusa.ts [--apply]
```

- 기본 dry-run. `--apply` 로 Medusa 반영.
- variant 구성 sku 의 source plan 중 **가장 이른 expected_date** + 해외 발주면 `inboundApproximate=true`.
- 멱등: 이미 같은 inboundDate 면 skip. Medusa 502(일시) 나면 재실행하면 이어서 채워짐.
- ⚠️ 한계: 입고완료/취소로 예정이 사라진 variant 의 stale inboundDate 는 안 지움. storefront 캐시는 TTL 후 반영.

## 실행 순서 (전체 반영)

1. 터널 + CSV 준비
2. `Ⓐ import-products` → `sync-stock` → `recalc-sellable` → 재고 동기화 + 이벤트 발행
3. `① import-inbound-plans --apply`  → core 입고예정
4. `② match-sku-to-variant` — `--rule A --apply` → `--rule B --report` 검토 → `--limit 20 --apply` 검증(admin "매칭됨" 확인) → 전체 `--apply`
5. **매칭이 붙었으면 `Ⓐ A-3 recalc-sellable` 재실행** (`SINCE_HOURS` 넉넉히) → 신규 매칭분 품절 반영
6. `③ sync-restock-to-medusa --apply` → Medusa metadata
7. (선택) 스토어프론트 재배포 — restock-notice UI 변경이 있을 때만

**일일 운영은 Ⓐ 만** 돌리면 된다 (주문수집과 같이). ①②③ 은 입고예정/신규매칭이 생겼을 때.

## Claude 에게 시키는 법

다음처럼 요청하면 이 런북대로 진행한다:

- "셀메이트 재고 동기화 돌려줘 `<csv>`" → Ⓐ (A-1→A-2→A-3, A-3 까지 반드시 같이)
- "셀메이트 입고예정 CSV `<경로>` core 에 반영해줘" → ①
- "셀메이트 sku 매칭 돌려줘 (소량 먼저)" → ②
- "셀메이트 매칭 리포트 뽑아줘 `<csv>`" → ② dry-run + `--report`, 쓰기 없음
- "품절 처리 안 되는 상품 매칭 붙여줘 `<csv>`" → ② `--rule A --apply` → `--rule B` 리포트 검토 → apply → **Ⓐ A-3 recalc-sellable 까지**
- "입고예정 Medusa 에 동기화해줘" → ③
- "셀메이트 재고 파이프라인 전체 돌려줘 `<csv>`" → Ⓐ①②③ 순서대로 (각 단계 dry-run→검증→apply)

요청 시 CSV 경로만 주면 된다. live 운영 쓰기는 매번 dry-run 으로 먼저 검증하고 확인받은 뒤 `--apply` 한다.
