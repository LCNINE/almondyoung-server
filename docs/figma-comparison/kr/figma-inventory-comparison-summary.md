# Figma 디자인 vs 백엔드 구현 - 재고 모듈 비교 분석

**분석 날짜**: 2025-10-13
**분석된 화면**: 재고 관련 Figma 디자인 17개
**백엔드 코드베이스**: almondyoung-server WMS 모듈

---

## 경영진 요약 (Executive Summary)

본 문서는 재고 관리 모듈에 대한 Figma 디자인 요구사항과 현재 백엔드 구현 상태를 종합적으로 비교 분석한 자료입니다. 분석 결과 **여러 기능 영역에 걸쳐 약 8-12주의 개발 노력이 필요한 중대한 격차**가 발견되었습니다.

### 전체 평가 (Overall Assessment)

| 카테고리 | 디자인 커버리지 | 백엔드 커버리지 | 격차 심각도 |
|----------|----------------|------------------|--------------|
| **재고현황 조회 (Inventory Status Inquiry)** | 100% | ~40% | 🔴 높음 |
| **SKU 관리 (SKU Management)** | 100% | ~40% | 🔴 높음 |
| **입고 및 발주 (Inbound & Purchase)** | 100% | ~70% | 🟡 중간 |
| **바코드 관리 (Barcode Management)** | 100% | ~20% | 🔴 높음 |
| **판매상품 생성 (Sales Product Creation)** | 100% | ~60% | 🟡 중간 |
| **재고실사 (Stocktaking)** | 100% | ~0% | 🔴 매우 심각 |

**전체 구현 격차**: ~55% (필요 기능의 절반 이상이 누락됨)

---

## 상세 기능 비교 (Detailed Feature Comparison)

### 1. 재고현황 조회 (Inventory Status Inquiry) - 재고현황 목록

**Figma 요구사항** (스크린샷 3개 분석):
- 다중 필드 필터링 (상품 유형, 공급업체, 날짜 범위, 표시 모드)
- 안전재고 알림 및 경고
- 다단계 가격 표시 (4개 가격 단계)
- 공급업체 외부 링크
- 바코드 생성
- 대량 작업 (조정, 입고, 출고, PDF 내보내기)
- 1개월 판매량 추적
- 로케이션 코드 추적
- 상태 배지 및 인디케이터
- 실시간 재고 업데이트

**백엔드 구현 상태**:

✅ **구현 완료 (40%)**:
- 기본 재고 조회 API: `GET /wms/inventory/stocks`
- 재고 요약 API: `GET /wms/inventory/stocks/summary`
- 재고 이력: `GET /wms/inventory/stocks/history`
- 수동 조정: `POST /wms/inventory/stocks/adjust`
- 기본 필터가 포함된 SKU 검색

❌ **누락됨 (60%)**:
- `skus` 테이블의 안전재고 필드 (매우 중요 - UI에서 필수로 표시됨)
- 다단계 가격 (소매가, 도매가, 특별 할인가)
- 1개월 판매량 집계 엔드포인트
- 표시 모드 필터링 (안전재고 미만, 재고 있음 등)
- 공급업체 외부 링크 관리
- 로케이션 기반 재고 추적
- 대량 작업 API 엔드포인트
- PDF 내보내기 기능
- 안전재고 경고 시스템
- 고급 필터링 (UI에 표시된 30개 이상의 필터 조합)

**검토한 파일**:
- `/apps/wms/src/inventory/controllers/inventory.controller.ts` - 기본 CRUD 있음
- `/apps/wms/src/inventory/dto/inventory/get-stock-query.dto.ts` - 제한된 필터
- `/apps/wms/database/schemas/wms-schema.ts:286-300` - 필드가 누락된 SKU 스키마

**필요한 스키마 변경사항**:
```typescript
// skus 테이블에 추가:
safetyStock: integer('safety_stock').default(0),
retailPrice: integer('retail_price'),
wholesalePrice: integer('wholesale_price'),
specialSalePrice: integer('special_sale_price'),
primaryLocationId: uuid('primary_location_id'),
secondaryLocationId: uuid('secondary_location_id'),
expiryDateManagement: boolean('expiry_date_management').default(false),
```

---

### 2. SKU 관리 (SKU Management) - 재고상품 등록/수정

