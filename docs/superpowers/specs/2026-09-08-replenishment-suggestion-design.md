# 재고 보충 제안 재설계 — 수요 패턴 기반 안전재고와 발주 · 이동 두 축 (#743)

> 상태의 정본은 **이슈 #743** 이다. 이 문서는 **설계**만 소유한다. 실행 계획은
> `docs/superpowers/plans/` 로 단계별로 따로 나간다.
>
> 변경 이력: 2026-09-08 초안 → 같은 날 **C 단계 실물(PR #804, 머지)에 맞춰 갱신** — §7.2 409 ·
> §7.3 목록 봉투(`limit`/`total`) · §7.4 삭제 라우트명 · §7.6 C 가 남긴 TODO 3곳 · §8.2 Reader
> 오케스트레이션 · §9 를 A / B 두 단계로 분리.
>
> 선행 결정: [ADR-0032](../../adr/0032-procurement-inbound-transfer-boundaries.md) (조달·입고·이동의 경계) ·
> [ADR-0011](../../adr/0011-shared-sellable-quantity-across-sales-channels.md) (판매채널은 같은 수량을 공유한다) ·
> 진단 문서 발견 ⑥ [`docs/inventory-procurement-audit-2026-08.md`](../../inventory-procurement-audit-2026-08.md)

## 1. 무엇이 문제인가

재주문 제안 `GET /purchase-orders/suggestions/reorder` (`procurement/services/reorder-suggestion.reader.ts`)
가 리터럴 상수로 판정한다. 안전재고 **10**, 제안수량 **20 − 현재고**, 창고별 판정, `on_order_qty` 는 뷰가
`0` 으로 박아둔 값. 별도로 `skus.safety_stock` + `core/services/safety-stock.service.ts`
(`GET /inventory/safety-stock-warnings` · `GET /inventory/safety-stock-status/:skuId`) 가 같은 질문에 다른
답을 낸다. 이슈 #743 이 이 넷을 이미 적었다.

이 설계는 #743 의 범위(파이프라인 배선 · 안전재고 단일화 · 전사 축 · 이동 제안)에 한 층을 더 얹는다:
**안전재고를 사람이 넣는 상수가 아니라 수요 데이터에서 계산한다.** 레거시(셀메이트) 주문 통계를 분석한
결과 우리 품목의 수요 패턴이 ADI–CV² 분류상 Erratic · Lumpy 가 많다는 것이 확인됐고, 네 패턴에 같은
공식을 쓰면 안전재고가 체계적으로 틀린다.

### 1.1 설계를 바꾼 사실 (2026-09-08 실측)

| 사실 | 근거 | 결과 |
|---|---|---|
| 리드타임 컬럼이 시스템 어디에도 없다 | `suppliers` · `skus` · `purchase_orders*` 에 `lead_time` 0건 | 초기값은 사람이 넣는 규칙이어야 한다 |
| 리드타임 관측치가 0건에서 시작한다 | 발주 기능이 라이브에서 아직 안 쓰인다(#724) | 관측이 쌓이면 규칙 기본값을 대체하는 구조 |
| SKU 단위 수요 이력이 core 에 얇다 | `stock_events` SHIP 0건(원장 쓰기 미실행). 판매주문은 variant 단위. 주문 34%(660건)가 `awaiting_matching`. core 이력은 2026-07 이후 | 셀메이트 이력을 시드로 넣고, variant→SKU 환산은 현재 링크로 소급 |
| 제안 기능을 `procurement/` 에 둘 수 없다 | 이동 제안은 `warehouse-transfer` 를 알아야 하는데 ADR-0032 가 `procurement → warehouse-transfer` import 를 금지 | 형제 모듈 `inventory/replenishment/` 신설 |
| 판매 창고는 부천 하나, 중국은 `is_sellable=false` 경유지 | `warehouses` 4행 실측 | ①②③ 파이프라인은 `InboundPipelineReader` 가 이미 계산 |
| 라이브 확정 예약의 94% 가 허수 | 09-01 실측, 5,496개 | 🔴 **선행조건.** 청소 전엔 발주 제안이 과대. 이 설계의 대상이 아니다 |

## 2. 결정 요약

| # | 결정 | 기각한 대안 |
|---|---|---|
| D1 | 수요 이력 = **셀메이트 시드 + core 판매주문** 을 한 시계열 테이블에 | core 만(이력 7월 이후뿐, Lumpy 분류 불가) · analytics `fact_order_items`(다른 DB, skuId 도 core 매칭에서 옴) |
| D2 | 리드타임을 **두 구간**으로 — L1 공급사→출발 창고(공급사 축), L2 출발→판매 창고(창고 쌍 축) | 중국 입고까지만(부천 위험 과소) · 부천까지 한 덩어리(사람이 정하는 체류가 σ 를 부풀림) |
| D3 | **연속검토 (s, S)**. 매일 발주하므로 검토 주기 R 은 두지 않는다. 목표 커버 일수는 발주량 결정용이지 보호 구간이 아니다 | (s, Q) 고정량 · (R, S) 주기검토 |
| D4 | α 는 **등급(ABC)별 기본값 + SKU 오버라이드** | 전역 하나 · SKU 별 입력(5,800개를 사람이 못 채움) |
| D5 | **통계는 야간 물질화, 제안은 요청 시점 계산.** 프로필에 안전재고·재주문점을 저장하지 않는다 | 전부 요청 시점(5,800×365 스캔, 분류 흔들림) · 제안까지 물질화(낮 동안 낡음, 워크플로 표면) |
| D6 | 규칙은 `replenishment` 소유 테이블에. `suppliers` · `skus` · `warehouses` 에 컬럼을 얹지 않는다 | 마스터 테이블에 컬럼 추가(소유권 침범) |
| D7 | 분포는 Smooth = 정규, 나머지 셋 = 감마(모멘트 일치). 분산 공식은 넷이 같고 σ_D 의 창만 다르다 | 부트스트랩(무작위·느려서 요청 시점 계산 불가) · 넷 다 정규(Erratic/Lumpy 꼬리 과소) |
| D8 | admin-web 은 **최소**(제안 목록 교체 · 규칙 페이지 · 프로필 드로어) 로 같은 범위 | API 만(검증 불가) · 차트 대시보드(규칙이 자리 잡은 뒤) |
| D9 | 옛 답 셋을 **삭제** — `ReorderSuggestionReader` · `SafetyStockService` · `skus.safety_stock` 읽기 | 병존(같은 질문에 답이 셋) |

## 3. 용어

| 용어 | 뜻 |
|---|---|
| 수요 (demand) | 그날 고객이 **주문한** 수량. 출고가 아니다. 취소 라인 제외, 반품은 빼지 않는다 |
| ADI | 평균 수요 발생 간격(일). 분류 창 일수 ÷ 수요 발생일 수 |
| CV² | 수요 발생일 수량의 (σ/μ)² |
| 패턴 | ADI 1.32 · CV² 0.49 경계의 사분면. `smooth` · `intermittent` · `erratic` · `lumpy`. 그 밖에 `insufficient`(이력 부족) · `none`(창 안 수요 0) |
| 등급 | 분류 창 매출 누적 80% 까지 A, 95% 까지 B, 나머지 C |
| α | 목표 예측 실패율. P(리드타임 내 수요 > 재주문점) |
| L1 / L2 | 공급사 → 출발 창고 입고 / 출발 창고 → 판매 창고 도착. 국내 발주(출발 = 판매 창고)는 L2 = 0 |
| LTD | 리드타임 내 수요. μ_LTD · σ_LTD 로 요약 |
| SS · ROP · S | 안전재고 · 재주문점 · 목표 수준(order-up-to) |
| IP | 재고 위치. 축마다 정의가 다르다(§7) |
| 전사 축 / 판매 창고 축 | 발주 판정 / 이동 판정의 관점 |

레거시 공식 `(90일 판매량 / 90) × 리드타임` 은 이 용어로 **μ_LTD** 다. 안전재고가 아니라 재주문점의
기대수요 부분이고, 안전재고 0 인 재주문점이었다. 열람 화면이 이 값을 "레거시 방식" 으로 나란히 낸다.

## 4. 수요 시계열과 프로필 (A)

### 4.1 `sku_demand_daily`

grain = SKU × 날짜(KST 달력일). `qty ≥ 0` check. `amount`(원) 는 등급 산정용이며 null 허용.
`source` enum `sellmate` | `core`.

**core 적재 규칙.** `sales_order_lines` 를 주문일(`sales_orders.order_date`) 로 묶는다. 날짜 경계는
SQL 에서 `(order_date AT TIME ZONE 'Asia/Seoul')::date` 로 고정한다 — 런타임 TZ(jest · ECS 는 UTC)에
기대지 않는다. 물리 라인만(`fulfillment_kind` 가 `digital` 이 아닌 것). 주문 `status` 가 `cancelled` · `timeout`
이면 주문 전체를, 라인 `status` 가 `cancelled` 이면 그 라인을 제외한다. `pending`(결제 대기)은 **포함**한다 —
수요는 수요이고, 나중에 취소되면 14일 창 재계산이 걷어낸다.
variant → SKU 는 **현재의 `product_variant_sku_links`** 로 환산한다: SKU qty = 라인 qty × 링크 `quantity`.
확정 시점 스냅샷이 아니라 현재 링크를 쓰는 이유는 주문 당시 매칭이 없던 라인이 나중에 매칭되면
소급해서 잡히게 하기 위해서다. 매칭이 아직 없는 variant 의 수요는 이 테이블에 없다 — 매칭될 때까지
보이지 않으며, 그 SKU 는 `insufficient` 로 흘러 제안에 플래그가 붙는다.
`amount` = 라인 `total_price` 를 링크 수량 비례로 SKU 에 배분.

**야간 배치는 최근 14일 창을 매일 다시 계산해 upsert 한다.** 늦은 취소 · 늦은 매칭이 여기서 반영되고,
두 번 돌아도 결과가 같다. 14일은 규칙(`demand_recompute_days`) 값이다. 전량 재계산은
`POST /replenishment/profiles/recompute?series=full` 로 사람이 부른다.

**시드 규칙.** 셀메이트 행은 `demand_core_since`(D0) **이전** 날짜만, core 는 D0 **이후**만 쓴다.
겹치는 날이 없으므로 이중 계상이 없다. D0 는 `replenishment_settings` 에 저장하고 시드 스크립트가 설정한다.

### 4.2 셀메이트 시드 스크립트

`scripts/sellmate/import-demand-history.ts` — 기존 셀메이트 스크립트 옆에 둔다.

- 입력: 셀메이트 주문/판매 export(EUC-KR, 기존 스크립트와 같은 HTML-xls 판독기 재사용).
  필요한 열: 품목 식별(**옵션정보일련번호** = `skus.code`, 기존 규칙 그대로) · 주문일 · 수량 · 금액.
  열 이름 별칭은 `import-products.ts` 의 `COLUMN_CANDIDATES` + env 오버라이드 방식으로 두고 `COL_*` 로 덮어쓸 수 있게 한다.
- 매칭: `skus.code = 옵션정보일련번호`. 미매칭 행은 **중단하지 않고** 리포트 파일
  (`apps/core/tmp/demand-unmatched-<ts>.csv`) 로 남긴다. 조용히 사라지지 않게 하는 것이 목적이다 —
  미매칭 SKU 는 `insufficient` 로 제안에 플래그가 붙는다.
- 멱등: (sku_id, demand_date) upsert. 같은 파일 재실행 시 결과가 같다.
- 종료 시 D0 를 설정한다: 인자 `--core-since YYYY-MM-DD` 가 있으면 그 값, 없으면 core
  `sales_orders` 의 최소 `order_date`. 이미 설정돼 있고 값이 다르면 경고하고 **덮어쓰지 않는다**.
- 실행 조건: live RDS 터널(런북 `docs/runbooks/selmate-stock-pipeline.md` 의 사전 준비와 동일).

### 4.3 `sku_demand_profiles`

SKU 당 한 행. 야간 전량 재계산(upsert). **통계 사실만** 저장한다. 안전재고 · 재주문점은 규칙에 의존하므로
저장하지 않고 읽는 시점에 계산한다(D5).

| 열 | 타입 | 뜻 |
|---|---|---|
| `sku_id` | uuid PK | |
| `pattern` | enum | `smooth` · `intermittent` · `erratic` · `lumpy` · `insufficient` · `none` |
| `grade` | enum | `A` · `B` · `C` |
| `adi`, `cv2` | double precision | 분류 창 기준. 수요 발생일 0 이면 null |
| `daily_mean`, `daily_std` | double precision | 파라미터 창 기준, 0인 날 포함 |
| `daily_mean_90` | double precision | 항상 `param_window_days_frequent`(90) 창의 일평균. 레거시 재주문점(μ_D(90)·μ_L) 전용 — 파라미터 창이 365 인 패턴에서도 레거시 값을 같은 정의로 내기 위해 따로 둔다 |
| `size_mean`, `size_std`, `interval_mean` | double precision | 발생일 수량 · 간격 통계. 분류와 열람용. 발생일이 2개 미만이면 `size_std` · `interval_mean` 은 null |
| `history_days` | int | 분류 창 안에 시계열이 존재하는 일수 |
| `demand_events` | int | 분류 창 안 수요 발생일 수 |
| `classification_from/to`, `param_from/to` | date | 실제 쓴 창 |
| `computed_at` | timestamptz | |

**계산 규칙.**

- 분류 창 = 오늘 − `classification_window_days`(기본 365) ~ 어제. 시계열이 없는 날은 0 으로 본다.
  단 시계열의 최초 날짜보다 앞선 날은 **창에서 제외**한다(신상품을 "1년 내내 0" 으로 읽지 않기 위해).
  `history_days` 가 그 결과다.
- `demand_events` < `min_demand_events`(기본 3) 이면 `insufficient`. `demand_events` = 0 이면 `none`.
  `history_days` < 30 이어도 `insufficient`.
- ADI = `history_days` ÷ `demand_events`. CV² 는 발생일 수량의 표본분산 ÷ 평균².
  임계 `adi_threshold`(1.32) · `cv2_threshold`(0.49) 는 규칙 값.
- 파라미터 창은 패턴이 정한다: `smooth` · `erratic` → `param_window_days_frequent`(기본 90),
  `intermittent` · `lumpy` → `param_window_days_sparse`(기본 365). `insufficient` 는 90.
  `daily_mean` · `daily_std` 는 그 창의 모든 날(0 포함) 기준.
- 등급: 분류 창 `amount` 합으로 내림차순 누적, `grade_a_cut`(0.80) · `grade_b_cut`(0.95).
  `amount` 가 전부 null 인 SKU 는 매출 0 으로 보고 C.

### 4.4 리드타임 프로필

`supplier_lead_time_profiles`(supplier_id PK) · `route_lead_time_profiles`((from_wh, to_wh) PK).
열은 `observations` · `mean_days` · `std_days` · `window_from/to` · `computed_at`.

**관측 정의.**

- L1: `purchase_order_lines.ordered_at` → 그 라인이 만든 계획 아이템의 **첫** 입고
  (`inbound_receipt_lines.plan_item_id → inbound_receipts.occurred_at` 의 MIN). 라인 → 계획 아이템은
  같은 PO 의 계획(`inbound_plans.linked_purchase_order_id`) 안에서 `sku_id` 로 잇는다. 일수는
  `occurred_at − ordered_at` 을 일 단위 실수로.
- L2: `transfer_orders.shipped_at` → 그 지시서의 **첫** `transfer_order_receipts.received_at`.
- 창은 최근 `lead_time_window_days`(기본 365). 관측 n < 2 면 `std_days` 는 null.

**SKU 의 공급사와 출발 창고.** 가장 최근 `ordered` 발주 라인의 공급사, 없으면 `sku_suppliers` 가
정확히 하나일 때 그것, 아니면 **미정**(`supplier_unknown` 플래그, 전역 기본 리드타임 사용).
출발 창고는 공급사의 `default_warehouse_id`. 그 창고가 판매 창고이거나 비어 있으면 L2 = 0 이고
경로도 없다.

### 4.5 알려진 한계

- **검열.** 품절 기간의 수요는 관측되지 않아 평균이 낮게 잡힌다. v1 은 보정하지 않는다.
  보정하려면 일별 판매가능수량 이력이 필요한데 지금은 없다.
- **판매 창고가 하나인 동안만 정확하다.** 수요 프로필은 전사 단위다. 판매 창고가 둘이 되면 창고별
  수요를 갈라야 하고, 그때 #743 이 미룬 "①② 중복 표시" 와 함께 연다.

## 5. 분류별 공식 (B, 순수 함수)

### 5.1 공통 골격

```
μ_LTD  = μ_D · μ_L
σ_LTD² = μ_L · σ_D² + μ_D² · σ_L²
ROP    = Q(1 − α ; 분포, μ_LTD, σ_LTD)    ← 분포의 (1−α) 분위수
SS     = ROP − μ_LTD
S      = μ_D · (μ_L + cover_days) + SS
```

| 패턴 | 분포 | σ_D 창 | 이유 |
|---|---|---|---|
| `smooth` | 정규 | 90 | 5변수 공식 그대로. ROP = μ_LTD + z·σ_LTD |
| `erratic` | 감마 | 90 | CV 가 크면 오른쪽 꼬리가 길어 정규가 과소. 음수도 안 나온다 |
| `intermittent` | 감마 | 365 | 90일엔 발생일이 적어 σ 가 무의미 |
| `lumpy` | 감마 | 365 | 위 둘의 합 |
| `insufficient` | 정규 | 90 | 있는 데이터로 계산하되 `confidence = low` |
| `none` | — | — | SS = ROP = S = 0 |

감마는 형상 k = μ²/σ², 척도 θ = σ²/μ 로 모멘트를 맞춘다. 분위수는 정규화 불완전감마 함수 P(k, x) 를
이분법으로 역산한다. 외부 라이브러리 없이 `policy/distributions.ts` 에 둔다. 참조값은 **카이제곱 표**로 고정한다 — Γ(k, θ=2) = χ²(2k) 이고 χ²(2, p) = −2·ln(1−p) 는 닫힌 식이라 개발 머신에 scipy 가 없어도 검증된다.
CV → 0 이면 감마가 정규로 수렴하므로 분류 경계에서 값이 튀지 않는다. σ_LTD = 0 이면 ROP = μ_LTD.

### 5.2 리드타임 합성

- 전사 축: μ_L = μ_L1 + μ_L2 + `consolidation_buffer_days`, σ_L² = σ_L1² + σ_L2² (독립 가정).
  출발 창고가 판매 창고면 μ_L = μ_L1, σ_L = σ_L1.
- 판매 창고 축: μ_L = μ_L2, σ_L = σ_L2.
- 각 구간의 (μ, σ) 는 §6 우선순위로 정한다. **σ 가 비어 있으면 σ = 0.25 · μ.** 0 으로 두면
  리드타임 변동이 조용히 사라지기 때문이다. 이 값도 규칙(`default_lead_time_cv`) 이다.

### 5.3 발주량과 이동량

```
발주량 = roundUp( S_전사 − IP_전사 ; MOQ, packing_unit )
이동량 = min( 이동가능, ceil( S_판매 − IP_판매 ) )
```

`roundUp` 은 `skus.moq` 이상으로, 그리고 SKU 의 primary 바코드 `packing_unit`(상자당 낱개 수) 배수로
올린다. 둘 다 없으면 정수 올림. 이동량은 올리지 않는다 — 있는 만큼만 옮긴다.

### 5.4 입출력 계약

```ts
interface PolicyInput {
  profile: DemandProfile;                       // §4.3 행
  leadTime: { meanDays: number; stdDays: number };
  alpha: number;
  coverDays: number;
  overrideSafetyStock: number | null;            // 규칙 SKU 예외
}
interface PolicyOutput {
  safetyStock: number; reorderPoint: number; targetLevel: number;
  distribution: 'normal' | 'gamma' | 'none';
  confidence: 'normal' | 'low';
  legacyReorderPoint: number;                   // μ_D(90일) · μ_L — 열람용
}
```

`overrideSafetyStock` 이 있으면 SS 는 그 값이고 ROP = μ_LTD + SS. 분포 계산은 건너뛴다.
이 층은 DB 를 모른다.

## 6. 재고관리 규칙 (B — 단, `replenishment_settings` 표 자체는 A 가 만든다)

사람이 소유하는 입력. 전부 `replenishment` 모듈 소유 테이블(D6). 전역 설정 표는 프로필 계산이 읽어야 하므로
A 가 만들고 시드하며, 나머지 네 표와 모든 PUT 은 B 다(§8.1).

| 층 | 테이블 | 열 |
|---|---|---|
| 전역 | `replenishment_settings` (`key`='default' 단일행) | `adi_threshold` 1.32 · `cv2_threshold` 0.49 · `classification_window_days` 365 · `param_window_days_frequent` 90 · `param_window_days_sparse` 365 · `min_demand_events` 3 · `min_lead_time_observations` 5 · `lead_time_window_days` 365 · `grade_a_cut` 0.80 · `grade_b_cut` 0.95 · `demand_core_since` date null · `demand_recompute_days` 14 · `consolidation_buffer_days` 7 · `default_lead_time_days` · `default_lead_time_std_days` null · `default_transfer_lead_time_days` · `default_transfer_lead_time_std_days` null · `default_lead_time_cv` 0.25 · `default_cover_days` · `default_transfer_cover_days` · `updated_at` · `updated_by` |
| 등급 | `replenishment_grade_rules` (grade PK) | `alpha` |
| 공급사 | `replenishment_supplier_rules` (supplier_id PK) | `lead_time_days` · `lead_time_std_days` null · `cover_days` |
| 경로 | `replenishment_route_rules` ((from_wh, to_wh) PK) | `lead_time_days` · `lead_time_std_days` null · `cover_days` |
| SKU 예외 | `replenishment_sku_overrides` (sku_id PK) | `mode` enum `auto` · `excluded` · `excluded_until` date null · `safety_stock` int null · `alpha` numeric null · `memo` · `updated_at` · `updated_by` |

**우선순위.**

| 값 | 순서 |
|---|---|
| α | SKU 예외 > 등급 규칙 (등급은 모든 SKU 에 있어 빠지지 않는다) |
| L1 (μ, σ) | 관측(n ≥ `min_lead_time_observations`) > 공급사 규칙 > 전역 `default_lead_time_*` |
| L2 (μ, σ) | 관측 > 경로 규칙 > 전역 `default_transfer_lead_time_*` |
| 커버 일수 | 공급사 규칙 > 전역. 이동 커버는 경로 규칙 > 전역 |
| 안전재고 | SKU 예외 `safety_stock` 이 있으면 계산을 대체 |

`excluded` 는 제안에서 빠진다. `excluded_until` 이 오늘보다 앞이면 `auto` 로 본다. 단종 · 시즌오프
품목이 매일 목록에 뜨는 것을 막는다. 예외 행이 없으면 `auto`. SKU 예외의 `safety_stock` 은 패턴이 `none`
이어도 적용된다 — 사람이 준 숫자가 통계보다 우선이다(B 결정).

**반영 시점.** α · 리드타임 · 커버 일수 · 예외는 읽는 시점에 계산되므로 저장 즉시 반영된다.
창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는 프로필을 바꾸므로 다음 야간 배치 또는
`POST /replenishment/profiles/recompute` 로 반영된다. 규칙 화면이 항목마다 이 차이를 문구로 알린다.

**초기값.** 전역 1행과 등급 3행(A 0.02 · B 0.05 · C 0.10)은 `db:seed:ref` 참조 시드 그룹에 넣는다.
전역의 `default_lead_time_days` 등 필수값은 시드가 보수적인 값(발주 30 · 이동 14 · 커버 30/14)으로 채우고
운영자가 고친다. 공급사 · 경로 규칙은 비어 있어도 전역 기본으로 동작하되 제안에 `default_lead_time`
플래그가 붙어 채우도록 유도한다.

**`skus.safety_stock` 의 거취.** A+B 단계에서 코드가 이 컬럼을 **읽지 않는다**(column drop 1단계).
SKU 폼의 안전재고 입력 칸은 제거하고 SKU 예외 화면 링크로 대체한다. 컬럼 drop 은 배포 한 번 뒤의
별도 contract PR.

## 7. 제안 조립과 두 축 (C)

SKU 하나에 **두 판정을 독립적으로** 내린다. 둘 다 켜질 수 있고 하나만 켜질 수도 있다.

### 7.1 재료

- 원장: `stock_ledgers` 를 SKU × (판매창고 여부) × `stock_state` 로 집계. `inSellableWarehouse()` 로 가른다.
- 예약: `stock_reservations` 의 `status='confirmed'` 를 SKU × 창고로 집계.
- 파이프라인: `StockProjectionService.getInboundPipeline` 의 ①②③. 단 ① 은 비판매 창고행 계획만
  세므로(국내 발주는 의도적으로 제외돼 있다), 전사 축을 위해 **전 창고 pending 계획 아이템 합**
  (`expected_qty − received_qty`, `status='pending'`) 을 `InboundPipelineReader` 에 한 항목
  (`onOrderTotalQty`) 더 낸다. 판매 창고행 발주잔량 = `onOrderTotalQty − onOrderQty`.
- draft 이동 지시서: `transfer_order_lines.planned_qty` 를 `status='draft'` 지시서에 한해 SKU 별 합.
  `WarehouseTransferReader` 에 `findDraftPlannedBySku` 를 더한다.

### 7.2 판정

```
전사 축 (발주 판정)
  IP_전사  = ON_HAND(전 창고) + IN_TRANSFER(전 창고) + onOrderTotal − 확정예약(전 창고)
  L_전사   = §5.2 전사 합성
  IP_전사 ≤ ROP(L_전사) → 발주 제안, qty = roundUp(S_전사 − IP_전사)

판매창고 축 (이동 판정, 판매 창고마다)
  IP_판매  = ON_HAND(판매창고) − 확정예약(판매창고) + ③ 이동중(to=판매창고) + 판매창고행 발주잔량
  L_판매   = L2
  IP_판매 ≤ ROP(L_판매) →
      이동가능 = ②(비판매 ON_HAND) − draft 지시서 planned 합
      필요    = ceil(S_판매 − IP_판매)
      이동가능 > 0 → 이동 제안, qty = min(이동가능, 필요), from = 출발 창고, to = 판매 창고
```

draft 지시서 수량을 빼는 이유: 어제 제안을 받아 초안을 만든 담당자에게 오늘 같은 제안이 또 뜨지
않게 하기 위해서다. 초안은 원장을 안 움직이므로 원장만 보면 매일 다시 뜬다.

이동 제안은 **한 출발 창고**에서만 낸다(이동 지시서는 창고 쌍 단위 문서). 비판매 창고가 여럿이면 가장 큰
로케이션이 속한 창고를 고르고, 그 창고의 로케이션을 큰 곳부터 채워 `lines` 로 낸다.

두 축은 서로를 모른다. 부천이 부족한데 중국에 물량이 모자라면 이동 제안(있는 만큼)과 발주 제안
(전사 ROP 를 밑돌 때)이 각각 뜬다. 전사 ROP 를 안 밑돌면 발주 제안은 뜨지 않는다 — 발주잔량이
이미 오고 있다는 뜻이고 그게 맞다.

`daysOfCover = IP_판매 ÷ μ_D` (μ_D = 0 이면 null). 목록은 이 값 오름차순, null 은 뒤.

응답의 `sellable` 은 **단일 객체**다 — 판매 창고가 하나(부천)라는 현재 사실을 전제한다. 둘이 되면 배열로
바꾸는 것이 아니라 §4.5 · §11 대로 수요 프로필부터 다시 설계한다. 판매 창고(`warehouses.is_sellable=true`)가
정확히 하나가 아니면 목록 · 단건 API 모두 **409** 를 낸다 (`ReplenishmentStockReader.findSingleSellableWarehouseId`,
C 구현). 라이브 개통 전 그 행 수를 확인한다.

### 7.3 응답

SKU 당 한 행. `actions` 에는 실행 가능한 제안만.

```ts
interface ReplenishmentSuggestionRow {
  skuId: string; skuCode: string; skuName: string;
  supplier: { id: string; name: string } | null;
  pattern: Pattern; grade: Grade; confidence: 'normal' | 'low';
  demand: { dailyMean: number; dailyStd: number };
  company: { onHand: number; inTransfer: number; onOrder: number; reserved: number; position: number;
             safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number };
  sellable: { warehouseId: string; onHand: number; reserved: number; inTransit: number; onOrderDirect: number;
              position: number; safetyStock: number; reorderPoint: number; targetLevel: number;
              leadTimeDays: number; daysOfCover: number | null };
  actions: Array<
    | { type: 'purchase'; qty: number; supplierId: string | null; sourceWarehouseId: string | null }
    | { type: 'transfer'; qty: number; fromWarehouseId: string; toWarehouseId: string;
        /** 비판매 ON_HAND 를 로케이션별로 큰 곳부터 채운 라인 — 이동 지시서 API 가 출발 로케이션을 요구한다 */
        lines: Array<{ fromLocationId: string; quantity: number }> }>;
  flags: Array<'default_lead_time' | 'supplier_unknown' | 'low_confidence' | 'legacy_only'>;
  legacyReorderPoint: number;
}
```

목록은 이 행을 봉투에 담는다:

```ts
interface ReplenishmentSuggestionList {
  items: ReplenishmentSuggestionRow[];
  evaluated: number;   // 판정한 SKU 수 (excluded 제외)
  total: number;       // action 필터 적용 후 actionable 행 수 — limit 적용 전
}
```

`items` 는 `total` 을 센 뒤 `limit`(기본 200 · 최대 1000) 으로 자른다. C 는 `SuggestionRow` 의
`pattern` · `grade` · `confidence` 를 리터럴 `'insufficient'` · `'C'` · `'low'` 로 좁혀 두었고 `sourceWarehouseId`
는 항상 `null` 이다 — B 가 전체 enum 과 공급사 `default_warehouse_id` 로 넓힌다.

`legacy_only` 는 C 단계(§9) 의 자리표시 규칙으로 계산된 행에 붙는다. B 가 들어오면 사라진다.
중첩 객체는 전부 별도 DTO 클래스(`@ApiProperty({ type: 'object' })` 금지).

### 7.4 API

전부 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` + 컨트롤러 `@UseGuards(ScopeGuard)`. 새 라우트는
`platform/auth/inventory-scope-coverage.spec.ts` 의 라우트 표에도 등록한다(빠지면 그 스펙이 빨갛다).

| 단계 | 라우트 | 내용 |
|---|---|---|
| C | `GET /replenishment/suggestions?action=purchase\|transfer\|all&limit=` | `actions.length ≥ 1` 인 SKU 만. `excluded` 제외. `limit` 기본 200 · 최대 1000. 응답 `{ items, evaluated, total }` |
| C | `GET /replenishment/skus/:skuId` | 어떤 SKU 든 같은 행(actions 빈 배열 가능). 없으면 404. B 가 `profile` · `parameters` 를 덧붙여 프로필 드로어가 쓴다. **`excluded` SKU 도 행을 준다**(`parameters.excluded=true`) — 드로어가 제외 이유를 보여줘야 한다(B 결정) |
| A | `POST /replenishment/profiles/recompute?series=window\|full` | 야간 배치와 같은 세 단계를 지금. 동기 실행, 단계별 건수 요약 반환 |
| B | `GET/PUT /replenishment/rules/settings` | 전역 |
| B | `GET/PUT /replenishment/rules/grades` | 3행 일괄 |
| B | `GET /replenishment/rules/suppliers` · `PUT/DELETE .../suppliers/:supplierId` | 공급사 전체를 규칙 · 관측 프로필과 left join. DELETE 는 전역 기본으로 되돌린다 |
| B | `GET /replenishment/rules/routes` · `PUT/DELETE .../routes/:fromWarehouseId/:toWarehouseId` | 규칙 ∪ 관측 경로를 창고명과 함께 |
| B | `GET /replenishment/rules/skus?q=` · `PUT/DELETE .../skus/:skuId` | 예외 목록(코드 · 이름 검색). 새 예외는 SKU 검색 후 PUT |

**삭제(C 에서 완료)**: `GET /purchase-orders/suggestions/reorder` · `ReorderSuggestionReader` · `StockReorderSuggestion` DTO ·
`GET /inventory/safety-stock-warnings` · `GET /inventory/safety-stock-status/:skuId` · `SafetyStockService` 와 그 응답 타입.
admin-web 의 호출처(카트 드로어 재발주 추천 탭)도 같은 PR 에서 지웠다.

### 7.5 성능

원장 집계 1 · 예약 집계 1 · 파이프라인 3 · draft 지시서 1 · 프로필 1 · 규칙 5 — 전부 집합 질의 후
메모리에서 SKU 6천 개를 순수 함수로 돈다. 요청당 1초 안쪽을 목표로 하고, 넘으면 그때 캐시를 본다.
`stock_summary_view` 는 건드리지 않는다(뷰의 `on_order_qty` 리터럴 0 은 남는다 — 이 API 가 안 쓰므로 무해).

### 7.6 알려진 한계

- 🔴 **확정 예약 허수(94%)** 가 `− 확정예약` 을 부풀려 발주 제안이 과대해진다. 청소는 선행조건이지
  이 설계의 대상이 아니다. 청소 전 개통하면 목록이 틀린 게 아니라 **예약이 틀린 것**이 보이는 것이다.
- 소유자(`holders.is_our_asset`) 를 구분하지 않는다. 위탁 재고가 생기면 발주 축에서 빼는 규칙이 필요하다.
- **`skus.stock_type` 을 구분하지 않는다.** `replenishment-stock.reader.ts` 는 `is_deleted = false` 만
  거르므로 `infinite` · `drop_shipped` · `consignment` SKU 도 제안 후보가 된다(C 유래 동작). 지금은
  SKU 예외 `excluded` 로 하나씩 빼는 것이 유일한 우회로다 — 그 부류가 실제로 늘면 모집단 질의에서
  거르는 편이 낫다.
- 판매 창고가 둘이 되면 §4.5 와 같은 시점에 연다.

**C 가 코드에 `TODO(#743 A+B)` 로 남긴 세 곳과 거취.**

| 위치 | 내용 | 거취 |
|---|---|---|
| `suggestion.assembler.ts` `planTransfer` | `draftTransferPlanned` 가 **전 창고 합**이라 비판매 창고가 둘 이상이면 다른 창고의 초안까지 뺀다 | **B** 가 고친다 — draft 합을 출발 창고별로 받아(`Array<{ fromWarehouseId, qty }>`) 고른 출발 창고의 것만 뺀다 |
| `warehouse-transfer.reader.ts` `findDraftPlannedBySku` | `status='draft'` 만 보고 **출발 창고를 안 가린다** — 판매 창고에서 나가는 초안(반품 이동)도 빼버린다 | **B** 가 고친다 — `from_warehouse` 를 비판매로 좁히고 출발 창고별로 group by |
| `inbound-pipeline.reader.ts` `readOnOrderTotal` | PO 당 계획 1개 불변식을 `inbound.service` 가 지킬 뿐 DB 가 안 지킨다 — 수동 `POST /inbound/plans` 가 두 번째 계획을 만들면 이중 계상 | **A · B 대상 아님.** DB 제약(`inbound_plans.linked_purchase_order_id` 부분 unique)은 라이브에 중복이 있는지 먼저 세어야 하므로 별도 이슈로 뗀다 |

## 8. 데이터 모델 · 모듈 · 배치 · 화면

### 8.1 테이블 9개 — 전부 additive, `inventory.schema.ts`, 마이그레이션은 단계마다 1건

| 단계 | 테이블 |
|---|---|
| **A** (5) | `replenishment_settings` · `sku_demand_daily` · `sku_demand_profiles` · `supplier_lead_time_profiles` · `route_lead_time_profiles` |
| **B** (4) | `replenishment_grade_rules` · `replenishment_supplier_rules` · `replenishment_route_rules` · `replenishment_sku_overrides` |

`replenishment_settings` 가 A 에 가는 이유: 프로필 계산이 창 길이 · 임계 · D0 · 재계산 일수를 거기서 읽는다.
A 는 이 표를 **시드 1행으로 채우고 읽기만** 하고, 쓰기(PUT) 는 B 의 규칙 CRUD 가 연다.

§4.1 · §4.3 · §4.4 · §6 의 표가 정의다. 공통: `created_at` · `updated_at` timestamptz.
**실수 열은 전부 `double precision`** (drizzle `doublePrecision`). drizzle 의 `numeric` 은 문자열을 돌려주고 이 저장소엔
numeric 열이 0개라 관례가 없다 — 통계값은 소수 정밀도가 필요 없다. 금액(`amount`)은 `bigint({ mode: 'number' })`,
날짜 열은 `date({ mode: 'string' })` (`purchase_order_lines.expected_arrival` 의 선례 — Date 객체를 앱 경계에 두면 하루가 민다).
`updated_by` 는 열만 두고 B 에서 채우지 않는다 — replenishment 컨트롤러엔 actor 배관이 없다(C 도 없다). 감사가 필요해지면
그때 `@CurrentUser` 를 끼운다.
FK 는 `skus` · `suppliers` · `warehouses` 에 `onDelete: 'cascade'`(시계열 · 프로필 · 예외) 또는
`'restrict'`(규칙). 인덱스: `sku_demand_daily(demand_date)`, `sku_demand_profiles(pattern)`,
`replenishment_sku_overrides(mode)`.

### 8.2 모듈

`apps/core/src/modules/inventory/replenishment/` — `procurement` · `warehouse-transfer` 와 형제.

```
replenishment.module.ts                                                    C
controllers/  replenishment-suggestion.controller.ts                       C
              replenishment-profile.controller.ts   recompute              A
              replenishment-rules.controller.ts     규칙 CRUD              B
dto/          replenishment-suggestion.dto.ts                              C (B 가 profile · parameters 덧붙임)
              replenishment-profile.dto.ts · replenishment-rules.dto.ts    A · B
demand/       demand-series.writer.ts        core → sku_demand_daily 창 upsert          A
              demand-profile.calculator.ts   시계열 → §4.3 통계 (순수)                  A
              demand-profile.refresher.ts    프로필 upsert                                A
              lead-time-profile.refresher.ts §4.4 관측 → 프로필                          A
              replenishment-refresh.job.ts   야간 크론 + recompute 오케스트레이션        A
              replenishment-profile.service.ts  recompute 서비스(1줄 위임)                A
              replenishment-settings.reader.ts  전역 설정 1행 읽기 (A 가 만들고 B 가 씀) A
              calendar.ts                    'YYYY-MM-DD' 산술 · KST 오늘 (순수)          A
              demand-profile.reader.ts       프로필 3표 읽기 — 제안 조립용                B
policy/       rounding.ts                    MOQ · 상자 올림 (순수)                      C
              distributions.ts               Φ⁻¹ · 감마 분위수 (순수)                    B
              classification.ts              ADI·CV² → pattern (순수)                   A  ← 프로필 계산이 쓴다
              replenishment-policy.ts        §5 (순수)                                  B
rules/        replenishment-rules.reader.ts · .manager.ts · .service.ts                B
              effective-parameters.ts        우선순위 (순수)                             B
suggestion/   replenishment-stock.reader.ts  원장 · 예약 · SKU 마스터 · 공급사 결정      C
              replenishment-suggestion.reader.ts  재료 수집 → 조립 → 필터 (오케스트레이션) C (B 가 프로필 · 규칙 · 정책 호출을 끼움)
              suggestion.assembler.ts        §7.2 두 축 판정 (순수)                     C (B 가 levelsFor 를 교체)
              suggestion.types.ts            조립 입출력 인터페이스 (순수)               C
              replenishment-suggestion.service.ts  트랜잭션 경계 + DTO 매핑             C
```

C 가 정한 층 분담: **Service 는 `dbService.run` 경계와 DTO 매핑만, 오케스트레이션(조회 5회 → 순수 조립 →
action 필터 → limit)은 `ReplenishmentSuggestionReader`** 가 갖는다. B 는 이 Reader 안에 프로필 · 규칙 ·
리드타임 조회와 순수 정책 호출을 끼워 넣고, 조립기의 `levelsFor` 만 교체한다 — 축 판정 자체는 그대로다.
C 는 재료 두 가지도 이웃 모듈에 이미 넣었다: `InboundPipelineReader.onOrderTotalQty` ·
`WarehouseTransferReader.findDraftPlannedBySku`. 경계 스펙 `replenishment-boundary.arch.spec.ts` 는
`apps/core/src/modules/inventory/` 바로 아래에 있고 순수 층 파일 목록을 들고 있다 — A · B 가 순수 파일을
더할 때마다 거기 등록한다.

- imports: `SharedModule` · `CoreInventoryModule` · `StockProjectionModule` · `WarehouseTransferModule`
  (draft planned 합을 `WarehouseTransferReader` 에서 빌린다 — `StockProjectionModule` 이 같은 이유로
  같은 모듈을 import 하는 선례). **`ProcurementModule` 은 import 하지 않는다.** 제안은 읽기 전용이고
  실행(카트 담기 · 이동 지시서 생성)은 화면이 기존 API 를 부른다.
- 레이어 규칙 준수: Controller → Service(2~3줄) → Reader/Manager → DB. 도메인 예외는 `@app/shared`.
  DB 는 `@InjectTypedDb<typeof wmsSchema>()` 와 `dbService.run(fn, tx)`. `db.query.*` · `any` · `as` 금지.
- 순수 층(`policy/` · `calculator` · `assembler` · `effective-parameters`)은 Nest · drizzle 을 import 하지 않는다.

### 8.3 야간 배치

`@Cron('40 3 * * *', { name: 'replenishment-profile-refresh', timeZone: 'Asia/Seoul' })` 하나.
(03:00 `ledger-reconciliation` · 03:05 `zombie-reservation-reconciliation` · 03:10 `fulfillment-v2-reconciliation` ·
03:30 `inventory-idempotency-purge` · 04:00 `transfer-stagnation-monitor` 사이의 빈 칸.)
`SCHEDULE_ROOT` 는 전역이라 `ReplenishmentModule` 은 아무것도 import 하지 않고 `@Cron` 만 단다 —
`ScheduleModule.forRoot()` 를 다시 부르면 크론이 두 번 뜬다(#599).

1. `demand-series.writer` — 최근 `demand_recompute_days` 창 upsert
2. `demand-profile.refresher` — 전 SKU 프로필 upsert
3. `lead-time-profile.refresher` — 공급사 · 경로 프로필 upsert

각 단계가 upsert 라 멱등이다. 크론 리더 선출이 없어 인스턴스가 둘이면 두 번 도는데, 결과가 같다.
실패는 **단계 단위**로 로그하고 다음 단계로 넘어가지 않는다(부분 갱신된 프로필 위에 리드타임만 새것이
되는 상태를 피한다). `recompute` 엔드포인트는 같은 세 단계를 동기로 돈다.

### 8.4 admin-web (최소)

| 화면 | 내용 |
|---|---|
| `/inventory/replenishment` (C 구현) | 제안 목록. 열: SKU · 패턴/등급 · 판매창고 재고 · 예상 소진일 · 전사 위치 · 제안(발주 n / 이동 n) · 플래그. 필터 `action` · 발주 유형 토글. 행 액션: **발주 카트에 담기**(기존 `POST /purchase-orders/cart`) · **이동 지시서 초안 만들기**(기존 `POST /inventory/warehouse-transfers`, `inventory.adjust` 스코프 필요 — 403 이면 화면이 그렇게 말한다). 행 클릭 → SKU 판정 드로어(`GET /replenishment/skus/:skuId`). C 는 `legacy_only` 안내 문구를 낸다 |
| SKU 판정 드로어 (B 확장) | C 드로어에 프로필(패턴 · 등급 · ADI · CV² · 일평균/표준편차 · 발생일 통계 · 창 · 계산 시각) · 유효 파라미터(α · L1 · L2 · 커버 일수와 각각의 출처) · 레거시 값 · 플래그를 더한다. 표시 변환은 `.ts` 순수 함수 |
| `/inventory/replenishment/rules` (B) | 탭 5개: 전역 · 등급 · 공급사 · 경로 · SKU 예외. 폼과 표. 항목마다 "즉시 반영 / 다음 재계산 반영" 문구 |
| SKU 폼 (B) | 안전재고 입력 제거, SKU 예외 화면 링크 |

판정 · 정렬 · 표시 변환은 `.ts` 순수 함수로 빼서 테스트한다(admin-web 은 컴포넌트 테스트 불가).

## 9. 단계와 배포 순서

| 단계 | 내용 | 마이그 | 배포 순서 |
|---|---|---|---|
| **C** (#743 본체) — **완료, PR #804 머지 2026-09-08** | 모듈 골격 · 두 축 판정 · 파이프라인 배선(`onOrderTotalQty` · `findDraftPlannedBySku`) · 옛 API 둘 삭제 · 제안 목록 화면 교체. 안전재고 입력은 `skus.safety_stock` 정적값, 두 축 모두 ROP = S = 그 값, 발주량 = `roundUp(max(SS − IP, 0))`, 행에 `legacy_only` 플래그. `demand` 는 0, `daysOfCover` 는 null, 목록 정렬은 `sellable.position − reorderPoint` 오름차순 | 0 | `sst deploy`. core 와 admin-web 이 한 스택이라 순서를 못 정하고, 배포 중 한쪽이 404 를 보는 짧은 창을 감수한다(읽기 전용 페이지). ⛔ 로컬 스모크 5항목 미실행 |
| **A** 통계 층 | 테이블 5개(§8.1) · 전역 설정 시드 1행 · `demand-series.writer` · `classification` · `demand-profile.calculator/refresher` · `lead-time-profile.refresher` · 야간 크론 · `POST /replenishment/profiles/recompute` · 셀메이트 시드 스크립트. **제안 API 는 건드리지 않는다** — 배포해도 제안은 C 그대로(`legacy_only`), 프로필만 쌓인다 | 1 | **expand: `db:migrate → db:seed:ref → sst deploy`**. 그 뒤 사람 작업 §9.1 |
| **B** 정책 층 | 테이블 4개(§8.1) · 등급 시드 3행 · `distributions` · `replenishment-policy` · `effective-parameters` · 규칙 CRUD 13라우트 · 제안 교체(`legacy_only` 제거, `daysOfCover` 정렬, C 의 TODO 2곳) · 규칙 화면 · 프로필 드로어 · SKU 폼 안전재고 입력 제거 · `skus.safety_stock` 읽기 중단 | 1 | **expand: `db:migrate → db:seed:ref → sst deploy`**. A 가 먼저 배포돼 있어야 한다(프로필이 비어 있으면 전 SKU 가 `insufficient`). 그 뒤 사람 작업 §9.2 |
| **contract** | `skus.safety_stock` DROP COLUMN | 1 | B 배포 한 번 지난 뒤 **`sst deploy → db:migrate`** |

C 단계의 자리표시 규칙은 B 가 통째로 교체한다. A 를 B 와 떼는 이유: A 는 배포해도 제안이 안 바뀌어
휴면이고(프로필 · 시계열만 쌓인다), 셀메이트 시드 실행과 D0 확인이라는 사람 작업이 B 의 규칙 입력과
독립이다. A 가 라이브에서 며칠 돌아 프로필이 안정된 뒤 B 를 내면 개통 첫날부터 `insufficient` 비율을
읽을 수 있다. 두 단계를 한 배포에 실어도 순서(A 마이그 → B 마이그)는 같다.

### 9.1 A 배포 후 사람 작업 (순서대로)

1. 셀메이트 시드 스크립트 실행(live 터널). 미매칭 리포트 확인.
2. `replenishment_settings.demand_core_since` 확인.
3. `POST /replenishment/profiles/recompute?series=full`. 응답의 단계별 건수(시계열 upsert · 프로필 · 리드타임)를
   이슈 #743 에 적는다.
4. 다음 날 크론(03:40 KST) 이 돌았는지 로그 확인(`replenishment-profile-refresh`).
5. **variant→SKU 매칭을 추가하는 백필을 할 때마다 `?series=full` 재계산이 필요하다.** 야간 배치는
   항상 최근 롤링 창(`demand_recompute_days`)만 다시 만들 뿐이라, 그 창보다 오래된 주문의 수요는
   누군가 전체 재계산을 요청하기 전까지 반영되지 않고 아무것도 자동으로 트리거하지 않는다.
   §1.1 이 기록한 「주문 34%가 `awaiting_matching`」이 바로 이 상황이다 — 예외가 아니라 평상시다.
6. **`?series=full` 호출은 로드밸런서 60초 유휴 타임아웃을 넘겨 게이트웨이 타임아웃으로 끝나는 게
   정상이다. 재시도하지 말 것.** 서버는 클라이언트가 포기한 뒤에도 계속 일하고, 각 단계는 독립적으로
   커밋되며, 겹쳐 도는 두 번째 실행은 위 리드타임 refresher 수정(§4.4, upsert 로 병합)이 막는 바로 그
   충돌 상황을 다시 만드는 것과 같다. 대신 `SELECT count(*), max(computed_at) FROM sku_demand_profiles`
   로 완료를 확인하고, 단계별 건수는 다음 야간 배치 로그 줄에서 읽는다.

### 9.2 B 배포 후 사람 작업 (순서대로)

0. **배포 순서는 `db:migrate → db:seed:ref → sst deploy` 다 — 등급 시드가 코드보다 먼저다.**
   `replenishment_grade_rules` 3행(A · B · C)이 없으면 `ReplenishmentRulesReader.readGradeAlphas` 가
   던지고 그건 도메인 예외가 아니라 **제안 API 전체가 500** 이다(목록도 단건도). 새 코드가 시드보다
   먼저 뜨는 창을 만들지 말 것.

0-1. 🔴 **셀메이트 시드 + `?series=full` 이 끝나기 전까지 제안 목록이 비어 있는 것이 정상이다.**
   프로필이 없으면 `dailyMean = 0` → `computePolicy` 가 조기 반환해 SS = ROP = S = 0 이고, 그러면
   재고가 있는 SKU 는 `position > 0 = ROP` 라 판정에 안 걸리고 재고 0 인 SKU 는 발주량이 0 이라
   액션이 없다 → **`items: []`**. C 단계는 `skus.safety_stock` 정적값으로 행이 나왔으므로 화면이
   「가득 → 텅」으로 바뀌고, 이걸 모르면 개통 당일 롤백을 오판한다. **판정 자체는 돌고 있다** —
   응답의 `evaluated` 가 0 이 아니면 「전 SKU 를 봤고 제안이 0건」이고, 0 이면 그때가 진짜 사고다.
   §9.1 의 A 사람 작업이 끝나 있으면 이 창은 열리지 않는다.

1. 활성 공급사의 규칙(L1 · 커버 일수), 중국→부천 경로 규칙(L2 · 이동 커버) 입력.
2. 수동 검증: 네 패턴에서 SKU 5개씩 골라 새 ROP 와 레거시 값을 나란히 놓고 상식 점검.
   `insufficient` 비율, `supplier_unknown` 건수, 발주 제안 총량 확인.
3. 🔴 **확정 예약 허수 청소가 아직이면** 발주 제안 총량이 과대하다는 것을 알고 본다.

## 10. 테스트

**단위(DB 없음)**
- `distributions`: Φ⁻¹(0.95)=1.6449 · Φ⁻¹(0.975)=1.9600 · Φ⁻¹(0.99)=2.3263. 감마 분위수는 카이제곱 표
  15개(df ∈ {1, 2, 4, 10, 40} ↔ k ∈ {0.5, 1, 2, 5, 20}, p ∈ {0.9, 0.95, 0.99}) + χ²(2, p) 닫힌 식 + CV→0 정규 수렴.
- `classification`: 사분면 4 · `insufficient` · `none` · 임계 경계(=1.32, =0.49).
- `demand-profile.calculator`: 픽스처 시계열로 ADI · CV² · 창 선택 · 최초 날짜 앞 제외 · 발생일 0/1/2 퇴화 · 등급 컷.
- `replenishment-policy`: `smooth` 가 5변수 공식과 수치 일치 · CV→0 감마→정규 수렴 · L 합성(σ 제곱합) ·
  σ_L 기본 0.25μ · 오버라이드 SS · `none` 0 · roundUp(MOQ · packing_unit).
- `effective-parameters`: α · L1 · L2 · 커버 우선순위 전 조합 · `excluded_until` 만료.
- `suggestion.assembler`: 두 축 독립 4조합 · draft 차감 · 이동량 = min · 발주잔량이 덮으면 없음 ·
  플래그 · `daysOfCover` 정렬(null 뒤).
- admin-web 순수 함수: 긴급도 정렬 · 표시 변환.

**통합(`describeIfDb`, `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local`)**
- `demand-series.writer` (A): 취소 라인 제외 · 디지털 제외 · 링크 구성수량 환산 · 14일 창 재계산 멱등 · D0 경계.
- `replenishment-stock.reader` (C 완료): 상태 · 판매창고 여부별 합 · 확정 예약만 차감.
- `lead-time-profile.refresher` (A): 발주 라인 → 첫 입고 · 지시서 선적 → 첫 수령 · n<2 면 std null.
- 제안 end-to-end 3장면 (C 완료, B 가 프로필 · 규칙 픽스처로 갱신): 중국 有·부천 부족 → 이동만 / 둘 다 부족 → 둘 다 /
  발주잔량이 덮음 → 없음. C 는 404 · limit/total 장면도 갖고 있다.
- 스펙 안에서 `dotenv.config()` 금지. `--runInBand` 는 전용 명령이 고정한다.

**아키텍처**
- `replenishment ↔ procurement` 상호 import 0 을 grep 스펙으로 고정(`inventory-write-boundary.arch.spec.ts` 옆에
  `replenishment-boundary.arch.spec.ts`). 순수 층 파일이 `@nestjs` · `drizzle-orm` 을 import 하지 않는 것도 같은 스펙.
- 새 라우트는 전부 `@RequireScopes(INVENTORY_SCOPE.MANAGE)` — 기존 AST 인가 감사가 잡는다.

**게이트**: `npm run type-check` · `npx jest --maxWorkers=2` · `cd apps/admin-web && npx tsc --noEmit` 셋 다 0.

## 11. 재검토 트리거

- **판매 창고가 둘 이상이 되면** 수요 프로필을 창고별로 가르고 ①② 귀속을 다시 설계한다(§4.5 · §7.6).
- **비판매 창고가 둘 이상 실제로 쓰이기 시작하면** 이동 축 파라미터(L2 · 이동 커버)의 해석을 다시 본다.
  지금은 **공급사 기본 창고** 경로로 해석하는데, 실제 이동 제안의 출발 창고는 조립기가 원장에서 고르므로
  (§7.2 「가장 큰 로케이션이 속한 창고」) 둘이 갈라져 **제안하지 않는 경로의 리드타임**으로 계산될 수 있다.
  라이브는 판매 창고 1 · 실질 출발지 1(중국)이라 현재는 일치한다. 고치려면 「파라미터 해석 → 조립」
  순서를 뒤집어야 한다(`replenishment-suggestion.reader.ts` 의 같은 주석).
- **위탁 재고(`is_our_asset=false`)가 생기면** 발주 축에서 그 SKU 를 빼는 규칙을 더한다.
- **제안 API 가 1초를 넘으면** 프로필 옆에 재고 집계를 물질화할지 판단한다(§7.5).
- **일별 판매가능수량 이력이 생기면** 검열 보정(§4.5)을 검토한다.
- **발주 배치와 선적 배치가 1:1 로 바뀌면** L2 통합 버퍼의 의미가 사라진다 — ADR-0032 재검토 트리거와 같다.
