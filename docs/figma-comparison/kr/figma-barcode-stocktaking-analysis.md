# Figma 디자인 분석: 바코드, 판매 상품 및 재고 조사

본 문서는 바코드 관리, 판매 상품 생성, 재고 조사 기능에 대한 Figma 디자인 스크린샷의 상세 분석을 제공합니다. 백엔드 요구사항, 데이터 모델 및 통합 지점에 중점을 둡니다.

---

## 1. 판매 상품 바코드 관리 (상품 바코드 관리)

**파일**: `almondyoung-figma-png/inventory/barcode-management.png`

### 1.1 페이지 개요
- **목적**: 판매 상품과 연결된 바코드를 조회하고 관리하는 상품 바코드 관리 인터페이스
- **네비게이션 경로**: 재고&상품 > 주입/출고 > 주입/출고 > 주입내역 목록 (브레드크럼에 표시)
- **현재 선택**: 상품 바코드 관리 (Product Barcode Management)

### 1.2 UI 컴포넌트

#### 검색 섹션
- **검색 유형 드롭다운**: "검색항목" (Search Item)
- **검색 값 드롭다운**: "통합 검색" (Integrated Search)
- **검색 입력 필드**: 자유 텍스트 입력
- **검색 버튼**: "검색" (Search) - 주황색/노란색 버튼

#### 필터 옵션
- **필터링 버튼**:
  - "재고 다운로드" (Stock Download)
  - "선택항목 인쇄하기 추가" (Add Selected Items to Print)
  - "인쇄하기 없음 10" (No Print 10)
  - "바코드만 취급생성" (Barcode Only Generate)

#### 데이터 그리드 컬럼
1. **체크박스**: 행 선택
2. **바코드 번호** (Barcode Number): 예: "123059493834"
3. **이미지** (Image): 상품 썸네일 표시 (작은 병 2개 표시)
4. **상품명 버전S1,2** (Product Name Version S1,2):
   - 상품명 표시: "더블 M 논와이오 바이탈 에센 딥영 14ml 2종 (단양-Me와이오 탄영)"
   - 여러 뱃지 태그: "바코드 1", "추항", "바코드 2", "추항", "변동 내역"
5. **위치** (Location): 예: "J-07-36"
6. **발주처** (Supplier): "누누상"
7. **인쇄** (Print): 숫자 입력 필드 (기본값 "10")
8. **인쇄** (Print Action): "인쇄" (Print) 버튼
9. **인쇄 대기** (Print Queue): "인쇄 대기" (Print Queue) 버튼

#### 페이지네이션
- "페이지/페이0" (Page/Page 0) - 하단에 표시

### 1.3 데이터 필드 및 스키마 요구사항

#### 필요한 데이터베이스 테이블
- **테이블**: 기존 `sku_barcodes` 및 `skus` 테이블 확장 가능
- **신규/수정 필드**:
  - 바코드 인쇄 큐 상태
  - 인쇄 수량 추적
  - 버전 추적 (S1, S2 뱃지)
  - 위치 참조 (stock_summary에 이미 존재)

#### 데이터 모델 고려사항
```typescript
// 기존 스키마로 충분하지만 다음이 필요할 수 있음:
interface BarcodePrintJob {
  id: uuid;
  barcodeId: uuid;        // references sku_barcodes.id
  skuId: uuid;            // references skus.id
  printQuantity: integer;
  status: 'pending' | 'printing' | 'completed' | 'failed';
  createdAt: timestamp;
  printedAt: timestamp;
}
```

### 1.4 백엔드 작업
1. **GET /api/wms/inventory/barcodes/list**
   - 다양한 기준으로 바코드 검색/필터링
   - 상품 세부정보, 위치, 공급처 포함
   - 페이지네이션 지원

2. **POST /api/wms/inventory/barcodes/print**
   - 인쇄 큐에 바코드 추가
   - 인쇄 수량 지정

3. **GET /api/wms/inventory/barcodes/print-queue**
   - 대기 중인 인쇄 작업 조회

4. **POST /api/wms/inventory/barcodes/download-stock**
   - 선택한 바코드의 재고 데이터 내보내기

### 1.5 비즈니스 로직
- 바코드는 여러 태그/뱃지(버전 표시기)를 가질 수 있음
- 인쇄 큐 관리 시스템
- 바코드/SKU당 위치 추적
- 공급처 연결
- 일괄 인쇄 기능 (다중 선택, 수량 지정)

### 1.6 통합 지점
- **재고 모듈**: SKU 및 재고 위치 데이터 링크
- **공급처 모듈**: 공급처 정보 표시
- **인쇄 서비스**: 바코드 인쇄 큐 관리
- **위치 모듈**: 현재 창고 위치 표시

---

## 2. 위치 바코드 관리 (위치 바코드 관리)

**파일**: `almondyoung-figma-png/inventory/location-barcode-management.png`

### 2.1 페이지 개요
- **목적**: 창고 위치별 바코드 관리
- **네비게이션**: 위와 동일 (재고&상품 > 주입/출고 > 주입내역 목록)
- **현재 선택**: 위치 바코드 관리 (Location Barcode Management)

### 2.2 UI 컴포넌트

#### 검색 섹션 (상단)
- **왼쪽 입력**: "위치바코드 검색" (Location Barcode Search) 주황색 "검색" 버튼
- **오른쪽 입력**: "위치바코드 입력" (Location Barcode Input) 주황색 "입력" 버튼

#### 탭 네비게이션
- **총 위치 바코드 수 1건** (Total Location Barcodes: 1)
- **탭 1**: "선택된 항목 인쇄" (Print Selected Items)
- **탭 2**: "선택된 항목 삭제" (Delete Selected Items)