**Figma 요구사항** (스크린샷 4개 분석):
- 50개 이상의 필드를 포함한 종합적인 SKU 생성 양식:
  - 물리적 속성 (무게, 치수, 소재)
  - 비즈니스 정보 (한글명, 수입신고번호)
  - 다단계 가격
  - 안전재고 (필수)
  - 로케이션 할당 (주 + 보조)
  - 담당자 할당 (디자인, 구매, 등록 3개 역할)
  - 메인 이미지 URL
  - 변형(variant) 그룹화
- 별도의 엔터티로서 SKU 옵션/변형 관리
- 인라인 편집이 가능한 옵션 매트릭스 테이블
- 로케이션 이동을 위한 바코드 스캐닝
- 이동 이력 추적

**백엔드 구현 상태**:

✅ **구현 완료 (40%)**:
- 기본 SKU CRUD: `POST/GET/PUT/DELETE /wms/inventory/skus`
- 바코드 관리: `POST /wms/inventory/skus/:id/barcodes`
- 마스터 상품 관계
- 옵션 키 저장 (jsonb 필드)
- 재고 유형 enum
- 판매량 필드 (1개월, 3개월)

❌ **누락됨 (60%)**:
- 확장된 SKU 메타데이터 (15개 이상의 필드):
  - `productWeight`, `dimensionWidth/Height/Depth`
  - `productMaterial`, `businessProductName`
  - `importDeclarationNumber`, `koreanName`
  - `mainImageUrl`, `discount`, `moq`
  - `memo2`, `memo3`, `logisticsPartnerId`
- **안전재고 필드 (매우 중요 - UI에서 필수로 표시됨)**
- 다단계 가격 필드
- 로케이션 추적 (주/보조)
- 담당자 할당
- 일급 엔터티로서의 변형/옵션 관리
- 옵션별 재고 추적
- 바코드 스캐닝을 포함한 로케이션 이동 API
- 이미지 관리
- 변형 그룹 코드 연계

**검토한 파일**:
- `/apps/wms/src/inventory/dto/sku/create-sku.dto.ts` - 10개 필드만 있음
- `/apps/wms/database/schemas/wms-schema.ts:286` - 기본 SKU 스키마

**필요한 신규 테이블**:
```typescript
// 1. 다단계 가격
export const skuVariantPricing = pgTable('sku_variant_pricing', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    retailPrice: integer('retail_price'),
    wholesalePrice: integer('wholesale_price'),
    specialSalePrice: integer('special_sale_price'),
    effectiveFrom: timestamp('effective_from'),
});

// 2. 담당자 할당
export const skuManagers = pgTable('sku_managers', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    designManagerId: uuid('design_manager_id'),
    purchaseManagerId: uuid('purchase_manager_id'),
    registrationManagerId: uuid('registration_manager_id'),
});

// 3. 로케이션 이동 이력
export const skuLocationMovements = pgTable('sku_location_movements', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    fromLocationId: uuid('from_location_id'),
    toLocationId: uuid('to_location_id').notNull(),
    quantity: integer('quantity').notNull(),
    movedBy: uuid('moved_by'),
    movedAt: timestamp('moved_at').defaultNow(),
    barcode: varchar('barcode', { length: 64 }),
});
```

**필요한 API 엔드포인트** (20개 이상의 신규 엔드포인트):
```
POST   /wms/inventory/skus/:id/options          - 옵션 추가
GET    /wms/inventory/skus/:id/options          - 옵션 목록
PUT    /wms/inventory/skus/:id/options/:optionId - 옵션 업데이트
DELETE /wms/inventory/skus/:id/options/:optionId - 옵션 삭제
POST   /wms/inventory/skus/move-location        - SKU 로케이션 이동
POST   /wms/inventory/skus/bulk-move-location   - 대량 이동
GET    /wms/inventory/skus/:id/location-history - 이동 이력
PUT    /wms/inventory/skus/:id/pricing          - 가격 업데이트
PUT    /wms/inventory/skus/:id/managers         - 담당자 업데이트
POST   /wms/inventory/skus/:id/generate-barcode - 바코드 자동 생성
```

---

### 3. 입고 및 발주 관리 (Inbound & Purchase Management)

**Figma 요구사항** (스크린샷 4개 분석):
- 발주 장바구니 관리 ✅ (구현 완료)
- 장바구니에서 발주서 생성 ✅ (구현 완료)
- 상태 워크플로를 포함한 입고 목록 관리
- 바코드 인쇄 큐 시스템
- 즉시 입고 작업
- 입고 적용 워크플로
- 감사 워크플로 (초안 → 검토 대기 → 승인)
- MOQ 검증
- 장바구니에서 안전재고 경고

