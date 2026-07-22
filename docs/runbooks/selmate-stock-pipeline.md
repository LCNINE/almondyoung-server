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

**카페코드가 뭔지** — 셀메이트가 관리하는 코드가 아니라 **두 시스템이 같은 조상(cafe24)을 가졌다는 흔적**이다. Medusa 상품은 cafe24 에서 이관돼 `variant.barcode` 에 그 코드가 남았고, 셀메이트는 `상품코드(카페)` 컬럼에 참조용으로 들고 있다. 그래서 **cafe24 이후 셀메이트에만 추가된 상품은 이 값이 비어 있는 게 정상**이다 (2026-07-21 기준 4,002행). 이런 건 카페코드로는 영영 못 붙으므로 `옵션코드`(규칙 C)나 수동 매칭이 필요하다.

카페코드는 **상품** 단위라, 옵션이 여러 개인 상품은 카페코드 하나에 variant 가 여러 개 걸린다. 이때는 **옵션명**으로 한 번 더 가른다 (②의 규칙 B).

## 사전 준비 (공통)

- **live RDS 터널**: `cd deployments/lcnine/services && npx sst tunnel --stage live` (sudo, 유지)
- **DB 접속**: host/secret 은 메모리 `lcnine-services live` 참조. 비번은 Secrets Manager `lcnine-services-live-DbProxySecret-bazfzmnx` 에서 런타임 조회 (파일에 박지 말 것).
- **Medusa Admin**: `MEDUSA_API_URL=https://medusa.almondyoung-next.com`, `MEDUSA_API_KEY` = `cd deployments/lcnine/services && npx sst secret list --stage live | grep MedusaApiKey`
- **CSV**: 셀메이트에서 컬럼 **상품코드(카페) / 바코드번호(서식) / 상품명 / 옵션명 / 입고예정일 / 입고예정수량** 포함해 다운로드.
  - CSV 로 받으면 셀메이트가 코드·바코드를 `="P0000EXQ"` 로 감싸서 내보낸다(엑셀이 숫자로 바꾸는 걸 막는 장치).
    `scripts/sellmate/parse.ts` 의 `unarmor()` 가 벗겨내므로 그대로 넣으면 된다. 2026-07-22 이전에는 이걸
    안 벗겨서 `sku_barcodes` 절반과 `sku_groups` 2,319건에 `="..."` 가 그대로 저장됐고, 상품코드가 빈 행은
    전부 `=""` 라는 **한 그룹**으로 뭉쳤다(서로 다른 상품 70개 SKU). 그 잔재는 아직 DB 에 남아 있다.
  - 셀메이트가 **마이너스 재고**(`-1`)를 내보내는 행이 있다. `sync-stock` 은 0 으로 추정하지 않고 중단한다 —
    셀메이트에서 실재고를 정정하는 게 원칙이고, 급하면 그 셀만 0 으로 고친 사본으로 돌린다.
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

| 규칙 | 조건 | 비고 |
|------|------|------|
| **C** | 셀메이트 `옵션코드` == Medusa `variant.title` (`ON01043` 형식) | **가장 정확. 이름을 안 본다** |
| **A** | 카페코드 하나에 셀메이트 옵션 1개 **&** Medusa variant 1개 | 옵션 모호성 0 |
| **B** | 카페코드에 여러 개가 걸릴 때, **옵션명이 양쪽에서 각각 유일하게** 하나씩 대응 | 옵션 상품 대부분이 여기 |

**규칙 C (옵션코드)** — CSV 다운로드 시 `옵션코드` 컬럼을 포함시켜야 쓸 수 있다 (셀메이트 엑셀 양식 설정에서 추가). 2026-07-21 기준 카페코드 교차검증에서 **불일치 0건**. 다만 Medusa 27,068 variant 중 `ON*` title 을 가진 건 **501개뿐**이라 만능 키가 아니라 래쉬 계열 전용 다리다. 있으면 최우선으로 쓰고, 없으면 A/B 로 내려간다.

- B 에서 비교하는 Medusa 옵션명은 `variant.title`(=`ON00804` 같은 내부코드) 이 **아니라** `product_option_value` 조합(예 `J / 0.10 / 7mm`) 이다. 셀메이트 `옵션명` 과 대조된다.
- 셀메이트 `단일상품`/`단일옵션`/`없음` ↔ Medusa **`기본 옵션값`**. (`variant.title` 은 `기본 품목` 이지만 B 가 비교하는 `option_value` 는 `기본 옵션값` 이다 — 헷갈리기 쉽다.)

**B 의 옵션명 정규화 — 여기까지만 한다:**

| 정규화 | 예 | 근거 |
|--------|-----|------|
| 구분자 `,` `/` 공백 | `골드,소형` ↔ `골드 / 소형` | 같은 값을 다르게 이었을 뿐 |
| 토큰 순서 무시 | `0.20,13mm` ↔ `13mm / 0.20` | 〃 |
| 한자·깨진문자(`?`) 제거 | `핑크 粉色` ↔ `핑크` | 셀메이트가 중국 공급처 원문을 병기. CP949 로 내보내며 `?` 로 깨진다 (셀메이트에 UTF-8 내보내기 옵션은 없다) |
| **`컬` 접미 제거** | `J,0.15,9mm` ↔ `J컬 / 9mm / 0.15` | 래쉬 도메인에서 `J` = `J컬` (같은 컬 종류) |

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