#### 데이터 그리드 컬럼
1. **체크박스**: 행 선택
2. **번호** (Number): 순번 (1)
3. **바코드 번호** (Barcode Number): "123059493834"
4. **위치 바코드번호** (Location Barcode Number): "A-01-02"
5. **등록일시** (Registration Date): "2021-04-08 오후 2:33:41"
6. **삭제** (Delete): "삭제" (Delete) 버튼

#### 페이지네이션
- "페이지/페이0" (Page/Page 0)

### 2.3 데이터 필드 및 스키마 요구사항

#### 필요한 데이터베이스 테이블
```typescript
// 신규 테이블: location_barcodes
interface LocationBarcode {
  id: uuid;
  locationId: uuid;           // references locations.id
  barcode: string;            // unique barcode for location
  locationCode: string;       // A-01-02 format
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

#### 기존 테이블 사용
- WMS 스키마의 `locations` 테이블 사용
- 위치 코드 형식: `{Column}-{Rack}-{Bin}` (예: A-01-02)

### 2.4 백엔드 작업
1. **GET /api/wms/locations/barcodes**
   - 모든 위치 바코드 목록
   - 바코드 또는 위치 코드로 검색
   - 페이지네이션

2. **POST /api/wms/locations/barcodes**
   - 위치 바코드 생성
   - 위치에 대한 바코드 생성
   - 위치 존재 확인

3. **DELETE /api/wms/locations/barcodes/:id**
   - 위치 바코드 제거
   - 활성 재고 이동 없음 확인

4. **POST /api/wms/locations/barcodes/print**
   - 선택한 위치 바코드 인쇄
   - 일괄 인쇄 지원

### 2.5 비즈니스 로직
- 각 창고 위치는 전용 바코드를 가질 수 있음
- 위치 바코드는 다음 작업 중 빠른 스캔 가능:
  - 보관(Putaway) 작업
  - 재고 이동
  - 피킹 작업
  - 재고 조사
- 형식: Column-Rack-Bin (A-01-02)
- 생성 후 변경 불가 (필요시 삭제 후 재생성)

### 2.6 통합 지점
- **위치 모듈**: `locations` 테이블에 대한 핵심 의존성
- **입고 모듈**: 보관 스캔 중 사용
- **출고 모듈**: 피킹 위치 확인 중 사용
- **이동 모듈**: 창고 간/내 이전에 사용
- **재고 조사 모듈**: 카운팅 중 위치 확인

---

## 3. 판매 상품 생성 양식 (Part 1)

**파일**: `almondyoung-figma-png/inventory/create-sales-product-form-1.png`

### 3.1 페이지 개요
- **목적**: 포괄적인 양식 필드로 새로운 판매 상품 생성 (재고 생성)
- **양식 유형**: 상단 탭이 있는 다단계 양식
- **오른쪽 패널**: 상세 가이드라인 및 도움말 텍스트 포함

### 3.2 UI 컴포넌트 및 양식 필드

#### 탭 네비게이션 (상단)
- **기존 재고 버튼** (Existing Stock Button)
- **수동 재고 버튼** (Manual Stock Button)
- **재고상품 입력** (Stock Product Input) - 주황색 버튼 (활성)

#### 왼쪽 패널 - 메인 양식

##### 섹션 1: 기본 정보 (상품 구매)
- **상품 구매** (Product Purchase): 드롭다운
- **사업자명칭** (Business Name): "관리" (manage) 및 "신규 등록" (new registration) 버튼이 있는 텍스트 입력
- **공급자(발주처)** (Supplier/Purchase Order): 드롭다운 "공급자 선택" (select supplier)
- **상품정보** (Product Information): "+ 사업자 추가" (add business) 버튼이 있는 빈 텍스트 상자

##### 섹션 2: 옵션 관리 (판가)
- **판가** (Selling Price): 위/아래 화살표가 있는 숫자 입력
- **레이블**: "+ 사업자 추가" (Add Business)
- **옵션 그룹** (Option Group): 텍스트 입력
- **반품** (Return): "사업자 허용" (business allowed) 체크박스가 있는 텍스트 입력

##### 섹션 3: 상품 매트릭스 (반가)
테이블 컬럼:
1. **번호** (Number)
2. **옵션1/사용** (Option 1/Usage): "JOI377/5mm" 표시
3. **옵션2/성별명** (Option 2/Gender): 비어있음
4. **출고담당자** (Shipping Manager): 이미지 아이콘
5. **판가** (Selling Price): "0"과 "원" (won)이 있는 숫자 입력
6. **재고** (Stock)

1-4행 모두 옵션 1 컬럼에 "JOI377/5mm" 표시

##### 섹션 4: 재고 정보 (상품성명)
- **MOQ** (Minimum Order Quantity): 텍스트 입력
- **매입2** (Purchase 2): 텍스트 입력
- **매입3** (Purchase 3): 텍스트 입력
- **매입4** (Purchase 4): 텍스트 입력

#### 하단 버튼
- **기본 재고 생성** (Create Basic Stock) - 주황색 버튼

### 3.3 오른쪽 패널 - 가이드라인

#### 재고 생성(자동) - Stock Creation (Automatic)
판매 상품 생성과 연결된 자동 재고 생성 프로세스를 설명합니다.

#### 재고명로 판매 등록 후 자동으로 재고 생성 (Automatic Stock Creation after Sales Registration)
판매 상품 정보를 기반으로 재고가 자동 생성되는 방법에 대한 지침.

**주요 사항**:
- 상품 정보를 먼저 입력해야 함
- 판매 채널에 자동 연결
- 최소 1개의 옵션 필요; 옵션이 없으면 단일 수량 재고 생성

#### 수동/자동관리 (Manual/Automatic Management)
- 수동 관리: 직접 재고 입력
- 자동: 판매 상품 행 수와 동기화
- 설정 후 행 모드에서 수량 모드로 전환 불가

#### 상품명 selected box (Product Name Select Box)
- 목록 형식: 이름 / 코드 / 이미지
- 외부 시스템 상품명 표시

#### 판가 (Selling Price)
- 옵션을 제외한 기본 가격 입력
- 옵션 기반 가격인 경우 0 입력 가능

#### 옵션 그룹명/옵션 명 (Option Group Name/Option Name)
- 각 상품은 여러 옵션 그룹을 가질 수 있음
- 예: 크기, 색상, 용량
- 자동완성을 클릭하거나 수동으로 옵션 입력

#### 중요 노트 (Important Notes)
- **빨간색 경고**: 옵션 구조 생성 후에는 옵션 그룹을 편집할 수 없습니다. 삭제 후 재생성해야 합니다.

### 3.4 데이터 필드 및 스키마 요구사항

#### PIM 통합
이 양식은 다음을 직접 생성/업데이트합니다:
- `product_masters` (PIM)
- `product_option_groups` (PIM)
- `product_option_values` (PIM)
- `product_variants` (PIM)

#### WMS 통합
해당하는 WMS 엔티티 생성:
- `inventory_product_masters`
- `skus`
- `sku_barcodes` (선택적/생성됨)

#### 비즈니스 엔티티 필드
```typescript
interface CreateSalesProductDto {
  // 기본 정보
  businessName: string;
  supplierId: uuid;
  productInfo: string;