**백엔드 구현 상태**:

✅ **구현 완료 (70%)**:
- 장바구니 CRUD: `POST/GET/PUT/DELETE /wms/purchase-orders/cart` ✅
- 장바구니에서 발주서 생성: `POST /wms/purchase-orders/from-cart` ✅
- 재주문 제안: `GET /wms/purchase-orders/suggestions/reorder` ✅
- 적절한 관계를 가진 발주서 스키마 ✅
- 입고 수령 생성 ✅
- 재고 이벤트 통합 ✅

❌ **누락됨 (30%)**:
- **입고 목록 컨트롤러 (높은 우선순위)**
- 상태 enum 확장:
  - `inboundStatusEnum`에 필요: 'applied', 'receiving'
  - 새로운 `poAuditStatusEnum`: 'draft', 'pending_audit', 'approved', 'rejected'
- 감사 워크플로 엔드포인트 (제출, 승인, 거부)
- 바코드 인쇄 큐 시스템
- 공급업체 스키마의 MOQ 검증
- 안전재고 검증 서비스

**검토한 파일**:
- `/apps/wms/src/inbound/controllers/purchase-order.controller.ts` ✅
- `/apps/wms/database/schemas/wms-schema.ts:99-101` - enum 확장 필요

**필요한 엔드포인트** (높은 우선순위):
```
GET    /wms/inbound/lists              - 필터링을 포함한 목록
GET    /wms/inbound/lists/:id          - 상세 보기
POST   /wms/inbound/lists/:id/apply    - 입고 적용
POST   /wms/inbound/lists/:id/receive  - 즉시 입고
GET    /wms/inbound/lists/:id/barcode  - 바코드 생성

PUT    /wms/purchase-orders/:id/submit-for-audit
PUT    /wms/purchase-orders/:id/approve
PUT    /wms/purchase-orders/:id/reject
GET    /wms/suppliers/:id/moq-rules
```

**작업량 추정**: 10-15 개발자 일

---

### 4. 바코드 관리 (Barcode Management)

**Figma 요구사항** (스크린샷 2개 분석):
- 검색/필터가 있는 상품 바코드 목록
- 인쇄 큐 관리
- 로케이션 바코드 생성 (형식: A-01-02)
- 일괄 인쇄 기능
- 인쇄 작업 추적 (대기 중, 인쇄 중, 완료, 실패)
- 바코드 생성 (CODE128, QR 코드)

**백엔드 구현 상태**:

✅ **구현 완료 (20%)**:
- SKU 바코드 추가/제거: `POST/DELETE /wms/inventory/skus/:id/barcodes`
- 스키마에 `skuBarcodes` 테이블 존재

❌ **누락됨 (80%)**:
- 바코드 인쇄 큐 테이블
- 인쇄 작업 관리
- 로케이션 바코드 시스템 (신규 테이블 필요)
- 바코드 생성 서비스 (CODE128/QR)
- 인쇄 큐 API
- 바코드 스캐닝 작업

**필요한 신규 테이블**:
```typescript
// 1. 로케이션 바코드
export const locationBarcodes = pgTable('location_barcodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').references(() => locations.id).notNull(),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull().unique(),
    format: varchar('format', { length: 20 }).default('CODE128'),
    generatedAt: timestamp('generated_at').defaultNow(),
    generatedBy: uuid('generated_by'),
});

// 2. 인쇄 작업
export const barcodePrintJobs = pgTable('barcode_print_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    inboundListId: uuid('inbound_list_id').references(() => inboundLists.id),
    skuId: uuid('sku_id').references(() => skus.id),
    locationId: uuid('location_id').references(() => locations.id),
    barcodeValue: varchar('barcode_value', { length: 64 }).notNull(),
    status: printJobStatusEnum('status').default('pending'),
    printerName: varchar('printer_name', { length: 100 }),
    copies: integer('copies').default(1),
    printedAt: timestamp('printed_at'),
    printedBy: uuid('printed_by'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow(),
});

export const printJobStatusEnum = pgEnum('print_job_status', [
    'pending', 'printing', 'completed', 'failed'
]);
```

