# 셀메이트 재고 → 스토어프론트 입고예정/매칭 파이프라인

셀메이트(창고관리)에서 받은 재고 CSV 를 Core/Medusa 에 반영해 **스토어프론트에서 입고예정일을 표시**하기까지의 일회성 스크립트 모음과 실행 순서.

> 이 문서는 "나중에 다시 돌릴 때 / Claude 에게 시킬 때" 를 위한 런북이다. 각 스크립트는 멱등(중복 실행 안전)하게 작성돼 있다.

## 전체 그림

```
셀메이트 재고 CSV (EUC-KR, "상품코드(카페)" 컬럼 포함해서 다운로드)
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
2. `① import-inbound-plans --apply`  → core 입고예정
3. `② match-sku-to-variant --limit 3 --apply` → 검증(admin "매칭됨" 확인) → `--apply` 전체
4. `③ sync-restock-to-medusa --apply` → Medusa metadata
5. (선택) 스토어프론트 재배포 — restock-notice UI 변경이 있을 때만

## Claude 에게 시키는 법

다음처럼 요청하면 이 런북대로 진행한다:

- "셀메이트 입고예정 CSV `<경로>` core 에 반영해줘" → ①
- "셀메이트 sku 매칭 돌려줘 (소량 먼저)" → ②
- "입고예정 Medusa 에 동기화해줘" → ③
- "셀메이트 재고 파이프라인 전체 돌려줘 `<csv>`" → ①②③ 순서대로 (각 단계 dry-run→검증→apply)

요청 시 CSV 경로만 주면 된다. live 운영 쓰기는 매번 dry-run 으로 먼저 검증하고 확인받은 뒤 `--apply` 한다.
