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

셀메이트 sku 를 Medusa 판매 variant 에 "SKU 구성 매칭"(admin 의 그것과 동일하게 3테이블) 으로 연결. 단일옵션 상품만 (옵션 모호성 0).

```bash
CORE_DB_URL=...core MEDUSA_DB_URL=...medusa \
  npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/match-sku-to-variant.ts <csv> [--limit N] [--apply]
```

- 기본 dry-run. `--limit N` 으로 소량 검증 후 전체 `--apply`.
- 변경 테이블: `product_matchings`(strategy='variant', status='matched'), `product_variant_sku_links`(insert), `sales_variant_policies`(선판매 정책 upsert).
- ⚠️ **후속 recalc(sellable)·Kafka 발행은 안 한다** — 매칭의 Medusa 재고 반영(품절/선판매)은 별도. 입고예정 표시(③)는 links 만으로 동작.
- 멱등: 이미 matched 는 pending 조회에서 자동 제외. 대량은 300건씩 배치 커밋(timeout 회피).
- **분석 전용**: `match-dryrun.ts` 는 매칭 가능 규모만 측정(쓰기 없음). 매칭률/미매칭 원인 확인용.

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
4. `② match-sku-to-variant --limit 3 --apply` → 검증(admin "매칭됨" 확인) → `--apply` 전체
5. `③ sync-restock-to-medusa --apply` → Medusa metadata
6. (선택) 스토어프론트 재배포 — restock-notice UI 변경이 있을 때만

**일일 운영은 Ⓐ 만** 돌리면 된다 (주문수집과 같이). ①②③ 은 입고예정/신규매칭이 생겼을 때.

## Claude 에게 시키는 법

다음처럼 요청하면 이 런북대로 진행한다:

- "셀메이트 재고 동기화 돌려줘 `<csv>`" → Ⓐ (A-1→A-2→A-3, A-3 까지 반드시 같이)
- "셀메이트 입고예정 CSV `<경로>` core 에 반영해줘" → ①
- "셀메이트 sku 매칭 돌려줘 (소량 먼저)" → ②
- "입고예정 Medusa 에 동기화해줘" → ③
- "셀메이트 재고 파이프라인 전체 돌려줘 `<csv>`" → Ⓐ①②③ 순서대로 (각 단계 dry-run→검증→apply)

요청 시 CSV 경로만 주면 된다. live 운영 쓰기는 매번 dry-run 으로 먼저 검증하고 확인받은 뒤 `--apply` 한다.