**필요한 API**:
```
POST   /wms/barcode/print-jobs           - 인쇄 작업 생성
GET    /wms/barcode/print-jobs           - 큐 목록
PUT    /wms/barcode/print-jobs/:id       - 상태 업데이트
POST   /wms/barcode/generate             - 바코드 이미지 생성
POST   /wms/locations/:id/generate-barcode - 로케이션 바코드 생성
```

**작업량 추정**: 5-7 개발자 일

---

### 5. 판매상품 생성 (Sales Product Creation) - 재고상품 입력

**Figma 요구사항** (스크린샷 2개 분석):
- 다단계 상품 생성 마법사
- 옵션 매트릭스에서 자동 변형 생성
- 상품-SKU 매칭 워크플로
- 다채널 판매 설정
- 반품 정책 관리 (국내 vs 해외)
- 단위/포장 정보
- 변형별 MOQ 추적
- 불변 옵션 구조 (생성 후 편집 불가)

**백엔드 구현 상태**:

✅ **구현 완료 (60%)**:
- PIM 스키마 지원 (상품 마스터, 변형, 옵션)
- 상품 매칭 시스템
- 매칭에서 SKU 생성
- 판매 채널 enum

❌ **누락됨 (40%)**:
- 옵션 매트릭스 UI → 변형 생성 로직
- SKU별 다채널 판매 설정
- 반품 정책 필드 (국내/해외 규칙)
- 포장/단위 정보 필드
- 변형별 MOQ 추적
- 상품-SKU 매칭 마법사 API
- 판매 채널 매핑 개선

**필요한 개선사항**:
```typescript
// skus 테이블에 추가:
returnPolicyDomestic: json('return_policy_domestic'),
returnPolicyOverseas: json('return_policy_overseas'),
unitInfo: json('unit_info'), // 포장, 박스 크기 등
moq: integer('moq'), // 변형별 MOQ

// 판매 채널 설정을 위한 신규 테이블
export const skuSalesChannels = pgTable('sku_sales_channels', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    channel: salesChannelEnum('channel').notNull(),
    isActive: boolean('is_active').default(true),
    channelSkuId: varchar('channel_sku_id', { length: 100 }),
    channelProductUrl: varchar('channel_product_url', { length: 500 }),
});
```

**작업량 추정**: 3-4 개발자 일

---

### 6. 재고실사 (Stocktaking) - 상품 위치 이력

**Figma 요구사항** (스크린샷 1개 분석):
- 실제 재고 집계 인터페이스
- 로케이션 및 상품을 위한 바코드 스캐닝
- 불일치 감지 (예상 vs 실제)
- 이벤트 소싱을 통한 자동 조정 생성
- 재고실사 세션 관리
- 집계 라인 추적
- 차이 보고

**백엔드 구현 상태**:

✅ **구현 완료 (0%)**:
- 없음 - 완전히 누락된 기능

❌ **누락됨 (100%)**:
- 재고실사 세션 관리
- 집계 라인 기록
- 불일치 계산
- 자동 조정 생성
- 바코드 스캐닝 통합
- 차이 보고서
- 모든 관련 테이블 및 API

**필요한 신규 테이블**:
```typescript
export const stocktakingStatusEnum = pgEnum('stocktaking_status', [
    'draft', 'in_progress', 'completed', 'cancelled'
]);

export const stocktakingSessions = pgTable('stocktaking_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
    status: stocktakingStatusEnum('status').default('draft'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    startedBy: uuid('started_by'),
    notes: text('notes'),
});

export const stocktakingLines = pgTable('stocktaking_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => stocktakingSessions.id).notNull(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    locationId: uuid('location_id').references(() => locations.id),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    variance: integer('variance'),
    scannedBarcode: varchar('scanned_barcode', { length: 64 }),
    countedAt: timestamp('counted_at'),
    countedBy: uuid('counted_by'),
});

export const stocktakingAdjustments = pgTable('stocktaking_adjustments', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => stocktakingSessions.id).notNull(),
    lineId: uuid('line_id').references(() => stocktakingLines.id).notNull(),
    stockEventId: uuid('stock_event_id').references(() => stockEvents.id),
    adjustmentQuantity: integer('adjustment_quantity').notNull(),
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
});
```

