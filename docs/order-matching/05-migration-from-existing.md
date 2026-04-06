# 기존 매칭 코드 마이그레이션 계획

order-matching 앱 도입 시, WMS와 PIM에 남아있는 기존 매칭 기능을 정리해야 한다. 본 문서는 제거/수정 대상과 그 계획을 정리한다.

---

## WMS에서 제거할 것

### 완전 제거 대상 (매칭 전용 코드)

아래 파일들은 매칭 기능만을 위해 존재하므로 전체 제거한다.

#### 서비스

| 파일 | 설명 |
|------|------|
| `apps/wms/src/inventory/services/product-matching.service.ts` | 매칭 생성/해소/조회/전략 관리 핵심 서비스 |
| `apps/wms/src/order/matchings/services/matchings.service.ts` | 매칭 조회/upsert/배치 통계 서비스 |
| `apps/wms/src/order/shared/services/product-sku-mapping.service.ts` | 버전별 매핑, 스냅샷 생성 서비스 |

#### 컨트롤러

| 파일 | 설명 |
|------|------|
| `apps/wms/src/inventory/controllers/product-matching.controller.ts` | 매칭 관리 REST API (7 엔드포인트) |
| `apps/wms/src/order/matchings/controllers/matchings.controller.ts` | 주문 측 매칭 REST API (3 엔드포인트) |

#### 이벤트 컨슈머

| 파일 | 설명 |
|------|------|
| `apps/wms/src/inventory/handlers/product-event.consumer.ts` | PIM variant 이벤트 → 매칭 생성 컨슈머 |

#### 전략 패턴

| 파일 | 설명 |
|------|------|
| `apps/wms/src/inventory/strategies/matching-strategy.interface.ts` | 매칭 전략 추상 클래스 |
| `apps/wms/src/inventory/strategies/void-matching.strategy.ts` | void 전략 구현 |
| `apps/wms/src/inventory/strategies/variant-matching.strategy.ts` | variant 전략 구현 |

#### DTO

| 파일 | 설명 |
|------|------|
| `apps/wms/src/inventory/dto/product-matching/resolve-matching.dto.ts` | 매칭 해소 DTO |
| `apps/wms/src/inventory/dto/product-matching/option-matching.dto.ts` | (deprecated) 옵션 매칭 DTO |
| `apps/wms/src/inventory/dto/product-matching/change-strategy.dto.ts` | 전략 변경 DTO |
| `apps/wms/src/inventory/dto/product-matching/set-matching-priority.dto.ts` | 우선순위 DTO |
| `apps/wms/src/inventory/dto/product-matching/variant-sku-lookup.dto.ts` | SKU 조회 DTO |
| `apps/wms/src/order/matchings/dto/upsert-matching.dto.ts` | 매칭 upsert DTO |

### 스키마에서 제거할 테이블

`apps/wms/database/schemas/wms-schema.ts`에서 다음 테이블 정의를 제거한다:

| 테이블 | 설명 |
|--------|------|
| `product_matchings` | 매칭 레코드 |
| `product_variant_sku_links` | variant-SKU 링크 |
| `product_sku_mappings` | 버전별 매핑 |
| `product_sku_mapping_items` | 매핑 아이템 |
| `product_sku_mapping_snapshots` | 주문 시점 매칭 스냅샷 |

관련 enum 정의도 제거:
- `matchingStatusEnum` (`pending`, `matched`, `ignored`)
- `matchingPriorityEnum` (`normal`, `high`)
- `matchingStrategyEnum` (`void`, `variant`)

`apps/wms/database/schemas/enum-values.ts`에서 관련 enum 값/타입 export도 제거.

---

### 선택적 수정이 필요한 파일 (혼합 코드)

아래 파일들은 매칭 외의 기능도 포함하므로, 매칭 관련 부분만 수정한다.

#### `apps/wms/src/inventory/inventory.module.ts`

