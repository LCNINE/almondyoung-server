# Figma 디자인 UI 요구사항 분석

본 문서는 Almondyoung 재고 관리 시스템을 위한 Figma 디자인 스크린샷에서 추출한 UI 요구사항에 대한 포괄적인 분석을 제공합니다.

## 목차
1. [화면 1: 판매 상품 생성 양식 (Part 1)](#화면-1-판매-상품-생성-양식-part-1)
2. [화면 2: 판매 상품 생성 양식 (Part 2)](#화면-2-판매-상품-생성-양식-part-2)
3. [화면 3: 발주 조회 (도매 목록)](#화면-3-발주-조회-도매-목록)
4. [화면 4: 발주 카트 조회](#화면-4-발주-카트-조회)
5. [API 엔드포인트 요약](#api-엔드포인트-요약)
6. [데이터베이스 스키마 정렬](#데이터베이스-스키마-정렬)

---

## 화면 1: 판매 상품 생성 양식 (Part 1)

**파일:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/create-sales-product-form-1.png`

### 화면 목적
옵션, 가격 및 생산 정보를 포함한 포괄적인 상품 정보로 새로운 판매 상품 생성 (판매상품 생성)

### 양식 필드

#### 기본 상품 정보 섹션

| 필드명 (한국어) | 필드명 (영어) | 유형 | 필수 | 검증 규칙 | 비고 |
|---------------------|----------------------|------|----------|------------------|-------|
| 상품 구분 | Product Type | 드롭다운/선택 | Yes | - | 옵션: 상품 구분 |
| 사업자명칭 | Business Name | 텍스트 | No | - | 플레이스홀더: 사업자명칭 선택 |
| 공급사(업체주체) | Supplier | 드롭다운 | Yes | - | 여러 옵션 |
| 수입신고필 | Import Declaration | 드롭다운 | No | - | 플레이스홀더: 의뢰인 |
| 수입신고번호 | Import Declaration Number | 텍스트 | No | - | - |
| 분류 | Category | 텍스트 | No | - | 검색/필터 기능 포함 |

#### 옵션 관리 섹션 (옵션)

| 필드 | 유형 | 필수 | 비고 |
|-------|------|----------|-------|
| 번호 | 번호 | 자동 | 행 번호 (1-4 표시) |
| 옵션상세명칭 | 텍스트 | Yes | 형식: "JXJ3775mm" 플레이스홀더 |
| 옵션상세이미지 | 이미지 | No | 이미지 업로드 버튼 |
| 판가 | 숫자 | Yes | KRW 단위 판매 가격 |

**옵션 컨트롤:**
- 옵션 행 추가 버튼 (+ 버튼)
- 옵션 행 삭제 버튼 (휴지통 아이콘)
- 기본 4개 행 표시
- 동적 행 추가 지원

#### 생산 정보 섹션 (상품설명)

| 필드명 | 유형 | 필수 | 최대 길이 | 비고 |
|------------|------|----------|------------|-------|
| MOQ | 숫자 | No | - | 최소 주문 수량 |
| 제조1 | 텍스트 | No | - | 제조 정보 1 |
| 제조2 | 텍스트 | No | - | 제조 정보 2 |
| 제조3 | 텍스트 | No | - | 제조 정보 3 |

#### 액션 버튼
- **자동 생성 버튼** (자동 생성 버튼) - 주황색/노란색 기본 액션 버튼
- 취소/뒤로 네비게이션 사용 가능

### 다단계 양식 플로우
이것은 상품 생성 프로세스의 **2단계 중 1단계**로 보입니다.

### 오른쪽 패널 - 프로세스 가이드라인

오른쪽 패널은 세 가지 주요 섹션을 보여줍니다:

1. **제고 생성(자동)** (재고 생성 - 자동)
   - 자동화된 재고 생성 설명
   - 하위 프로세스 목록

2. **상품 매칭** (상품 매칭)
   - 상품 매칭 기준
   - 매칭 전략

3. **수발주구분 select box** (구매/주문 분류)
   - 선택 옵션 목록 (상품/거래/거래처적정)
   - 공급처 관리 링크

4. **출처** (출처)
   - 출처 확인 정보

5. **수입신고필/분조** (수입 신고)
   - 수입 신고 요구사항

---

## 화면 2: 판매 상품 생성 양식 (Part 2)

**파일:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/create-sales-product-form-2.png`

### 화면 목적
템플릿 옵션 및 가격 전략 구성을 보여주는 상품 생성의 두 번째 단계

### 템플릿 선택 섹션 (판매 생성 템플릿 선택)

여러 템플릿 선택 카드 정보 표시:

#### 템플릿 정보 표시
각 템플릿 카드에는 다음이 포함됩니다:
- **제목**: 템플릿 이름
- **설명**: 간단한 설명
- **세부정보**: 2-3줄의 사양
- **액션 버튼**: "적용하기" (적용) 버튼

### 가격 전략 섹션 (제고생성)

라디오 선택이 있는 두 가지 옵션 표시:

#### 옵션 1: 특송
- **옵션 유형**: 라디오 버튼
- **표시 형식**: 변형 그리드/목록
- **하위 옵션**:
  - "노랑: 현장 결제 선택시 새롭 (Size M & Others)"
  - 가격이 있는 여러 항목

#### 옵션 2: 옵션 없이 판매시세
- 옵션 없는 간단한 옵션
- 옵션 차별화 없는 단일 상품

### 상품 세부사항 섹션 (제고상장)

미리보기 테이블 표시:

| 컬럼 | 유형 | 비고 |
|--------|------|-------|
| 품목 | 텍스트 | 상품명 |
| 제고명분 | 텍스트 | 재고명 |
| 공급처 | 텍스트 | 공급처 |

### 하단 섹션 - 템플릿 예제

여러 템플릿 구성 예제 표시:
- 사양이 있는 템플릿 카드
- 구성 세부사항
- 각 템플릿에 대한 적용 버튼

### 액션 버튼
- **제고 생성 버튼** (재고 생성) - 기본 액션
- **이전 단계로** (이전 단계) - 네비게이션
- **제조시장 단계** (제조 단계) - 네비게이션

---

## 화면 3: 발주 조회 (도매 목록)

**파일:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/purchase-inquery.png`

### 화면 목적
필터링 기능으로 도매 상품 조회 (발주리스트 조회)

### 네비게이션 및 브레드크럼
- **경로**: 홈 > 제고/상품 > 발주 > 발주리스트 조회
- **제목**: 재고&상품 (재고 및 상품)

### 검색 및 필터 섹션

#### 필터 필드

| 필드명 (한국어) | 필드명 (영어) | 유형 | 옵션 | 비고 |
|---------------------|----------------------|------|---------|-------|
| 발자 | Requester | 드롭다운 | 발주 번호 옵션 | 요청자로 검색 |
| 검색항목 | Search Category | 드롭다운 | 품목 명칭 옵션 | 카테고리 드롭다운 |
| 신청시점 | Application Time | 드롭다운 | 발주 일자와 신매 옵션 | 시간 범위 |
| | Start Date | Date Picker | - | 2025-06-20 형식 |
| | End Date | Date Picker | - | 2025-06-20 형식 |

**빠른 필터 탭:**
- 오늘 (오늘)
- 어제 (어제)
- 일주일 (일주일)
- 전월 (지난달)
- 3개월 (3개월)
- 접수기간 (수신 기간)

**액션 버튼:**
- **검색** (검색) - 기본 버튼 (주황색)
- 일괄 액션 버튼
- 내보내기 옵션

### 상품 목록 테이블

#### 테이블 컬럼

| 컬럼명 (한국어) | 컬럼명 (영어) | 유형 | 정렬 가능 | 비고 |
|---------------------|----------------------|------|----------|-------|
| 제조 | Checkbox | 체크박스 | No | 다중 선택 |
| 배조드 번호 | Barcode Number | 텍스트 | Yes | 상품 바코드 |
| | Image | 이미지 | No | 상품 썸네일 |
| 이미지 | Product Name | 링크 | Yes | 클릭 가능한 이름 |
| 상품명 | | | | |
| 발주처 | Supplier | 텍스트 | Yes | 공급처명 |
| 발주 날짜 | Order Date | 날짜 | Yes | 형식: 2025-07-29 |
| 알고리즘일 | Algorithm Date | 날짜 | Yes | 형식: 2025-07-30 |
| 판가 | Selling Price | 숫자 | Yes | 형식: 2,200원 |
| 발주 수량 | Order Quantity | 숫자 | Yes | 정수 |
| 발주상태명 | Status | 뱃지 | Yes | 상태: 미발주/진행중/완료 |
| 입고검수명 | Inspection Status | 뱃지 | Yes | 상태 표시기 |
| 기능 | Actions | 버튼 그룹 | No | 사본/발주수정/입고검 버튼 |

#### 행 액션
각 행에는 세 개의 액션 버튼이 있습니다:
- **사본** (복사) - 행 데이터 복사
- **발주 수정** (주문 편집) - 주문 편집
- **입고 검** (검수) - 검수 액션

#### 페이지네이션
- 표시: "레이지생이다" (페이지네이션 표시기)
- 총 개수 표시

### 오른쪽 패널 - 프로세스 정보

섹션이 있는 확인 체크리스트 표시:

1. **발주리스트 확인** (발주 목록 확인)
   - 확인 워크플로우 세부사항
   - 단계별 프로세스

2. **일고리스트 아래 발주리스트 확인 및 가능여 수강** (주문 목록 확인)
   - 목록 확인 절차
   - 품질 확인 프로세스

---

## 화면 4: 발주 카트 조회

**파일:** `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/purchase-cart-inquery.png`

### 화면 목적
발주 카트 항목 관리 (발주대기리스트 생성) - 발주 생성을 위해 준비된 항목

### 네비게이션
- **경로**: 홈 > 제고/상품 > 발주 > 발주리스트 생성
- **제목**: 재고&상품 (재고 및 상품)

### 알림/공지 배너
**빨간색 배경 경고 배너:**
- 텍스트: "안정재고 미만 상품 50개" (안전 재고 미만 50개 항목)
- 상단에 눈에 띄게 표시

### 필터 섹션

| 필드 | 유형 | 옵션 | 비고 |
|-------|------|---------|-------|
| 검색항목 | 드롭다운 | 검색 종류 | 검색 카테고리 |
| 신청시점 | 드롭다운 | 발주 일자 | 신청 시간 |

**액션 버튼:**
- 기본 검색 버튼 (주황색)
- "+ 발주 상품 추가" (발주 상품 추가) - 보조 액션 버튼

### 카트 항목 테이블

#### 테이블 구조

| 컬럼명 (한국어) | 컬럼명 (영어) | 유형 | 편집 가능 | 비고 |
|---------------------|----------------------|------|----------|-------|
| 제조 | Checkbox | 체크박스 | No | 다중 선택 |
| 배조드 번호 | Barcode Number | 텍스트 | No | 상품 식별자 |
| | Image | 이미지 | No | 상품 썸네일 |
| 이미지 | Product Name | 링크 | No | 상품 세부사항 |
| 상품명 | | | | |
| 상품명 | Category | 텍스트 | No | - |
| 재고/공급처계 | Inventory Status | 숫자 | No | 현재 재고/공급 |
| 제조 | Supplier | 텍스트 | No | - |
| 신청수량 | Requested Quantity | 텍스트 | Yes | 드롭다운/입력 |
| 발주계획 | Order Plan | 날짜 | Yes | 날짜 선택기 |
| 인고예상일 | Expected Arrival | 날짜 | No | 계산된 날짜 |
| 기능 | Actions | 버튼 그룹 | No | 액션 버튼 |

#### 특수 기능

1. **편집 가능한 수량 필드**
   - 유형: 수동 입력이 있는 드롭다운
   - 현재 값 표시
   - 주문 생성 전 조정 허용

2. **날짜 선택기 통합**
   - 주문 계획 날짜 선택
   - 예상 도착 자동 계산

3. **행 액션**
각 행에는 액션 버튼이 있습니다:
- **발주** (주문) - 발주 생성
- **수정** (편집) - 카트 항목 편집
- **삭제** (삭제) - 카트에서 제거

### 하단 모달 - 일괄 항목 추가

**모달 제목:** "발주 상품 추가" (발주 상품 추가)

#### 모달 양식 필드

| 필드 | 유형 | 필수 | 비고 |
|-------|------|----------|-------|
| 상품구분 | 드롭다운 | Yes | 상품 카테고리 (내품 / 판매) |
| 공급처 | 드롭다운 | Yes | 공급처 선택 (공급업 선택) |
| 검색항목 | 드롭다운 | No | 검색 필터 (품목 인건) |

#### 모달 결과 테이블

| 컬럼 | 유형 | 비고 |
|--------|------|-------|
| 제조드 | 체크박스 | 다중 선택 |
| 이미지 | 이미지 | 상품 썸네일 |
| 상품명 | 텍스트 | 상품명 |
| 상품명 | 텍스트 | 카테고리 |
| 재고 | 숫자 | 현재 재고 |
| 신청수량 | 입력 | 수량 입력 |
| 입고예상일 | 날짜 | 예상 도착 |

**모달 액션:**
- **담기** (카트에 추가) - 기본 버튼 (주황색)
- 모달 닫기 (X 버튼)

### 페이지네이션
- 텍스트: "상품정보 총 1개" (총 1개 상품)
- 네비게이션 컨트롤

---

## API 엔드포인트 요약

UI 요구사항과 기존 코드베이스 구조를 기반으로 다음 API 엔드포인트가 필요합니다:

### 상품 마스터 (PIM 서비스)

#### 기존 엔드포인트 (이미 구현됨)
```
POST   /masters                          # 상품 마스터 생성
GET    /masters                          # 필터로 상품 마스터 목록
GET    /masters/:id                      # 마스터 세부사항 가져오기
PUT    /masters/:id                      # 마스터 업데이트
DELETE /masters/:id                      # 마스터 삭제
GET    /masters/:id/price-preview       # 가격 미리보기
PUT    /masters/:id/pricing              # 가격 전략 변경
```

### 발주 (WMS 서비스)

#### 기존 엔드포인트 (이미 구현됨)
```
POST   /wms/purchase-orders                    # 발주 생성
POST   /wms/purchase-orders/from-cart         # 카트 항목에서 PO 생성
GET    /wms/purchase-orders                    # 발주 목록
GET    /wms/purchase-orders/:id                # PO 세부사항 가져오기
PUT    /wms/purchase-orders/:id/status         # PO 상태 업데이트
```

#### 카트 관리 (이미 구현됨)
```
POST   /wms/purchase-orders/cart               # 카트에 항목 추가
GET    /wms/purchase-orders/cart               # 카트 항목 가져오기
PUT    /wms/purchase-orders/cart/:itemId       # 카트 항목 업데이트
DELETE /wms/purchase-orders/cart/:itemId       # 카트 항목 제거
DELETE /wms/purchase-orders/cart               # 카트 비우기
```

#### 재고 제안 (이미 구현됨)
```
GET    /wms/purchase-orders/suggestions/reorder  # 재주문 제안 가져오기
```

### 추가 필요 엔드포인트

#### 템플릿 관리 (신규 - PIM 서비스)
```
GET    /masters/templates                      # 상품 생성 템플릿 가져오기
POST   /masters/from-template                  # 템플릿에서 상품 생성
GET    /masters/templates/:id                  # 템플릿 세부사항 가져오기
```

#### 향상된 필터링 (개선 - WMS 서비스)
```
GET    /wms/purchase-orders?
       status=<status>&
       type=<type>&
       supplierId=<uuid>&
       startDate=<date>&
       endDate=<date>&
       search=<query>&
       limit=<number>&
       offset=<number>
```

#### 일괄 작업 (신규 - WMS 서비스)
```
POST   /wms/purchase-orders/bulk/create        # 일괄 PO 생성
PUT    /wms/purchase-orders/bulk/status        # 일괄 PO 상태 업데이트
POST   /wms/purchase-orders/cart/bulk/add      # 일괄 카트에 추가
```

#### 공급처 관리 (개선 - WMS 서비스)
```
GET    /wms/suppliers                          # 공급처 목록
GET    /wms/suppliers/:id                      # 공급처 세부사항 가져오기
GET    /wms/suppliers/:id/products             # 공급처 상품 가져오기
```

---

## 데이터베이스 스키마 정렬

### PIM 스키마 (상품 마스터)

#### 현재 스키마 지원

기존 `product_masters` 테이블은 대부분의 UI 요구사항을 지원합니다:

**지원되는 필드:**
- ✅ `name` - 상품명
- ✅ `description` - 상품 설명
- ✅ `brand` - 브랜드 정보
- ✅ `thumbnail` - 썸네일 이미지
- ✅ `base_price` - 기본 가격
- ✅ `pricing_strategy` - 가격 전략 (option_based, variant_based)
- ✅ `tags` - 마케팅 태그
- ✅ `images` (JSONB) - 상품 이미지
- ✅ `attributes` (JSONB) - 사용자 정의 속성
- ✅ `status` - 상품 상태
- ✅ `is_wholesale_only` - 도매 회원 전용 플래그
- ✅ `is_membership_only` - 회원 전용 플래그
- ✅ `membership_price` - 회원 가격
- ✅ `wholesale_price` - 도매 가격

**관련 테이블:**
- ✅ `product_option_groups` - 옵션 그룹
- ✅ `product_option_values` - 옵션 값
- ✅ `product_variants` - 상품 변형
- ✅ `variant_option_values` - 변형-옵션 매핑
- ✅ `option_value_prices` - 옵션 기반 가격
- ✅ `variant_prices` - 변형 기반 가격

**누락 지원:**
- ❌ 수입 신고 필드 (import_declaration_number, customs_clearance_status)
- ❌ MOQ (최소 주문 수량) - 속성 JSONB 사용 가능
- ❌ 제조 정보 필드 (제조1, 제조2, 제조3) - 속성 JSONB 사용 가능
- ❌ 템플릿 시스템 - 새 테이블 필요

### WMS 스키마 (발주)

#### 현재 스키마 지원

**발주 테이블 구조 (DTO에서 추론):**

```typescript
// purchase-order.dto.ts에서
interface PurchaseOrder {
  id: string;
  type: 'domestic' | 'foreign';
  supplierId: string | null;
  expectedArrival: Date | null;
  status: 'created' | 'confirmed' | 'received';
  destinationWarehouseId: string;
  createdAt: Date;
  updatedAt: Date;
  lines: PurchaseOrderLine[];
}

interface PurchaseOrderLine {
  skuId: string;
  quantity: number;
  unitPrice: number | null;
}

interface CartItem {
  id: string;
  skuId: string;
  quantity: number;
  type: 'domestic' | 'foreign';
  supplierInfo: any;
  createdAt: Date;
  updatedAt: Date;
}
```

**지원되는 기능:**
- ✅ 발주 생성
- ✅ 주문 상태 추적
- ✅ SKU 및 수량이 있는 주문 라인
- ✅ 공급처 연결
- ✅ 예상 도착 날짜
- ✅ 카트/스테이징 기능
- ✅ 국내/해외 유형 구분

**누락 기능:**
- ❌ 검색/필터 메타데이터 (인덱스 필요)
- ❌ 일괄 작업 지원
- ❌ 알고리즘 날짜 필드 (알고리즘일)
- ❌ 검수 상태 추적
- ❌ 안전 재고 경고 임계값

### 권장 스키마 추가

#### 1. 상품 템플릿 테이블 (PIM)

```sql
CREATE TABLE product_templates (
  id UUID PRIMARY KEY DEFAULT uuid_v7(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_config JSONB NOT NULL,  -- 템플릿 구성
  category_id UUID REFERENCES product_categories(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. 향상된 상품 마스터 (PIM)

`product_masters` 테이블에 추가하거나 `attributes` JSONB 사용:

```sql
ALTER TABLE product_masters
ADD COLUMN moq INTEGER,  -- 최소 주문 수량
ADD COLUMN import_declaration VARCHAR(100),  -- 수입 신고 번호
ADD COLUMN manufacturing_info JSONB;  -- 제조 세부사항
```

#### 3. 발주 개선 (WMS)

이 필드들의 존재 확인:

```sql
-- 누락된 경우 purchase_orders에 추가
ALTER TABLE purchase_orders
ADD COLUMN search_text TEXT,  -- 전문 검색용
ADD COLUMN algorithm_date DATE,  -- 알고리즘일
ADD COLUMN inspection_status VARCHAR(50),  -- 검수 상태
ADD COLUMN notes TEXT;  -- 추가 메모

-- 필터링용 인덱스 추가
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_type ON purchase_orders(type);
CREATE INDEX idx_po_dates ON purchase_orders(created_at, expected_arrival);
CREATE INDEX idx_po_search ON purchase_orders USING gin(to_tsvector('korean', search_text));
```

#### 4. 카트 개선 (WMS)

```sql
-- 카트 테이블에 이 필드들이 있는지 확인
ALTER TABLE purchase_cart_items
ADD COLUMN expected_arrival DATE,  -- 예상 도착 계산
ADD COLUMN order_plan_date DATE,  -- 계획된 주문 날짜
ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';  -- 우선순위 플래그
```

---

## 데이터 관계 및 워크플로우

### 워크플로우 1: 판매 상품 생성 (화면 1 & 2)

**단계:**
1. 사용자가 기본 상품 정보 입력 (화면 1)
   - 상품 유형, 공급처, 카테고리
   - 이미지 및 가격이 있는 옵션 세부사항
   - 생산 정보 (MOQ, 제조)

2. 사용자가 템플릿 또는 가격 전략 선택 (화면 2)
   - 템플릿 선택 (사용 가능한 경우)
   - 가격 전략 선택 (옵션 기반 또는 변형 기반)
   - 옵션 가격 구성

3. 시스템 생성:
   - 상품 마스터 레코드
   - 옵션 그룹 및 값
   - 상품 변형 (옵션 조합 기반)
   - 옵션/변형 가격 (전략 기반)
   - 상품 이미지 연결

**API 호출 순서:**
```
POST /masters
  {
    name: "Product Name",
    basePrice: 10000,
    pricingStrategy: "option_based",
    optionGroups: [
      {
        name: "size",
        displayName: "사이즈",
        values: [
          { value: "S", displayName: "Small", price: 0 },
          { value: "M", displayName: "Medium", price: 1000 }
        ]
      }
    ]
  }
```

### 워크플로우 2: 발주 검색 (화면 3)

**단계:**
1. 사용자가 필터 적용
   - 날짜 범위 (오늘, 어제, 주, 등)
   - 공급처
   - 검색어
   - 상태

2. 시스템이 필터로 발주 조회
3. 다음과 함께 페이지네이션된 결과 표시:
   - 상품 썸네일
   - 공급처 정보
   - 주문 날짜
   - 상태 뱃지
   - 액션 버튼

**API 호출:**
```
GET /wms/purchase-orders?
  status=created&
  startDate=2025-06-20&
  endDate=2025-06-20&
  supplierId=<uuid>&
  limit=50&
  offset=0
```

### 워크플로우 3: 발주 카트 관리 (화면 4)

**단계:**
1. 안전 재고 경고와 함께 카트 항목 보기
2. 카트에 항목 추가:
   - 카테고리/공급처로 상품 검색
   - 상품 선택
   - 수량 설정
   - 카트 스테이징 영역에 추가

3. 카트 항목 편집:
   - 수량 조정
   - 주문 계획 날짜 설정
   - 예상 도착 업데이트

4. 카트에서 발주 생성:
   - 카트 항목 선택
   - 공급처별 그룹화
   - 라인이 있는 PO 생성

**API 호출 순서:**
```
# 안전 재고 경고 가져오기
GET /wms/purchase-orders/suggestions/reorder

# 카트에 추가
POST /wms/purchase-orders/cart
  {
    skuId: "uuid",
    quantity: 10,
    type: "domestic",
    supplierInfo: {...}
  }

# 카트 항목 가져오기
GET /wms/purchase-orders/cart?type=domestic

# 카트에서 PO 생성
POST /wms/purchase-orders/from-cart
  {
    cartItemIds: ["uuid1", "uuid2"],
    supplierId: "uuid",
    expectedArrival: "2025-07-30",
    destinationWarehouseId: "uuid"
  }
```

---

## 필드 매핑 참조

### 화면 1 필드 매핑

| UI 필드 (한국어) | 데이터베이스 필드 | 테이블 | 유형 | 비고 |
|------------------|----------------|-------|------|-------|
| 상품 구분 | attributes.product_type | product_masters | JSONB | 사용자 정의 속성 |
| 사업자명칭 | attributes.business_name | product_masters | JSONB | 사용자 정의 속성 |
| 공급사 | supplier_id | skus (via sku_suppliers) | UUID | 외래 키 |
| 수입신고필 | attributes.import_declaration | product_masters | JSONB | 사용자 정의 속성 |
| 수입신고번호 | attributes.import_declaration_number | product_masters | JSONB | 신규 필드 |
| 분류 | category_id | product_master_categories | UUID | 다대다 |
| 옵션상세명칭 | value / display_name | product_option_values | VARCHAR | - |
| 옵션상세이미지 | images | product_variants | JSONB | 변형 이미지 |
| 판가 | price | option_value_prices / variant_prices | BIGINT | 전략 기반 |
| MOQ | attributes.moq | product_masters | JSONB | 또는 전용 컬럼 |
| 제조1-3 | attributes.manufacturing_info | product_masters | JSONB | 배열 구조 |

### 화면 3 필드 매핑

| UI 필드 (한국어) | 데이터베이스 필드 | 테이블 | 유형 | 비고 |
|------------------|----------------|-------|------|-------|
| 배조드 번호 | barcode / default_barcode | skus / sku_barcodes | VARCHAR | - |
| 이미지 | thumbnail | product_masters | TEXT | 이미지 URL |
| 상품명 | name | product_masters (via SKU) | VARCHAR | - |
| 발주처 | name | suppliers | VARCHAR | supplier_id를 통해 |
| 발주 날짜 | created_at | purchase_orders | TIMESTAMP | - |
| 알고리즘일 | algorithm_date | purchase_orders | DATE | 신규 필드 |
| 판가 | unit_price | purchase_order_lines | BIGINT | 라인 항목 가격 |
| 발주 수량 | quantity | purchase_order_lines | INTEGER | - |
| 발주상태명 | status | purchase_orders | ENUM | created/confirmed/received |
| 입고검수명 | inspection_status | purchase_orders | VARCHAR | 신규 필드 |

### 화면 4 필드 매핑

| UI 필드 (한국어) | 데이터베이스 필드 | 테이블 | 유형 | 비고 |
|------------------|----------------|-------|------|-------|
| 배조드 번호 | default_barcode | skus | VARCHAR | - |
| 이미지 | thumbnail | product_masters | TEXT | master_id를 통해 |
| 상품명 | name | skus | VARCHAR | - |
| 재고/공급처계 | - | 계산됨 | NUMBER | stock_summary에서 |
| 제조 | name | suppliers | VARCHAR | sku_suppliers를 통해 |
| 신청수량 | quantity | purchase_cart_items | INTEGER | 편집 가능 |
| 발주계획 | order_plan_date | purchase_cart_items | DATE | 사용자 입력 |
| 인고예상일 | expected_arrival | purchase_cart_items | DATE | 계산됨 |

---

## 검증 규칙

### 상품 생성 검증

1. **필수 필드:**
   - 상품명 (name)
   - 기본 가격 (base_price)
   - 가격 전략 (pricing_strategy)
   - 최소 하나의 옵션 그룹 (option_based 전략인 경우)

2. **옵션 검증:**
   - 옵션 그룹 이름은 마스터당 고유해야 함
   - 옵션 값은 그룹 내에서 고유해야 함
   - 옵션 가격은 음수가 아니어야 함
   - 그룹당 최소 하나의 옵션 값

3. **가격 검증:**
   - 기본 가격 > 0
   - 회원 가격 < 기본 가격 (설정된 경우)
   - 도매 가격 < 회원 가격 (설정된 경우)
   - 옵션 조정 가격은 음수 가능

### 발주 검증

1. **필수 필드:**
   - 주문 유형 (국내/해외)
   - 공급처 ID
   - 목적지 창고 ID
   - 최소 하나의 라인 항목

2. **라인 항목 검증:**
   - SKU ID가 존재해야 함
   - 수량 > 0
   - 단가 >= 0 (null 가능)

3. **카트 검증:**
   - SKU가 카트에 이미 없어야 함 (또는 수량 업데이트 허용)
   - 수량은 설정된 경우 MOQ를 준수해야 함
   - 예상 도착은 >= 오늘 + 리드 타임

---

## UI 컴포넌트 요구사항

### 재사용 가능한 필요 컴포넌트

1. **상품 검색/필터 컴포넌트**
   - 다중 필드 검색
   - 프리셋이 있는 날짜 범위 선택기
   - 카테고리/공급처 드롭다운
   - 빠른 필터 버튼

2. **데이터 테이블 컴포넌트**
   - 정렬 가능한 컬럼
   - 체크박스 다중 선택
   - 인라인 편집 (수량용)
   - 행당 액션 버튼 그룹
   - 페이지네이션 컨트롤
   - 일괄 액션 툴바

3. **옵션 매트릭스 빌더**
   - 동적 행 추가/삭제
   - 옵션당 이미지 업로드
   - 옵션당 가격 입력
   - 드래그 앤 드롭 재정렬

4. **템플릿 선택기**
   - 카드 기반 템플릿 표시
   - 미리보기 기능
   - 템플릿당 적용 버튼

5. **상태 뱃지 컴포넌트**
   - 색상 코드 상태 표시기
   - 한국어/영어 레이블 지원
   - 아이콘 지원

6. **모달 컴포넌트**
   - 상품 검색 모달
   - 일괄 추가 모달
   - 확인 대화상자

---

## 상태 관리

### 프론트엔드 상태 요구사항

1. **상품 생성 양식 상태**
   ```typescript
   {
     basicInfo: {
       name: string;
       supplier: string;
       category: string;
       // ...
     },
     options: Array<{
       id: string;
       name: string;
       image: File | null;
       price: number;
     }>,
     productionInfo: {
       moq: number;
       manufacturing: string[];
     },
     step: 1 | 2;
   }
   ```

2. **발주 목록 상태**
   ```typescript
   {
     filters: {
       dateRange: { start: Date; end: Date };
       status: string[];
       supplier: string | null;
       searchTerm: string;
     },
     orders: PurchaseOrder[];
     pagination: {
       page: number;
       limit: number;
       total: number;
     },
     selectedIds: string[];
   }
   ```

3. **카트 상태**
   ```typescript
   {
     items: CartItem[];
     safetyStockWarnings: Array<{
       skuId: string;
       currentStock: number;
       safetyStock: number;
       shortfall: number;
     }>;
     bulkAddModal: {
       isOpen: boolean;
       searchResults: Product[];
       selectedProducts: string[];
     };
   }
   ```

---

## 오류 처리

### 예상 오류 시나리오

1. **상품 생성 오류**
   - 중복 상품명
   - 유효하지 않은 옵션 조합
   - 필수 필드 누락
   - 이미지 업로드 실패
   - 가격 검증 실패

2. **발주 오류**
   - SKU를 찾을 수 없음
   - 불충분한 권한
   - 유효하지 않은 공급처
   - 창고가 활성화되지 않음
   - 수량이 사용 가능한 재고 초과 (특정 시나리오용)

3. **카트 오류**
   - 항목이 이미 카트에 있음
   - SKU를 더 이상 사용할 수 없음
   - 공급처 제약 위반
   - 날짜 검증 오류

### 오류 응답 형식

```typescript
{
  success: false,
  error: {
    code: string;  // ERROR_CODE
    message: string;  // 사용자 친화적인 메시지
    field?: string;  // 오류를 일으킨 필드
    details?: any;  // 추가 컨텍스트
  }
}
```

---

## 성능 고려사항

### 최적화 전략

1. **상품 목록 로딩**
   - 페이지네이션 구현 (기본 50개 항목)
   - 이미지에 대한 지연 로딩 사용
   - 자주 액세스하는 데이터 캐시
   - 검색 필드 인덱싱

2. **옵션 매트릭스**
   - 그룹당 최대 옵션 제한 (예: 50개)
   - 가격 계산 디바운스
   - 모든 키 입력이 아닌 블러 시 검증

3. **카트 작업**
   - 일괄 카트 추가
   - 낙관적 UI 업데이트
   - 백그라운드 동기화

4. **검색 성능**
   - 전문 검색 인덱스
   - 디바운스된 검색 입력
   - 검색 결과 캐싱

---

## 접근성 및 현지화

### 접근성 요구사항

1. **키보드 네비게이션**
   - 양식 필드를 통한 탭 순서
   - Enter로 양식 제출
   - Escape로 모달 닫기

2. **스크린 리더 지원**
   - 모든 입력에 대한 ARIA 레이블
   - 상태 알림
   - 오류 알림

3. **시각적 접근성**
   - 충분한 색상 대비
   - 포커스 표시기
   - 오류 상태가 명확하게 표시됨

### 현지화

현재 지원:
- 한국어 (기본)
- 영어 (보조)

번역이 필요한 필드:
- 모든 UI 레이블
- 오류 메시지
- 상태 표시기
- 도움말 텍스트
- 검증 메시지

---

## 테스트 체크리스트

### UI 테스트

- [ ] 상품 생성 양식 검증
- [ ] 다단계 양식 네비게이션
- [ ] 옵션 매트릭스 동적 행
- [ ] 이미지 업로드 기능
- [ ] 가격 계산 정확도
- [ ] 템플릿 선택 및 적용
- [ ] 프리셋이 있는 날짜 선택기
- [ ] 검색 및 필터 조합
- [ ] 테이블 정렬 및 페이지네이션
- [ ] 카트 CRUD 작업
- [ ] 일괄 작업
- [ ] 모달 상호작용
- [ ] 상태 뱃지 렌더링
- [ ] 오류 메시지 표시
- [ ] 로딩 상태

### API 테스트

- [ ] 옵션이 있는 상품 마스터 생성
- [ ] 상품 마스터 업데이트
- [ ] 상품 마스터 삭제
- [ ] 필터로 상품 목록
- [ ] 상품 세부사항 가져오기
- [ ] 발주 생성
- [ ] PO 상태 업데이트
- [ ] 카트에 추가
- [ ] 카트에서 제거
- [ ] 카트에서 PO 생성
- [ ] 재주문 제안 가져오기
- [ ] 일괄 작업

### 통합 테스트

- [ ] 엔드투엔드 상품 생성 플로우
- [ ] 엔드투엔드 발주 플로우
- [ ] 카트에서 PO로 변환
- [ ] 상품-SKU 관계
- [ ] SKU-공급처 관계
- [ ] 옵션이 있는 가격 계산
- [ ] 재고 수준 업데이트
- [ ] 날짜 검증 및 계산

---

## 구현 우선순위

### Phase 1: 핵심 기능 (높은 우선순위)

1. 상품 생성 양식 (화면 1)
   - 기본 정보 필드
   - 옵션 매트릭스
   - 양식 검증

2. 발주 목록 (화면 3)
   - 필터가 있는 목록 보기
   - 기본 검색
   - 상태 표시

3. 카트 관리 (화면 4)
   - 카트에 추가
   - 카트 보기
   - 카트에서 PO 생성

### Phase 2: 향상된 기능 (중간 우선순위)

1. 템플릿 시스템 (화면 2)
   - 템플릿 생성
   - 템플릿 선택
   - 템플릿 적용

2. 고급 필터링
   - 날짜 범위 프리셋
   - 다중 필드 검색
   - 저장된 필터

3. 일괄 작업
   - 일괄 카트 추가
   - 일괄 PO 생성
   - 일괄 상태 업데이트

### Phase 3: 마무리 및 최적화 (낮은 우선순위)

1. 이미지 최적화
2. 고급 검증
3. 성능 튜닝
4. 접근성 개선
5. 향상된 오류 메시지
6. 분석 및 로깅

---

## 요약

이 분석은 Almondyoung 재고 관리 시스템의 네 가지 주요 화면을 다룹니다:

1. **판매 상품 생성 양식 (Part 1)**: 기본 상품 정보, 옵션 매트릭스, 생산 세부사항
2. **판매 상품 생성 양식 (Part 2)**: 템플릿 선택, 가격 전략 구성
3. **발주 조회 목록**: 검색 가능하고 필터링 가능한 발주 목록
4. **발주 카트 관리**: 일괄 작업이 있는 발주 생성을 위한 스테이징 영역

기존 PIM 및 WMS 스키마는 대부분의 필요한 기능을 지원하며, 다음을 위한 소규모 추가가 필요합니다:
- 템플릿 시스템
- 향상된 검색/필터 메타데이터
- 추가 추적 필드 (알고리즘 날짜, 검수 상태)
- 안전 재고 경고

식별된 모든 API 엔드포인트는 기존 NestJS 컨트롤러 패턴과 일치하며, 대부분 이미 구현되었고 일괄 작업 및 템플릿을 위한 몇 가지 개선이 필요합니다.

---

*최종 업데이트: 2025-10-13*
*분석 기준: `/home/pauseb/workspace/almondyoung-server/almondyoung-figma-png/inventory/`의 Figma 스크린샷*

---
---

# 입고 및 발주 기능 분석 (2025-10-13)

이 섹션은 입고 및 발주 워크플로우 스크린샷을 분석하여 상세한 발견 사항을 제공하며, UI 요구사항과 백엔드 구현을 비교합니다.

[이하 나머지 내용 계속...]