**필요한 API** (완전한 모듈):
```
POST   /wms/stocktaking/sessions          - 세션 생성
GET    /wms/stocktaking/sessions          - 세션 목록
GET    /wms/stocktaking/sessions/:id      - 세션 상세
PUT    /wms/stocktaking/sessions/:id/start - 집계 시작
PUT    /wms/stocktaking/sessions/:id/complete - 세션 완료

POST   /wms/stocktaking/sessions/:id/lines - 집계 라인 추가
PUT    /wms/stocktaking/lines/:id         - 집계 업데이트
POST   /wms/stocktaking/lines/:id/scan    - 바코드 스캔

GET    /wms/stocktaking/sessions/:id/variances - 차이 보고서
POST   /wms/stocktaking/sessions/:id/generate-adjustments - 자동 생성
```

**작업량 추정**: 7-9 개발자 일 (매우 중요한 기능)

---

## 구현 우선순위 매트릭스 (Implementation Priority Matrix)

### 최우선 경로 (Critical Path) - 1단계: 1-3주차
**총 작업량**: 15-20일

1. **안전재고 구현 (Safety Stock Implementation)** (2일) 🔴
   - `skus` 테이블에 `safetyStock` 필드 추가
   - CreateSkuDto 및 UpdateSkuDto 업데이트
   - 유효성 검사 및 기본값 추가
   - 마이그레이션 스크립트

2. **입고 목록 관리 (Inbound Lists Management)** (4-5일) 🔴
   - InboundListController 생성
   - 서비스 메서드 구현
   - 상태 enum 확장
   - 적용/입고 워크플로

3. **재고실사 모듈 (Stocktaking Module)** (7-9일) 🔴
   - 3개의 신규 테이블 생성
   - 전체 CRUD 구현
   - 바코드 스캐닝 통합
   - 차이 감지 및 자동 조정

### 높은 우선순위 (High Priority) - 2단계: 4-6주차
**총 작업량**: 18-22일

4. **SKU 확장 메타데이터 (SKU Extended Metadata)** (5-6일) 🟡
   - 스키마에 30개 이상의 누락된 필드 추가
   - DTO 업데이트
   - 기본값이 포함된 마이그레이션
   - 서비스 레이어 업데이트

5. **다단계 가격 (Multi-tier Pricing)** (3-4일) 🟡
   - 가격 테이블 생성
   - 가격 API 구현
   - 재고현황 조회와 통합

6. **로케이션 관리 개선 (Location Management Enhancement)** (3-4일) 🟡
   - 주/보조 로케이션 필드
   - 이동 추적 테이블
   - 로케이션 이동 API
   - 이력 엔드포인트

7. **바코드 시스템 (Barcode System)** (5-7일) 🟡
   - 인쇄 큐 구현
   - 로케이션 바코드 테이블
   - 생성 서비스 (CODE128/QR)
   - 인쇄 작업 추적

### 중간 우선순위 (Medium Priority) - 3단계: 7-9주차
**총 작업량**: 12-15일

8. **옵션/변형 관리 (Option/Variant Management)** (4-5일) 🟢
   - 일급 엔터티로서의 옵션 CRUD
   - 변형 그룹 연계
   - 옵션별 재고

9. **발주 감사 워크플로 (Purchase Audit Workflow)** (3-4일) 🟢
   - 감사 상태 enum
   - 제출/승인/거부 엔드포인트
   - 감사 이력 추적

10. **담당자 할당 (Manager Assignments)** (2-3일) 🟢
    - 담당자 테이블
    - 할당 API
    - 역할 기반 로직

11. **판매상품 개선 (Sales Product Enhancements)** (3-4일) 🟢
    - 다채널 설정
    - 반품 정책 필드
    - MOQ 추적

### 낮은 우선순위 (Low Priority) - 4단계: 10-12주차
**총 작업량**: 8-10일

12. **고급 필터링 (Advanced Filtering)** (3-4일) 🟢
    - 30개 이상의 필터 조합
    - 성능 최적화
    - 인덱싱된 쿼리

13. **보고 및 내보내기 (Reporting & Export)** (3-4일) 🟢
    - PDF 생성
    - Excel 내보내기
    - 사용자 정의 보고서

14. **테스팅 및 마무리 (Testing & Polish)** (2-3일) 🟢
    - 단위 테스트
    - 통합 테스트
    - 문서화

---

## 데이터베이스 마이그레이션 요약 (Database Migration Summary)

### 필요한 스키마 변경사항 (Schema Changes Required)

**수정할 테이블** (3개):
1. `skus` - 35개 이상의 필드 추가
2. `suppliers` - MOQ/리드타임 필드 추가
3. `purchase_orders` - 감사 워크플로 컬럼 추가