# 2) 매칭된 variant 중 한국 CSV 에 있는 것만 골라 플래그 ON
#    kr-variant-ids.txt = 한국 CSV 의 옵션정보일련번호 → skus.code 조인으로 얻은 variant_id 목록
psql "$CORE_DB_URL" <<'SQL'
CREATE TEMP TABLE kr(variant_id uuid);
\copy kr FROM 'kr-variant-ids.txt'
BEGIN;
UPDATE product_matchings SET always_sellable_zero_stock=true, updated_at=now()
 WHERE variant_id IN (SELECT variant_id FROM kr) AND status='matched' AND NOT always_sellable_zero_stock;
UPDATE sales_variant_policies SET always_sellable_zero_stock=true, updated_at=now()
 WHERE variant_id IN (SELECT variant_id FROM kr) AND NOT always_sellable_zero_stock;
COMMIT;
SQL
```

계산기 순서상 `always_sellable_zero_stock` 이 `pre_stock_sellable` 보다 **먼저** 평가된다. 둘 다 무한판매로 가지만 의미가 다르다 — **"항상 판매"는 `always_sellable_zero_stock`, "입고 전 선판매"는 `pre_stock_sellable`.** 한국상품 정책은 전자다. 매칭이 켜는 값(`pre_stock_sellable=false`)과 충돌하지 않는다.

미매칭(`pending`) 상품은 `MATCHING_PENDING` 이라 어차피 비-게이팅이므로 플래그가 없어도 팔린다. **문제는 새로 매칭되는 순간**이다 — 그래서 매칭할 때마다 이 절차를 같이 돌린다.

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

| 설정 | 처리량 | Medusa CPU 평균 |
|------|--------|-----------------|
| 동시성 1 / 10초 | 분당 6건 | 47~72% |
| 동시성 3 / 3초 | 분당 20건 | **90~93%** (포화) |
| **동시성 2 / 3초** | **분당 40건** | **32%** |

처리량 상한을 정하는 건 워커 설정이 아니라 **Medusa 의 1 vCPU** 다. 동시 3 이면 요청들이 서로 CPU 를
뺏어 요청당 시간이 늘고 총량이 오히려 줄었다(혼잡 붕괴). Medusa 는 valkey 사이드카 탓에
`scaling max 1` 이라 스케일아웃으로 못 푼다. 게다가 Medusa CPU 포화는 **결제 콜백 타임아웃** 전력이
있는 구간이다 — 재고 반영이 늦는 건 참을 수 있어도 결제 실패는 고객이 즉시 체감한다.

더 빠르게 하려면 동시성이 아니라 Medusa 를 키우거나(valkey 분리 선행) 호출 수를 줄여야 한다.

### 이벤트가 수만 건 나오는 건 재고 동기화가 아니라 ② 매칭이다

같은 날 실측 (전체 기간 CSV 5,921행으로 Ⓐ 실행):

| 작업 | 결과 |
|------|------|
| **Ⓐ 일일 재고 동기화** (전체 기간 CSV) | 재고 조정 390건 → **이벤트 339건** (몇 분이면 소화) |
| **② 대량 SKU 매칭** | 20,689건 matched → **이벤트 18,176건** (시간 단위) |

A-3 은 variant 20,748개를 전부 재계산하지만 **값이 바뀐 것만 발행**한다(변동없음 20,410건).
그래서 15년치 전체 CSV 를 받아도 일일 이벤트는 수백 건이다 — 전체 기간으로 받는 편이 오히려 안전하다.

**그러므로 ②(대량 매칭)·정책 일괄 변경은 새벽에 돌린다.** 주문이 없는 시간대면 Medusa CPU 를
끝까지 써도 결제에 영향이 없다. 낮에 돌리면 큐가 하루 이상 밀린 채로 영업시간을 지난다.

## 실행 순서 (전체 반영)

1. 터널 + CSV 준비 — **한국 / 해외 두 벌**, `옵션코드` 컬럼 포함해서 받을 것
2. `Ⓐ import-products` → `sync-stock` → `recalc-sellable` → 재고 동기화 + 이벤트 발행
3. `① import-inbound-plans --apply`  → core 입고예정
4. `② match-sku-to-variant` — `--rule A --apply` → `--rule B --report` 검토 → `--limit 20 --apply` 검증(admin "매칭됨" 확인) → 전체 `--apply`
5. **`②-B` 한국상품 `always_sellable_zero_stock` 적용** ← 빼먹으면 한국상품이 품절된다
6. **`Ⓐ A-3 recalc-sellable` 재실행** (`SINCE_HOURS` 넉넉히) → 신규 매칭분 품절 반영
7. `③ sync-restock-to-medusa --apply` → Medusa metadata
8. (선택) 스토어프론트 재배포 — restock-notice UI 변경이 있을 때만

**4→5→6 은 세트다.** 4 만 하고 5 를 빼면 한국상품이 품절되고, 6 을 빼면 아무것도 반영되지 않는다.

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