  // 가격
  basePrice: number;

  // 옵션
  optionGroups: Array<{
    name: string;
    displayName: string;
    values: Array<{
      value: string;
      displayName: string;
    }>;
  }>;

  // 변형 (매트릭스에서)
  variants: Array<{
    optionCombination: Record<string, string>; // { color: 'red', size: 'M' }
    price: number;
    sku?: string; // 선택적 수동 SKU
  }>;

  // 재고 설정
  moq?: number;
  purchasePrice2?: number;
  purchasePrice3?: number;
  purchasePrice4?: number;
}
```

### 3.5 백엔드 작업
1. **POST /api/pim/products/create**
   - 옵션이 있는 상품 마스터 생성
   - 옵션 매트릭스를 기반으로 변형 자동 생성
   - WMS SKU를 병렬로 생성

2. **GET /api/pim/businesses**
   - 드롭다운용 등록된 사업자 목록

3. **GET /api/pim/suppliers**
   - 선택용 공급처 목록

4. **POST /api/pim/products/validate-options**
   - 저장 전 옵션 구조 검증

### 3.6 비즈니스 로직
- **변경 불가능한 옵션 구조**: 옵션 생성 후에는 수정할 수 없음 (삭제 후 재생성 필요)
- **변형 생성**: 시스템이 옵션 매트릭스에서 가능한 모든 변형 조합을 자동 생성
- **SKU 자동 생성**: 각 변형은 해당하는 WMS SKU를 생성
- **가격 전략**: 기본 가격 + 변형 조정
- **MOQ 추적**: 구매를 위한 최소 주문 수량

### 3.7 통합 지점
- **PIM 서비스**: 상품 마스터 생성을 위한 주요 서비스
- **WMS 재고 서비스**: 재고 마스터 및 SKU 생성
- **공급처 모듈**: 공급처 데이터에 연결
- **사업자 등록**: 사업자 엔티티 관계 관리

---

## 4. 판매 상품 생성 양식 (Part 2)

**파일**: `almondyoung-figma-png/inventory/create-sales-product-form-2.png`

### 4.1 페이지 개요
품질 관리, 가격 계층 및 포장 정보를 포함한 판매 상품 생성 양식의 추가 섹션 및 워크플로우 상태를 표시합니다.

### 4.2 UI 컴포넌트 및 추가 섹션

#### 탭 네비게이션 (Part 1과 동일)
- 기존 재고 버튼 (Existing Stock)
- 수동 재고 버튼 (Manual Stock)
- 재고상품 입력 (Stock Product Input) - 주황색/활성

#### 표시되는 추가 양식 섹션

##### 상품 매트릭스 (Part 1에서 계속)
더 많은 컬럼과 기능을 표시하는 확장된 테이블

##### 중요 공지 (Important Notice) - 빨간색 경고 상자
옵션 관리 및 제한사항에 대한 중요한 규칙을 나타내는 텍스트.

##### 단위 정보 (Unit Information) 섹션
포장 및 단위 세부정보 표시

##### 제고생품 선택 (Stock Product Selection)
드롭다운 또는 선택 인터페이스

##### 반품 공지 (Return Notice) - 빨간색 경고 상자 (왼쪽 하단)
국내 반품 vs 해외 반품에 대한 반품 정책 경고 포함

#### 하단 섹션 - 세 개의 워크플로우 패널

##### 왼쪽 패널: 단위 선택 (Unit Selection)
- 확장 가능한 항목이 있는 번호 목록 (1-2) 표시
- **노동: 유모등 식기 사세트 예쁘 유리** (상품 설명)
  - 태그: **자동식분류** (Auto classification)
- **→** 확장 아이콘이 있는 다른 상품
- 선택 체크박스
- 하단에 **재고생품 생성** (Create Stock Product) 버튼

##### 중간 패널: 재고생품 선택 (Stock Product Selection)
1-2로 번호가 매겨진 선택 목록 포함:
- **노동: 유모등 식기 사세트 예쁘 유리**
- 확장 가능한 드롭다운 화살표
- 주황색 "선택" (Select) 버튼이 있는 여러 선택 옵션
- **재고생품 선택 완료** (Stock Product Selection Complete) 버튼

##### 오른쪽 패널: 완제 발행 (Invoice Issue)
컬럼이 있는 테이블 표시:
- **분류** (Classification)
- **제고생품 명** (Stock Product Name)
- **공급자** (Supplier)

행 표시:
1. **발생처** | **노동: 유모등 식기 사세트...** | **지정내역**
2. 선택 버튼이 있는 빈 행

**재고생품 선택 불** (Stock Product Selection) 섹션 아래
이미지가 있는 상품 목록 표시

순서대로 하단 버튼:
- **제고생품 수정 버튼** (Edit Stock Product)
- **제고생품 선택 완료** (Complete Stock Product Selection)
- **제고생품 등록** (Register Stock Product) - 주황색

### 4.3 오른쪽 패널 가이드라인 (계속)

#### 재고 생성(상품별) - Stock Creation (Per Product)
상품별 재고 생성 방법론을 설명합니다.

#### 재고생품을 검색하여 판매상품에 매칭 (Search and Match Stock Products to Sales Products)
재고 상품과 판매 상품 간의 단계별 매칭 프로세스

**워크플로우**:
1. 판매 채널 선택
2. 재고 상품 검색
3. 매칭 완료
4. 존재하지 않는 경우 새로운 재고 상품 생성 가능

#### 중요 노트시스 (Important Notes)
옵션 기반 가격 및 반품에 대한 빨간색 경고:
- 옵션 기반 가격 규칙은 생성 후 수정 불가
- 배송지에 따라 다른 규칙 적용 (국내 vs 해외)

#### 재고 생성안내 (Stock Creation Guide)
재고 생성 규칙 설명:
- 자동 관리: 행 수를 기반으로 자동 생성
- 수동 모드: 직접 숫자 입력
- 설정 후 모드 간 전환 불가

#### 반품 공지 (Return Notice)
반품에 관한 중요한 정책:
- 국내 반품: 표준 반품 정책 적용
- 해외/직배송: 더 엄격한 반품 조건
- 각 공급처별 반품 주소 지정

### 4.4 데이터 필드 및 스키마 요구사항

#### 식별된 추가 필드

##### 포장/단위 정보
```typescript
interface ProductUnitInfo {
  unitType: 'single' | 'bundle' | 'case';
  unitsPerBundle?: number;
  bundlesPerCase?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'cm' | 'mm';
  };
  weight?: {
    value: number;
    unit: 'kg' | 'g';
  };
}
```

##### 반품 정책
```typescript
interface ReturnPolicy {
  allowReturns: boolean;
  returnWindowDays: number;
  returnAddress?: string;
  restrictions?: string;
  domesticReturnAllowed: boolean;
  overseasReturnAllowed: boolean;
}
```

##### 판매 채널 매핑
```typescript
interface ProductSalesChannelMapping {
  id: uuid;
  productMasterId: uuid;
  salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
  channelProductId?: string;
  isActive: boolean;
  channelSpecificSettings?: Record<string, any>;
}
```

### 4.5 백엔드 작업

1. **POST /api/pim/products/match-inventory**
   - 판매 상품을 재고 SKU에 매칭
   - product_variant_sku_links 생성

2. **GET /api/pim/products/search-inventory**
   - 매칭을 위한 기존 재고 상품 검색
   - 이름, 코드, 공급처로 필터링

3. **POST /api/pim/products/unit-info**
   - 포장 및 단위 정보 저장
   - 상품 마스터 메타데이터 업데이트

4. **POST /api/pim/products/return-policy**
   - 반품 정책 설정 구성
   - 공급처 유형에 따라 검증 (국내/해외)

5. **POST /api/pim/products/sales-channels**
   - 판매 채널에 상품 연결
   - 채널별 설정 구성

### 4.6 비즈니스 로직

#### 상품-SKU 매칭 워크플로우
1. 판매 채널 선택
2. 기존 재고 상품 검색
3. 판매 상품 변형을 재고 SKU에 매핑
4. 일치하는 항목이 없으면 새 SKU 생성
5. 채널별 설정 구성

#### 불변성 규칙
- 옵션 구조는 생성 후 수정 불가
- 가격 전략은 첫 저장 후 전환 불가
- 공급처 위치에 따른 반품 정책 제한

#### 다중 채널 지원
- 동일한 상품 마스터를 여러 채널에 매핑 가능
- 채널별 가격 및 재고
- 채널별 상품명/설명

### 4.7 통합 지점
- **PIM 상품 서비스**: 핵심 상품 관리
- **WMS 재고 서비스**: SKU 매칭 및 생성
- **판매 채널 모듈**: 다중 채널 상품 배포
- **공급처 모듈**: 공급처 유형에 따른 반품 정책
- **풀필먼트 모듈**: 풀필먼트 모드 결정 (자체/3PL/드롭십)

---

## 5. 재고 조사 (재고 이력 / Inventory Count)

**파일**: `almondyoung-figma-png/inventory/stocktaking.png`

### 5.1 페이지 개요
- **목적**: 실물 재고 조사를 수행하고 시스템 기록과 조정
- **네비게이션**: 재고&상품 > 주입/출고 > 주입내역 목록
- **기능**: 상품 위치 이력 (Product Location History) - 왼쪽 메뉴에서 강조 표시

### 5.2 UI 컴포넌트

#### 상단 섹션 - 검색/선택
- **검색** (Search) 탭 - 파란색 강조
- **전체 선택** (Select All)
- **바코드 스캔** (Barcode Scan) - 빨간색 테두리가 있는 노란색 입력 필드 (스캔 모드 표시)
- **버튼 행**:
  - "위치바코드 스캔 시 자동차생성대기" (Auto-generate on location scan)
  - 오른쪽 빨간색 버튼: "상품 대기 초기화" (Reset Product Queue)

#### 중간 섹션 - 스캔 모드
- **파란 스캔** (Blue Scan) 버튼 - 활성 스캔 모드 표시

#### 필터 탭
- **인쇄 위치코드** (Print Location Code)
- **납품 재고 수** (Delivery Stock Count)
- **선별일자** (Selection Date)

#### 데이터 그리드 섹션
표시되는 헤더 (빈 그리드 표시):
- **No** (Number)
- **스캔위치** (Scan Location)
- **선정위치** (Selected Location)
- **상품명** (Product Name)
- **물선명** (Logistics Name)
- **바코드번호** (Barcode Number)
- **선정재고** (Selected Stock)
- **실재고** (Actual Stock)
- **순정출하지점의 차 추입출 상품 송** (Difference)
- **상태** (Status)

표시된 메시지: "검색 후 이용해 주세요." (Please search to use)

#### 오른쪽 패널 - 도움말 가이드
녹색 상자 제목: **상품 상태 저장준비** (Product Status Save Preparation)

재고 조사 워크플로우를 보여주는 단계별 지침 포함

### 5.3 데이터 필드 및 스키마 요구사항

#### 신규 테이블: 재고 조사 세션
```typescript
interface StocktakingSession {
  id: uuid;
  warehouseId: uuid;
  sessionName: string;
  status: 'created' | 'in_progress' | 'completed' | 'cancelled';
  startedAt: timestamp;
  completedAt?: timestamp;
  createdBy: uuid;
  notes?: string;
}
```

#### 신규 테이블: 재고 조사 라인
```typescript
interface StocktakingLine {
  id: uuid;
  sessionId: uuid;            // references stocktaking_sessions.id
  locationId: uuid;           // references locations.id
  skuId: uuid;               // references skus.id
  expectedQuantity: number;  // 카운트 전 시스템 수량
  countedQuantity?: number;  // 실제 카운트된 수량
  discrepancy?: number;      // 계산된 차이
  status: 'pending' | 'counted' | 'verified' | 'adjusted';
  countedAt?: timestamp;
  countedBy?: uuid;
  notes?: string;
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

#### 신규 테이블: 재고 조사 조정
```typescript
interface StocktakingAdjustment {
  id: uuid;
  stocktakingLineId: uuid;
  journalId: uuid;           // references stock_journals.id
  eventId: uuid;             // references stock_events.id
  adjustmentType: 'ADJUST_UP' | 'ADJUST_DOWN';
  quantity: number;
  reason: string;
  appliedAt: timestamp;
  appliedBy: uuid;
}
```

### 5.4 백엔드 작업

1. **POST /api/wms/stocktaking/sessions**
   - 새 재고 조사 세션 생성
   - 창고 및 날짜 범위로 초기화

2. **GET /api/wms/stocktaking/sessions/:id**
   - 세션 세부정보 및 진행 상황 가져오기
   - 카운트 통계 포함

3. **POST /api/wms/stocktaking/scan-location**
   - 위치 바코드 스캔
   - 위치에 대한 예상 재고 로드
   - 대기 중인 재고 조사 라인 생성

4. **POST /api/wms/stocktaking/scan-product**
   - 카운팅 중 상품 바코드 스캔
   - 카운트된 수량 증가
   - 재고 조사 라인 업데이트

5. **POST /api/wms/stocktaking/lines/:id/count**
   - 특정 라인에 대한 카운트 수동 입력
   - 카운트된 수량 업데이트

6. **GET /api/wms/stocktaking/lines/discrepancies**
   - 차이가 있는 모든 라인 목록 (예상 != 카운트)
   - 위치, SKU, 차이 임계값으로 필터링

7. **POST /api/wms/stocktaking/adjust**
   - 차이에 대한 재고 조정 이벤트 생성
   - transition_type = 'ADJUST_UP' 또는 'ADJUST_DOWN'인 stock_events 생성
   - 이벤트 소싱을 통해 stock_summary 업데이트

8. **POST /api/wms/stocktaking/sessions/:id/complete**
   - 재고 조사 세션 완료
   - 추가 편집에서 세션 잠금
   - 요약 보고서 생성

9. **POST /api/wms/stocktaking/reset**
   - 현재 스캔 큐 지우기
   - 대기 중인 카운트 재설정

### 5.5 비즈니스 로직

#### 재고 조사 워크플로우
1. **세션 초기화**: 창고에 대한 재고 조사 세션 생성
2. **위치 스캔**: 위치 바코드를 스캔하여 예상 재고 로드
3. **상품 카운트**:
   - 상품 바코드를 스캔하거나 수동으로 카운트 입력
   - 시스템이 위치별 SKU당 카운트된 수량 추적
4. **차이 검토**:
   - 예상 수량 vs 카운트된 수량 비교
   - 검토를 위한 차이 강조 표시
5. **재고 조정**:
   - 재고 조정 이벤트 생성 (ADJUST_UP/ADJUST_DOWN)
   - stock_events 테이블에 게시
   - stock_summary 프로젝션 업데이트
6. **세션 완료**: 완료 및 감사 보고서 생성

#### 바코드 스캔 로직
- **위치 스캔**: 해당 위치의 모든 SKU 로딩 트리거
- **상품 스캔**: 스캔된 SKU의 카운트 증가
- **자동 생성**: 첫 번째 스캔 시 재고 조사 라인 자동 생성

#### 조정 규칙
- 카운트 확인 후에만 조정 생성
- 임계값을 초과하는 조정에 대한 이유 필요 (예: >5% 차이)
- 적절한 저널링으로 stock_events 생성
- 누가/언제/왜에 대한 감사 추적 유지

#### 동시 카운팅
- 여러 사용자가 동시에 다른 위치를 카운트할 수 있음
- 활성 카운팅 중 위치 잠금
- 동일한 위치의 중복 카운팅 방지

### 5.6 통합 지점

#### 재고 이벤트 시스템 (이벤트 소싱)
- 조정은 적절한 `stock_events` 레코드 생성
- 이벤트는 `transitionType` = 'ADJUST_UP' 또는 'ADJUST_DOWN'을 가짐
- 이벤트는 `stock_summary` 프로젝션 업데이트 트리거
- 완전한 감사 추적 유지

#### 위치 모듈
- 위치 계층 구조에 `locations` 테이블 사용
- 위치 바코드 스캔 지원
- 창고별 필터링

#### 재고 모듈
- `stock_summary`에서 예상 수량 읽기
- 카운트된 수량과 비교
- 이벤트 소싱 패턴을 통해 재고 업데이트

#### 감사 시스템
- 모든 조정을 `audit_logs`에 기록
- 사용자 작업 추적 (누가 카운트했는지, 누가 조정했는지)
- 모든 활동 타임스탬프
- 차이 이유 저장

### 5.7 UI/UX 플로우
1. 사용자가 "상품 위치 이력" (Product Location History) 클릭
2. 검색 기준 입력 또는 위치 바코드 스캔
3. 시스템이 위치에 대한 예상 재고 표시
4. 사용자가 상품을 스캔하거나 수동으로 카운트 입력
5. 시스템이 실시간으로 차이 강조 표시
6. 사용자가 카운트 검토 및 확인
7. 시스템이 차이에 대한 조정 이벤트 생성
8. 사용자가 세션을 완료하고 보고서 생성

### 5.8 보고 요구사항
- **차이 보고서**: 이유와 함께 모든 차이 목록
- **조정 요약**: SKU, 위치, 창고별 총 조정
- **카운트 진행 상황**: 완료된 위치의 백분율
- **사용자 활동**: 누가 어떤 위치를 언제 카운트했는지
- **과거 비교**: 시간 경과에 따른 재고 조사 결과 비교

---

## 6. 교차 관심사 (Cross-Cutting Concerns)

### 6.1 바코드 시스템 아키텍처

#### 바코드 유형
현재 시스템은 'standard' 값을 가진 `barcode_type` enum을 사용합니다. 확장이 필요할 수 있습니다:
```typescript
export const barcodeTypeEnum = pgEnum('barcode_type', [
  'standard',      // 일반 상품 바코드 (EAN-13 등)
  'location',      // 위치/빈 바코드
  'container',     // 팔레트/박스 바코드
  'internal'       // 내부 WMS 생성 바코드
]);
```

#### 바코드 생성 서비스
다음을 지원해야 합니다:
- SKU 바코드 생성
- 위치 바코드 생성
- 인쇄 큐 관리
- 일괄 인쇄
- 라벨 템플릿 (다양한 크기, 형식)

### 6.2 판매 상품 생명 주기

```
1. 상품 마스터 생성 (PIM)
   ├─ 옵션 스키마 정의
   ├─ 변형 생성 (모든 조합)
   └─ 기본 가격 설정

2. 재고 마스터 & SKU 생성 (WMS)
   ├─ product_master당 하나의 inventory_product_master
   ├─ 변형당 하나의 SKU
   └─ 바코드 생성/할당

3. 판매 채널 매칭 (PIM)
   ├─ Medusa, Naver, Coupang 등에서 활성화
   ├─ 채널별 가격/이름 설정
   └─ 풀필먼트 모드 구성

4. 재고 수령 (WMS)
   ├─ 입고 영수증 생성
   ├─ 수령 중 바코드 스캔
   └─ stock_events 게시 (transition_type = 'RECEIVE')

5. 위치에 저장 (WMS)
   ├─ 보관 프로세스
   ├─ 위치 + 상품 바코드 스캔
   └─ 위치로 stock_summary 업데이트

6. 카운트/조정 (재고 조사)
   ├─ 주기적 실물 카운트
   ├─ 차이 식별
   └─ 조정 이벤트 생성
```

### 6.3 데이터 일관성 규칙

#### PIM ↔ WMS 동기화
- 상품 마스터 생성은 반드시 재고 마스터 생성 트리거
- 변형 생성은 반드시 SKU 생성 트리거
- 옵션 구조 변경은 SKU 재생성 필요 (파괴적)
- 양방향 참조 유지:
  - `inventory_product_masters.pim_master_id` → `product_masters.id`
  - `skus.pim_variant_id` → `product_variants.id`

#### 불변성 제약
- **옵션 구조**: 변형 생성 후 수정 불가 (삭제 후 재생성 필요)
- **재고 이벤트**: 불변 감사 추적 (수정을 위한 역전 이벤트 사용)
- **바코드 할당**: 할당 후 SKU의 기본 바코드 변경 불가
- **위치 바코드**: 생성 후 불변

### 6.4 성능 고려사항

#### 인덱싱 전략
다음에 대한 적절한 인덱스 확인:
- `sku_barcodes.barcode` (이미 고유)
- `location_barcodes.barcode` (구현된 경우)
- `stocktaking_lines.session_id` + `status`
- `stock_summary.sku_id` + `warehouse_id` + `location_id`

#### 캐싱 전략
- 자주 스캔되는 바코드 → SKU 매핑 캐시
- 빠른 조회를 위한 위치 계층 구조 캐시
- 활성 재고 조사 세션 캐시

#### 일괄 작업
- 대량 바코드 생성
- 일괄 인쇄 작업
- 대량 조정 게시 (대규모 재고 조사 세션용)

---

## 7. 구현 우선순위

### 7.1 Phase 1: 핵심 바코드 인프라
1. ✅ `sku_barcodes` 테이블 구현 (이미 존재)
2. ❌ `location_barcodes` 테이블 및 모듈 생성
3. ❌ 바코드 생성 서비스 구축
4. ❌ 인쇄 큐 시스템 구현
5. ❌ 바코드 스캔 엔드포인트 생성

### 7.2 Phase 2: 판매 상품 생성
1. ✅ 상품/옵션/변형을 위한 PIM 스키마 (이미 존재)
2. ❌ 판매 상품 생성 API 구축 (POST /api/pim/products/create)
3. ❌ 변형에서 자동 SKU 생성 구현
4. ❌ 상품-SKU 매칭 서비스 생성
5. ❌ 판매 채널 매핑 기능 추가

### 7.3 Phase 3: 재고 조사 모듈
1. ❌ 재고 조사 스키마 생성 (sessions, lines, adjustments)
2. ❌ 재고 조사 세션 관리 구축
3. ❌ 카운팅을 위한 바코드 스캔 구현
4. ❌ 차이 감지 및 보고 생성
5. ❌ 재고 조정 이벤트 생성 구축
6. ❌ 재고 조사 보고서 및 분석 추가

### 7.4 Phase 4: 고급 기능
1. ❌ 순환 카운팅 (지속적인 부분 재고 조사)
2. ❌ 과거 데이터를 기반으로 한 예측 조정
3. ❌ 재고 조사용 모바일 앱
4. ❌ 실시간 재고 조사 대시보드
5. ❌ API를 통한 바코드 프린터 통합

---

## 8. API 사양

### 8.1 바코드 관리 API

```typescript
// 판매 상품 바코드 목록
GET /api/wms/inventory/barcodes/list
Query: {
  search?: string;
  skuId?: uuid;
  locationId?: uuid;
  supplierId?: uuid;
  page?: number;
  limit?: number;
}
Response: {
  items: Array<{
    barcodeId: uuid;
    barcode: string;
    skuId: uuid;
    skuName: string;
    skuCode: string;
    masterName: string;
    image?: string;
    location?: string;
    supplierName?: string;
    version?: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

// 인쇄 큐에 추가
POST /api/wms/inventory/barcodes/print
Body: {
  barcodeIds: uuid[];
  quantity: number;
}
Response: {
  jobId: uuid;
  itemsQueued: number;
}

// 위치 바코드 목록
GET /api/wms/locations/barcodes
Query: {
  search?: string;
  warehouseId?: uuid;
  page?: number;
  limit?: number;
}
Response: {
  items: Array<{
    id: uuid;
    locationId: uuid;
    barcode: string;
    locationCode: string;
    createdAt: timestamp;
  }>;
  total: number;
}

// 위치 바코드 생성
POST /api/wms/locations/barcodes
Body: {
  locationId: uuid;
  barcode?: string; // 선택적, 제공되지 않으면 자동 생성
}
Response: {
  id: uuid;
  locationId: uuid;
  barcode: string;
  locationCode: string;
}
```

### 8.2 판매 상품 API

```typescript
// 판매 상품 생성 (PIM + WMS 통합)
POST /api/pim/products/create
Body: {
  name: string;
  businessName: string;
  supplierId: uuid;
  basePrice: number;
  optionGroups: Array<{
    name: string;
    displayName: string;
    values: Array<{
      value: string;
      displayName: string;
    }>;
  }>;
  moq?: number;
  returnPolicy?: {
    allowReturns: boolean;
    returnWindowDays: number;
  };
}
Response: {
  productMasterId: uuid;
  inventoryMasterId: uuid;
  variantsCreated: number;
  skusCreated: number;
  variants: Array<{
    variantId: uuid;
    skuId: uuid;
    optionCombination: Record<string, string>;
  }>;
}

// 기존 재고에 상품 매칭
POST /api/pim/products/match-inventory
Body: {
  productMasterId: uuid;
  variantSkuMappings: Array<{
    variantId: uuid;
    skuId: uuid;
  }>;
}
Response: {
  success: boolean;
  mappingsCreated: number;
}
```

### 8.3 재고 조사 API

```typescript
// 재고 조사 세션 생성
POST /api/wms/stocktaking/sessions
Body: {
  warehouseId: uuid;
  sessionName: string;
  notes?: string;
}
Response: {
  sessionId: uuid;
  status: 'created';
  startedAt: timestamp;
}

// 위치 바코드 스캔
POST /api/wms/stocktaking/scan-location
Body: {
  sessionId: uuid;
  locationBarcode: string;
}
Response: {
  locationId: uuid;
  locationCode: string;
  expectedItems: Array<{
    skuId: uuid;
    skuName: string;
    skuCode: string;
    barcode: string;
    expectedQuantity: number;
  }>;
}

// 카운팅 중 상품 스캔
POST /api/wms/stocktaking/scan-product
Body: {
  sessionId: uuid;
  locationId: uuid;
  productBarcode: string;
  quantity?: number; // 기본값 1
}
Response: {
  lineId: uuid;
  skuId: uuid;
  countedQuantity: number;
  expectedQuantity: number;
  discrepancy: number;
}

// 차이 가져오기
GET /api/wms/stocktaking/sessions/:id/discrepancies
Response: {
  items: Array<{
    lineId: uuid;
    locationCode: string;
    skuName: string;
    skuCode: string;
    expectedQuantity: number;
    countedQuantity: number;
    discrepancy: number;
    discrepancyPercent: number;
  }>;
  total: number;
}

// 조정 적용
POST /api/wms/stocktaking/sessions/:id/adjust
Body: {
  adjustments: Array<{
    lineId: uuid;
    reason: string;
  }>;
}
Response: {
  adjustmentsCreated: number;
  eventsPosted: number;
  journalId: uuid;
}

// 세션 완료
POST /api/wms/stocktaking/sessions/:id/complete
Response: {
  sessionId: uuid;
  status: 'completed';
  completedAt: timestamp;
  summary: {
    totalLines: number;
    discrepanciesFound: number;
    adjustmentsApplied: number;
    totalAdjustmentValue: number;
  };
}
```

---

## 9. 테스트 전략

### 9.1 단위 테스트
- 바코드 생성 로직
- SKU-변형 매핑 규칙
- 재고 조사 차이 계산
- 조정을 위한 이벤트 소싱 프로젝션

### 9.2 통합 테스트
- PIM → WMS SKU 생성 플로우
- 바코드 스캔 → 재고 조회
- 재고 조사 조정 → stock_events → stock_summary
- 인쇄 큐 작업 처리

### 9.3 E2E 테스트
- 완전한 판매 상품 생성 워크플로우
- 전체 재고 조사 세션 (생성 → 스캔 → 카운트 → 조정 → 완료)
- 바코드 인쇄 워크플로우
- 위치 바코드 생성 및 사용

### 9.4 성능 테스트
- 높은 스캔 볼륨에서의 바코드 조회
- 일괄 SKU 생성 (1000+ 변형)
- 동시 재고 조사 (다중 사용자/위치)
- 이벤트 소싱 프로젝션 재구축

---

## 10. 미해결 질문 및 필요한 결정

### 10.1 바코드 생성
- **Q**: 외부 바코드 생성 서비스를 사용할 것인가, 아니면 자체 구축할 것인가?
- **Q**: 어떤 바코드 기호를 사용할 것인가? (EAN-13, Code128, QR 코드?)
- **Q**: 바코드 충돌/중복을 어떻게 처리할 것인가?

### 10.2 판매 상품 생성
- **Q**: 옵션 구조 편집을 지원할 수 있는가, 아니면 항상 파괴적인가?
- **Q**: 변형 생성은 동기적인가 비동기적인가? (큰 옵션 매트릭스의 경우)
- **Q**: 부분 실패를 어떻게 처리할 것인가? (상품 생성됨 but SKU 생성 실패)

### 10.3 재고 조사
- **Q**: 블라인드 카운트를 지원할 것인가? (카운터에게 예상 수량 숨김)
- **Q**: 순환 카운팅 일정/자동화 전략은?
- **Q**: 자동 조정 임계값 (예: 차이 < 5%인 경우 자동 조정)?
- **Q**: 다중 사용자 세션 지원 (협업 카운팅)?

### 10.4 위치 바코드
- **Q**: 위치 바코드는 자동 생성되어야 하는가 아니면 수동으로 할당되어야 하는가?
- **Q**: 위치 바코드의 형식/구조는?
- **Q**: 위치 바코드 재인쇄를 어떻게 처리할 것인가? (동일한 코드 또는 새 코드?)

---

## 요약

본 분석은 Figma 디자인에서 볼 수 있는 다섯 가지 주요 기능 영역을 다룹니다:

1. **판매 상품 바코드 관리**: 위치 및 공급처 정보와 함께 상품 바코드 조회, 검색 및 인쇄
2. **위치 바코드 관리**: 창고 위치에 대한 고유 바코드 생성 및 관리
3. **판매 상품 생성 (Part 1)**: 옵션, 변형 및 가격이 포함된 핵심 상품 설정
4. **판매 상품 생성 (Part 2)**: SKU 매칭, 포장, 반품 정책 및 채널 매핑을 포함한 고급 기능
5. **재고 조사**: 바코드 스캔, 차이 감지 및 자동 조정 게시를 사용한 실물 재고 카운팅

### 주요 백엔드 요구사항
- **신규 테이블**: `location_barcodes`, `stocktaking_sessions`, `stocktaking_lines`, `stocktaking_adjustments`, `barcode_print_jobs`
- **신규 서비스**: 바코드 생성, 인쇄 큐 관리, 재고 조사 세션 관리
- **신규 API**: 바코드, 상품 및 재고 조사 도메인에 걸친 20개 이상의 엔드포인트
- **통합 지점**: PIM과 WMS 간의 심층 통합, 조정을 위한 이벤트 소싱, 감사 로깅

### 구현 복잡도
- **높은 우선순위**: 위치 바코드 시스템, 재고 조사 모듈 (운영에 중요)
- **중간 우선순위**: 판매 상품 생성 개선, 바코드 인쇄
- **낮은 우선순위**: 고급 기능 (순환 카운팅, 모바일 앱, 예측 분석)

### 다음 단계
1. 팀과 함께 스키마 디자인 검토 및 검증
2. 각 엔드포인트에 대한 상세 API 사양 생성
3. 바코드 생성 전략 및 기호 설계
4. 재고 조사 모듈을 위한 MVP 구축 (운영상 가장 중요)
5. 위치 바코드 시스템 구현
6. 식별된 모든 기능으로 판매 상품 생성 개선