**생성할 신규 테이블** (8개):
1. `sku_variant_pricing` - 다단계 가격
2. `sku_managers` - 인력 할당
3. `sku_location_movements` - 이동 이력
4. `location_barcodes` - 로케이션 바코드 관리
5. `barcode_print_jobs` - 인쇄 큐
6. `stocktaking_sessions` - 재고실사 헤더
7. `stocktaking_lines` - 집계 라인
8. `stocktaking_adjustments` - 자동 조정

**추가/확장할 Enum** (5개):
1. `inbound_status` - 'applied', 'receiving' 추가
2. `po_audit_status` - 신규: draft, pending_audit, approved, rejected
3. `print_job_status` - 신규: pending, printing, completed, failed
4. `stocktaking_status` - 신규: draft, in_progress, completed, cancelled
5. `sku_sales_channels` - 채널 매핑을 위한 확장

---

## API 엔드포인트 요약 (API Endpoint Summary)

**총 필요한 신규 엔드포인트**: ~60개

### 카테고리별:
- **재고현황 (Inventory Status)**: 8개의 신규 엔드포인트
- **SKU 관리 (SKU Management)**: 20개 이상의 신규 엔드포인트 (옵션, 가격, 담당자, 로케이션)
- **입고 목록 (Inbound Lists)**: 5개의 중요 엔드포인트
- **바코드 관리 (Barcode Management)**: 6개의 신규 엔드포인트
- **재고실사 (Stocktaking)**: 10개 이상의 신규 엔드포인트 (완전한 모듈)
- **발주 감사 (Purchase Audit)**: 3개의 신규 엔드포인트
- **판매상품 (Sales Product)**: 4개의 개선 엔드포인트
- **보고 (Reporting)**: 4개의 내보내기 엔드포인트

---

## 위험 평가 (Risk Assessment)

### 높은 위험 영역 🔴

1. **안전재고 누락 (Safety Stock Missing)**: UI에서 필수로 처리하지만 필드가 존재하지 않음
   - **영향**: 데이터 무결성 문제, UI 오류
   - **완화 방안**: 기본값이 포함된 필드 추가, 모든 DTO 업데이트

2. **재고실사 완전 누락 (Stocktaking Completely Missing)**: 중요한 운영 기능
   - **영향**: 실제 재고 집계를 수행할 수 없음
   - **완화 방안**: 1단계에서 우선순위 지정, 시니어 개발자 배정

3. **상태 Enum 불일치 (Status Enum Mismatches)**: UI에 표시되지만 백엔드에 없는 상태
   - **영향**: 상태 전환이 실패함
   - **완화 방안**: 마이그레이션과 함께 신중하게 enum 확장

### 중간 위험 영역 🟡

4. **중대한 변경사항 (Breaking Changes)**: SKU 스키마에 35개 이상의 필드 추가
   - **영향**: 기존 API가 중단될 수 있음
   - **완화 방안**: 신중한 마이그레이션, 하위 호환성

5. **성능 (Performance)**: 대용량 데이터셋에서 30개 이상의 필터 조합
   - **영향**: 느린 쿼리, 나쁜 UX
   - **완화 방안**: 적절한 인덱싱, 페이지네이션, 캐싱

### 낮은 위험 영역 🟢

6. **선택적 개선사항 (Optional Enhancements)**: 보고, 내보내기, 고급 기능
   - **영향**: 있으면 좋은 기능
   - **완화 방안**: 후반 단계에서 구현

---

## 테스팅 요구사항 (Testing Requirements)

### 단위 테스트 (Unit Tests) (예상: 3-4일)
- 모든 신규 서비스 메서드
- Enum 유효성 검사 로직
- 비즈니스 규칙 강제
- ~150개의 신규 테스트 케이스

### 통합 테스트 (Integration Tests) (예상: 2-3일)
- 완전한 워크플로 (장바구니 → 발주서 → 입고 → 수령)
- 상태 전환 검증
- 이벤트 소싱 무결성
- 트랜잭션 롤백 시나리오
- ~40개의 테스트 시나리오

### E2E 테스트 (E2E Tests) (예상: 2일)
- UI 중요 경로
- 바코드 스캐닝 워크플로
- 재고실사 완전한 사이클
- ~20개의 테스트 플로우

---

## 작업량 요약 (Effort Summary)