매칭 관련 provider/controller 등록을 제거:
- `ProductMatchingController` 등록 제거
- `ProductEventConsumer` 등록 제거
- `ProductMatchingService` 등록 및 export 제거
- `VariantMatchingStrategy`, `VoidMatchingStrategy` 등록 제거

#### `apps/wms/src/order/order.module.ts`

- `MatchingsController` 등록 제거
- `MatchingsService` 등록 및 export 제거

#### `apps/wms/database/schemas/wms-schema.ts` — `sales_order_lines` 테이블

`sales_order_lines`에 다음 FK 컬럼이 있다:
- `productMatchingId` → `product_matchings.id` (onDelete: set null)
- `mappingSnapshotId` → `product_sku_mapping_snapshots.id` (onDelete: restrict)

**처리 방안:** 새 설계에서는 주문 변환을 order-matching 앱이 담당하므로, WMS의 sales_order_lines에 매칭 참조가 필요 없다. 이 컬럼들을 제거하거나, order-matching 앱이 발행하는 변환 결과에 포함된 스냅샷 정보로 대체한다.

#### `apps/wms/src/order/sales-orders/services/sales-orders.service.ts`

- 주문 생성/병합 시 `productMatchingId`를 설정하는 코드 제거

#### `apps/wms/src/order/sales-orders/dto/create-sales-order.dto.ts`

- `productMatchingId` 필드 제거

#### `apps/wms/src/inventory/services/inventory.service.ts`

- SKU 삭제 시 매칭 참조 검사 로직 제거 (매칭 앱이 SKU 비활성화 이벤트를 별도 처리)

#### `apps/wms/src/order/fulfillments/services/fulfillments.service.ts`

- `MatchingsService` import 및 의존성 제거
- 매칭 fallback 로직 제거. 새 설계에서는 order-matching 앱이 변환한 재고주문을 직접 받으므로, WMS fulfillment 서비스가 매칭을 조회할 필요가 없다.

#### `apps/wms/database/schemas/wms-schema.ts` — `fulfillment_order_items` 테이블

- `mappingSnapshotId` FK 컬럼에 대한 처리 검토. 새 설계에서 재고주문은 이미 SKU 단위이므로 스냅샷 참조가 불필요할 수 있다.

---

## PIM에서 수정할 것

PIM에는 매칭 전용 코드가 비교적 적다. 매칭 관련 코드를 제거하기보다는, 이벤트 발행 체계를 정비하는 것이 주 작업이다.

### 이벤트 발행 정비

#### `apps/pim/src/core/products/services/product-masters.service.ts`

- variant 생성 이벤트 발행 유지 (order-matching이 이 이벤트를 소비)
- 매칭 전용 필드(`inventoryManagement`, `preStockSellable`, `alwaysSellableZeroStock`)는 이벤트 페이로드에서 **제거 검토**. 이 정책은 order-matching 앱에서 매칭 생성 시 관리자가 설정하는 것이 더 적절하다.
- 단, 제거 시 order-matching 앱의 매칭 생성 워크플로우가 이 정보 없이도 동작해야 하므로, 새 앱 구현 시점에 맞춰 제거한다.

#### `apps/pim/src/core/products/services/product-versions.service.ts`

- `ProductVariantDeleted` 이벤트가 현재 **로그만 남기고 실제 발행하지 않는** 상태. order-matching이 이 이벤트를 소비해서 매칭을 정리해야 하므로, 실제 이벤트 발행을 구현해야 한다.

### 이벤트 컨트랙트

#### `packages/event-contracts/streams/product.stream.ts`

- `ProductVariantCreated` 페이로드에서 매칭 전용 필드 제거 검토:
  ```typescript
  // 아래 필드들은 order-matching 앱의 매칭 설정으로 이동
  // inventoryManagement: boolean;
  // preStockSellable?: boolean;
  // alwaysSellableZeroStock?: boolean;
  ```