| 단계 | 기능 | 개발자 일 | 주 |
|-------|----------|----------------|-------|
| **1단계 (최우선)** | 안전재고, 입고 목록, 재고실사 | 15-20일 | 3주 |
| **2단계 (높음)** | SKU 메타데이터, 가격, 로케이션, 바코드 | 18-22일 | 3-4주 |
| **3단계 (중간)** | 옵션, 감사, 담당자, 판매 | 12-15일 | 2-3주 |
| **4단계 (낮음)** | 필터링, 보고서, 테스팅 | 8-10일 | 2주 |
| **합계** | 모든 기능 | **53-67일** | **10-12주** |

**가정사항**:
- 시니어 백엔드 개발자 1명 풀타임
- 주요 장애물이나 범위 변경이 없다고 가정
- 테스팅 시간은 각 단계에 포함됨
- 문서화는 전체 기간 동안 지속적으로 진행

---

## 권장사항 (Recommendations)

### 즉시 조치사항 (Immediate Actions) - 이번 주

1. ✅ **안전재고 필드 추가 (Add Safety Stock Field)**
   ```sql
   ALTER TABLE skus ADD COLUMN safety_stock INTEGER DEFAULT 0 NOT NULL;
   ```

2. ✅ **재고실사 테이블 생성 (Create Stocktaking Tables)**
   - 3개의 신규 테이블에 대한 마이그레이션 실행
   - 기본 CRUD 작업 설정

3. ✅ **입고 목록 컨트롤러 구현 (Implement Inbound Lists Controller)**
   - 컨트롤러 파일 생성
   - 5개의 중요 엔드포인트 추가
   - 상태 enum 확장

### 단기 (Short-Term) - 향후 2주

4. **SKU 스키마 확장 (Extend SKU Schema)**
   - 마이그레이션과 함께 30개 이상의 누락된 필드 추가
   - 모든 DTO 업데이트
   - 유효성 검사 로직 추가

5. **바코드 시스템 (Barcode System)**
   - 인쇄 큐 구현
   - 로케이션 바코드 테이블 추가
   - 생성 서비스 생성

### 중기 (Medium-Term) - 3-6주차

6. **옵션/변형 관리 (Option/Variant Management)**
   - 일급 옵션 엔터티
   - 변형 그룹화
   - 옵션별 재고

7. **다단계 가격 (Multi-tier Pricing)**
   - 가격 테이블
   - 가격 이력
   - 재고 조회와 통합

### 장기 (Long-Term) - 7-12주차

8. **고급 기능 (Advanced Features)**
   - 복잡한 필터링
   - 보고 및 내보내기
   - 감사 워크플로
   - 성능 최적화

---

## 결론 (Conclusion)

Figma 디자인은 **~55%의 구현 격차**가 있는 종합적인 재고 관리 시스템을 보여줍니다. 가장 중요한 누락 항목은 다음과 같습니다:

1. **안전재고 (Safety Stock)** (UI에서 필수, 백엔드에 누락)
2. **재고실사 모듈 (Stocktaking Module)** (100% 누락, 운영상 매우 중요)
3. **입고 목록 관리 (Inbound Lists Management)** (UI 완료, 백엔드 없음)
4. **확장된 SKU 메타데이터 (Extended SKU Metadata)** (35개 이상의 필드 누락)

**10-12주**의 예상 작업량은 전담 시니어 개발자를 가정하며 위에 설명된 단계별 접근 방식을 따릅니다. 최우선 경로 항목(안전재고, 재고실사, 입고 목록)에 초기 집중하면 프론트엔드 팀의 작업이 차단되지 않고 핵심 비즈니스 운영이 가능해집니다.

---

**문서 참조 (Document References)**:
- 이 검토 중 생성된 상세 분석 파일:
  - `/docs/figma-design-verification.md` - 재고현황 및 입고 분석
  - 추가 에이전트 보고서 (SKU 관리, 바코드, 재고실사)

**검토한 백엔드 소스 파일 (Backend Source Files Reviewed)**:
- `/apps/wms/database/schemas/wms-schema.ts` - 스키마 정의
- `/apps/wms/src/inventory/controllers/inventory.controller.ts` - 현재 API
- `/apps/wms/src/inventory/dto/sku/create-sku.dto.ts` - DTO 제한사항
- `/apps/wms/src/inbound/controllers/purchase-order.controller.ts` - 발주 API

**분석한 Figma 스크린샷 (Figma Screenshots Analyzed)**: `/almondyoung-figma-png/inventory/` 폴더의 17개 파일