- `ProductInventoryManagementChanged` 이벤트 — 정의만 되어있고 발행하는 코드가 없음. 이 이벤트의 필요성을 재검토한다. 새 설계에서는 재고 정책이 order-matching 앱에서 관리되므로, PIM이 이 이벤트를 발행할 이유가 없다. **제거 대상.**
- `ProductVariantDeleted` 이벤트 — 정의는 있으나 PIM에서 미발행. **발행 구현 필요.**

---

## Orchestrator에서 수정할 것

#### `apps/orchestrator/src/workflows/unified-master.workflow.ts`

현재 `UnifiedMasterWorkflow`가 3단계 saga를 실행한다:
1. PIM에 master 생성
2. WMS에 master 생성
3. WMS에 매칭 생성 (첫 번째 variant만)

**수정:** 3단계를 order-matching 앱에 대한 요청으로 변경하거나, 새 설계에서는 이 단계 자체가 불필요할 수 있다. order-matching은 PIM 이벤트를 소비하여 variant 존재를 인지하고, 관리자가 필요할 때 매칭을 생성하는 Pull 모델이므로, saga에서 매칭 생성 단계를 제거하는 것이 자연스럽다.

---

## WMS에 새로 추가할 것 (projection)

order-matching 앱이 발행하는 매칭 이벤트를 WMS가 소비하여 자체 projection을 유지해야 한다.

### 매칭 projection 테이블

```
matching_projections
├── variant_id    UUID UNIQUE
├── strategy      'sku' | 'void' | 'skip'
├── updated_at    TIMESTAMP

matching_projection_sku_links
├── variant_id    UUID FK → matching_projections
├── sku_id        UUID FK → skus
├── quantity      INT
```

이 projection은 order-matching 앱이 발행하는 `MatchingCreated`, `MatchingUpdated`, `MatchingDeleted` 이벤트를 소비하여 갱신한다. WMS는 주문 이행 시 이 projection을 조회하며, 매칭 앱에 동기 호출하지 않는다.

### 이벤트 컨슈머

새 Kafka 컨슈머를 추가하여 매칭 이벤트를 소비하고 projection을 갱신한다.

---

## 마이그레이션 순서

매칭 기능이 두 시스템에 동시에 존재하면 혼란이 생기므로, 아래 순서로 진행한다:

### Phase 1: order-matching 앱 구축
- 앱 생성 (`nest g app order-matching`)
- 스키마, 서비스, 컨트롤러 구현
- PIM 이벤트 소비 (variant projection 구축)
- 매칭 CRUD API 구현
- 주문 변환 로직 구현

### Phase 2: 기존 데이터 마이그레이션
- WMS `product_matchings` + `product_variant_sku_links` 데이터를 order-matching 앱 DB로 이전
- 기존 매칭의 status/strategy를 새 모델로 변환:
  - `matched` + `variant` strategy → `sku`
  - `ignored` + `void` strategy → `void`
  - `pending` → 레코드 생성하지 않음 (미매칭)

### Phase 3: WMS에 projection 추가
- 매칭 이벤트 컨슈머 및 projection 테이블 추가
- order-matching에서 초기 동기화 이벤트 발행 또는 배치 동기화

### Phase 4: WMS 기존 매칭 코드 제거
- 위 "완전 제거 대상" 및 "선택적 수정" 항목 실행
- 스키마에서 매칭 테이블/enum 제거
- DB migration 실행 (테이블 DROP)

### Phase 5: PIM / Orchestrator 정비
- 이벤트 페이로드에서 매칭 전용 필드 제거
- `ProductVariantDeleted` 이벤트 실제 발행 구현
- `ProductInventoryManagementChanged` 이벤트 정의 제거
- Orchestrator saga에서 매칭 단계 제거

### Phase 6: 검증
- 기존 매칭 API 호출이 없는지 확인 (admin-web 등)
- 주문 흐름 E2E 테스트
- 미매칭 현황 조회 동작 확인
