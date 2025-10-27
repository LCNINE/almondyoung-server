# 쿠팡 API 서비스 리팩토링 명세서

## 📋 개요

### 목적

현재 `CoupangApiService` 클래스는 40개 이상의 메서드를 포함하고 있어 단일 책임 원칙(SRP)을 위반하고 있습니다. 이를 관심사별로 분리하여 유지보수성, 테스트 용이성, 가독성을 향상시킵니다.

### 네이밍 규칙 변경

- **변경 전**: `*.api.service.ts`
- **변경 후**: `*.client.service.ts`
- **이유**: 외부 API와의 통신을 담당하는 클라이언트 역할을 명확히 표현

---

## 🎯 분리 전략

### 원칙

1. **기능/도메인별 분리**: 쿠팡 API의 기능 그룹별로 서비스 클래스 분리
2. **단일 책임 원칙**: 각 서비스는 하나의 도메인만 담당
3. **작은 표면적**: 클라이언트는 필요한 기능 그룹만 주입받아 사용
4. **공통 로직 추출**: 인증, 헤더 생성 등 공통 기능은 Base 클래스로 분리

---

## 📦 분리 구조

### 1. **CoupangBaseClient** (기본 클래스)

**파일명**: `coupang-base.client.service.ts`

**역할**:

- 쿠팡 API 공통 기능 제공 (인증, 헤더 생성, 설정 관리)
- 모든 쿠팡 클라이언트 서비스의 부모 클래스

**메서드**:

- `getApiConfig()`: 환경변수에서 API 설정 로드
- `generateAuthHeader()`: 쿠팡 API 인증 헤더 생성
- `getApiBaseUrl()`: API Base URL 결정 (Mock/Real)

**특징**:

- `@Injectable()` 데코레이터 없음 (추상 클래스)
- `HttpService` 주입받아 자식 클래스에서 사용

---

### 2. **CoupangOrderClient** (주문 관련)

**파일명**: `coupang-order.client.service.ts`

**역할**: 주문/발주서 조회 및 처리

**메서드** (8개):

1. `getOrderSheets()` - 발주서 목록 조회 (페이징)
2. `getSingleOrderSheet()` - 발주서 단건 조회 (shipmentBoxId)
3. `getSingleOrderSheetByOrderId()` - 발주서 단건 조회 (orderId)
4. `getAllOrderSheetsByStatus()` - 특정 상태의 모든 발주서 조회
5. `acknowledgeOrdersheets()` - 상품준비중 처리
6. `uploadInvoices()` - 송장 업로드 (발송 처리)
7. `updateInvoices()` - 송장 업데이트
8. `getDeliveryHistory()` - 배송상태 변경 히스토리 조회

**의존성**:

- `CoupangBaseClient` 상속
- `HttpService` 주입

---

### 3. **CoupangReturnClient** (반품 관련)

**파일명**: `coupang-return.client.service.ts`

**역할**: 반품/취소 요청 조회 및 처리

**메서드** (9개):

1. `getReturnRequests()` - 반품/취소 목록 조회
2. `getSingleReturnRequest()` - 반품/취소 단건 조회
3. `stoppedShipment()` - 출고중지완료 처리
4. `completedShipment()` - 이미출고처리
5. `confirmReturnReceipt()` - 반품상품 입고확인
6. `approveReturnRequest()` - 반품요청 승인
7. `getReturnWithdrawalHistory()` - 반품 철회 이력 기간별 조회
8. `getReturnWithdrawalHistoryByIds()` - 반품 철회 이력 ID별 조회
9. `registerReturnInvoice()` - 회수송장 등록

**의존성**:

- `CoupangBaseClient` 상속
- `HttpService` 주입

---

### 4. **CoupangExchangeClient** (교환 관련)

**파일명**: `coupang-exchange.client.service.ts`

**역할**: 교환 요청 조회 및 처리

**메서드** (4개):

1. `getExchangeRequests()` - 교환요청 목록 조회
2. `confirmExchangeReceipt()` - 교환상품 입고확인
3. `rejectExchangeRequest()` - 교환요청 거부
4. `uploadExchangeInvoice()` - 교환상품 송장 업로드

**의존성**:

- `CoupangBaseClient` 상속
- `HttpService` 주입

---

### 5. **CoupangProductClient** (상품/재고 관련)

**파일명**: `coupang-product.client.service.ts`

**역할**: 상품 정보 및 재고 관리

**메서드** (1개):

1. `updateStock()` - 재고 수량 변경

**향후 확장 가능**:

- 상품 정보 조회
- 상품 가격 변경
- 상품 등록/수정

**의존성**:

- `CoupangBaseClient` 상속
- `HttpService` 주입

---

## 📐 Zod 스키마 분리 구조

### 현재 문제점

- `coupang.api.zod.ts` 파일이 1095줄로 비대함
- 모든 도메인의 스키마가 하나의 파일에 혼재
- 특정 도메인 스키마 수정 시 전체 파일을 열어야 함

### 분리 전략

클라이언트 서비스와 동일한 도메인 구조로 Zod 스키마 분리

---

### 1. **coupang-common.zod.ts** (공통 스키마)

**파일명**: `apps/channel-adapter/src/zods/coupang/coupang-common.zod.ts`

**포함 내용**:

- `createCoupangApiResponseSchema()` - 공통 응답 헬퍼
- `CurrencySchema` - 통화 정보
- `CoupangDeliveryCompanyCodeSchema` - 택배사 코드
- `CoupangOrderStatusSchema` - 주문 상태
- `OrdererSchema` - 주문자 정보
- `ReceiverSchema` - 수취인 정보
- `COUPANG_STATUS_MAPPING` - 상태 매핑 상수
- `mapCoupangStatusToInternal()` - 상태 변환 함수
- `validateCoupangDateRange()` - 날짜 범위 검증 함수

**Export**:

```typescript
export * from './coupang-common.zod';
```

---

### 2. **coupang-order.zod.ts** (주문 관련 스키마)

**파일명**: `apps/channel-adapter/src/zods/coupang/coupang-order.zod.ts`

**포함 내용**:

- `OrderItemSchema` - 주문 상품
- `CoupangOrderSheetSchema` - 발주서
- `CoupangOrderSheetListResponseSchema` - 발주서 목록 응답
- `CoupangSingleOrderSheetResponseSchema` - 발주서 단건 응답
- `CoupangOrderSheetByOrderIdResponseSchema` - orderId 기준 조회 응답
- `CoupangAcknowledgeOrdersheetsRequestSchema` - 상품준비중 처리 요청
- `CoupangAcknowledgeOrdersheetsResponseSchema` - 상품준비중 처리 응답
- `OrderSheetInvoiceApplyDtoSchema` - 송장 업로드 DTO
- `CoupangUploadInvoiceRequestSchema` - 송장 업로드 요청
- `CoupangUploadInvoiceResponseSchema` - 송장 업로드 응답
- `OrderSheetUpdateInvoiceDtoSchema` - 송장 업데이트 DTO
- `CoupangUpdateInvoiceRequestSchema` - 송장 업데이트 요청
- `CoupangUpdateInvoiceResponseSchema` - 송장 업데이트 응답
- `CoupangDeliveryHistoryRequestSchema` - 배송 히스토리 요청
- `CoupangDeliveryHistoryItemSchema` - 배송 히스토리 아이템
- `CoupangDeliveryHistoryResponseSchema` - 배송 히스토리 응답

**의존성**: `coupang-common.zod.ts`

---

### 3. **coupang-return.zod.ts** (반품 관련 스키마)

**파일명**: `apps/channel-adapter/src/zods/coupang/coupang-return.zod.ts`

**포함 내용**:

- `CoupangReturnItemSchema` - 반품 아이템
- `CoupangReturnReceiptSchema` - 반품 접수
- `GetReturnRequestsParamsSchema` - 반품 목록 조회 파라미터
- `GetReturnRequestsResponseSchema` - 반품 목록 조회 응답
- `SingleReturnItemSchema` - 반품 아이템 (단건)
- `ReturnDeliveryDtoSchema` - 반품 배송 정보
- `CoupangSingleReturnRequestSchema` - 반품 단건
- `GetSingleReturnRequestResponseSchema` - 반품 단건 조회 응답
- `CoupangStoppedShipmentRequestSchema` - 출고중지 요청
- `CoupangStoppedShipmentResponseSchema` - 출고중지 응답
- `CoupangCompletedShipmentRequestSchema` - 이미출고 요청
- `CoupangCompletedShipmentResponseSchema` - 이미출고 응답
- `CoupangConfirmReturnReceiptRequestSchema` - 입고확인 요청
- `CoupangConfirmReturnReceiptResponseSchema` - 입고확인 응답
- `CoupangApproveReturnRequestSchema` - 반품승인 요청
- `CoupangApproveReturnResponseSchema` - 반품승인 응답
- `GetReturnWithdrawalHistoryParamsSchema` - 반품철회 이력 조회 파라미터
- `CoupangReturnWithdrawalItemSchema` - 반품철회 아이템
- `GetReturnWithdrawalHistoryResponseSchema` - 반품철회 이력 응답
- `GetReturnWithdrawalHistoryByIdsRequestSchema` - 반품철회 ID별 조회 요청
- `GetReturnWithdrawalHistoryByIdsResponseSchema` - 반품철회 ID별 조회 응답
- `CoupangRegisterReturnInvoiceRequestSchema` - 회수송장 등록 요청
- `CoupangRegisterReturnInvoiceDataSchema` - 회수송장 데이터
- `CoupangRegisterReturnInvoiceResponseSchema` - 회수송장 등록 응답

**의존성**: `coupang-common.zod.ts`

---

### 4. **coupang-exchange.zod.ts** (교환 관련 스키마)

**파일명**: `apps/channel-adapter/src/zods/coupang/coupang-exchange.zod.ts`

**포함 내용**:

- `GetExchangeRequestsParamsSchema` - 교환 목록 조회 파라미터
- `ExchangeAddressDtoSchema` - 교환 주소 정보
- `InvoiceVendorItemDtoSchema` - 송장 상품 정보
- `DeliveryInvoiceDtoSchema` - 배송 송장 정보
- `DeliveryInvoiceGroupDtoSchema` - 배송 송장 그룹
- `ReturnDeliveryItemDtoSchema` - 반품 배송 아이템
- `ReturnDeliveryDestinationDtoSchema` - 반품 배송지 정보
- `ReturnDeliveryDtoForExchangeSchema` - 교환용 반품 배송 정보
- `CollectInformationsDtoSchema` - 회수 정보
- `ExchangeItemDtoSchema` - 교환 아이템
- `CoupangExchangeRequestSchema` - 교환 요청
- `GetExchangeRequestsResponseSchema` - 교환 목록 조회 응답
- `CoupangConfirmExchangeReceiptRequestSchema` - 교환 입고확인 요청
- `CoupangConfirmExchangeReceiptResponseSchema` - 교환 입고확인 응답
- `CoupangRejectExchangeRequestSchema` - 교환 거부 요청
- `CoupangRejectExchangeResponseSchema` - 교환 거부 응답
- `CoupangUploadExchangeInvoiceItemSchema` - 교환 송장 업로드 아이템
- `CoupangUploadExchangeInvoiceRequestSchema` - 교환 송장 업로드 요청
- `CoupangUploadExchangeInvoiceResponseSchema` - 교환 송장 업로드 응답

**의존성**: `coupang-common.zod.ts`

---

### 5. **coupang-product.zod.ts** (상품 관련 스키마)

**파일명**: `apps/channel-adapter/src/zods/coupang/coupang-product.zod.ts`

**포함 내용**:

- `CoupangUpdateStockResponseSchema` - 재고 업데이트 응답

**의존성**: `coupang-common.zod.ts`

---

### 6. **index.ts** (통합 Export)

**파일명**: `apps/channel-adapter/src/zods/coupang/index.ts`

**역할**: 모든 Zod 스키마를 한 곳에서 export

```typescript
// 공통
export * from './coupang-common.zod';

// 도메인별
export * from './coupang-order.zod';
export * from './coupang-return.zod';
export * from './coupang-exchange.zod';
export * from './coupang-product.zod';
```

---

### Zod 파일 구조

```
apps/channel-adapter/src/zods/
├── coupang/                          # 새로 생성
│   ├── coupang-common.zod.ts         # 공통 (헬퍼, 상수, 기본 스키마)
│   ├── coupang-order.zod.ts          # 주문 관련
│   ├── coupang-return.zod.ts         # 반품 관련
│   ├── coupang-exchange.zod.ts       # 교환 관련
│   ├── coupang-product.zod.ts        # 상품 관련
│   └── index.ts                      # 통합 export
└── coupang.api.zod.ts                # 삭제 예정
```

---

### Zod 스키마 분류표

| 도메인          | 스키마 수 (예상) | 주요 스키마                              |
| --------------- | ---------------- | ---------------------------------------- |
| Common (공통)   | ~10              | Currency, DeliveryCompanyCode, 헬퍼 함수 |
| Order (주문)    | ~15              | OrderSheet, Invoice, DeliveryHistory     |
| Return (반품)   | ~20              | ReturnRequest, Withdrawal, Shipment      |
| Exchange (교환) | ~15              | ExchangeRequest, Address, Invoice        |
| Product (상품)  | ~2               | UpdateStock                              |
| **합계**        | **~62**          |                                          |

---

### 사용 예시

#### Before (현재)

```typescript
import {
  CoupangOrderSheet,
  CoupangReturnReceipt,
  CoupangExchangeRequest,
} from '../../zods/coupang.api.zod';
```

#### After (변경 후)

```typescript
// 방법 1: 통합 import (권장)
import {
  CoupangOrderSheet,
  CoupangReturnReceipt,
  CoupangExchangeRequest,
} from '../../zods/coupang';

// 방법 2: 개별 import (필요시)
import { CoupangOrderSheet } from '../../zods/coupang/coupang-order.zod';
import { CoupangReturnReceipt } from '../../zods/coupang/coupang-return.zod';
import { CoupangExchangeRequest } from '../../zods/coupang/coupang-exchange.zod';
```

---

## 🔄 마이그레이션 계획

### Phase 1: Zod 스키마 분리

1. `zods/coupang/` 디렉토리 생성
2. `coupang-common.zod.ts` 생성 및 공통 스키마 이동
3. `coupang-order.zod.ts` 생성 및 주문 스키마 이동
4. `coupang-return.zod.ts` 생성 및 반품 스키마 이동
5. `coupang-exchange.zod.ts` 생성 및 교환 스키마 이동
6. `coupang-product.zod.ts` 생성 및 상품 스키마 이동
7. `index.ts` 생성 및 통합 export
8. 기존 import 경로 수정 및 테스트

### Phase 2: Base 클래스 생성

1. `clients/coupang/` 디렉토리 생성
2. `CoupangBaseClient` 생성
3. 공통 메서드 이동 (인증, 설정 등)
4. 테스트 작성

### Phase 3: 도메인별 클라이언트 생성

1. `CoupangOrderClient` 생성 및 메서드 이동
2. `CoupangReturnClient` 생성 및 메서드 이동
3. `CoupangExchangeClient` 생성 및 메서드 이동
4. `CoupangProductClient` 생성 및 메서드 이동
5. 각 클라이언트별 테스트 작성

### Phase 4: Adapter 수정

1. `CoupangAdapter`에서 필요한 클라이언트만 주입
2. 기존 `CoupangApiService` 호출을 새 클라이언트 호출로 변경
3. 통합 테스트 실행

### Phase 5: 정리

1. 기존 `coupang.api.service.ts` 파일 삭제
2. 기존 `coupang.api.zod.ts` 파일 삭제
3. 관련 import 문 정리
4. 문서 업데이트

---

## 📁 파일 구조

```
apps/channel-adapter/src/
├── services/
│   ├── clients/                          # 새로 생성
│   │   ├── coupang/
│   │   │   ├── coupang-base.client.service.ts
│   │   │   ├── coupang-order.client.service.ts
│   │   │   ├── coupang-return.client.service.ts
│   │   │   ├── coupang-exchange.client.service.ts
│   │   │   └── coupang-product.client.service.ts
│   │   └── index.ts                      # export 모음
│   ├── adapters/
│   │   └── coupang.adapter.ts            # 수정 필요
│   └── apis/
│       └── coupang.api.service.ts        # 삭제 예정
└── zods/
    ├── coupang/                          # 새로 생성
    │   ├── coupang-common.zod.ts
    │   ├── coupang-order.zod.ts
    │   ├── coupang-return.zod.ts
    │   ├── coupang-exchange.zod.ts
    │   ├── coupang-product.zod.ts
    │   └── index.ts                      # export 모음
    └── coupang.api.zod.ts                # 삭제 예정
```

---

## 🔌 사용 예시

### Before (현재)

```typescript
@Injectable()
export class CoupangAdapter implements ChannelAdapter {
  constructor(
    private readonly coupangApiService: CoupangApiService,  // 모든 메서드 포함
    private readonly wmsApiService: WmsApiService,
  ) {}

  async syncFromChannel() {
    const orders = await this.coupangApiService.getAllOrderSheetsByStatus(...);
    // ...
  }

  async executeReturnApprove() {
    await this.coupangApiService.approveReturnRequest(...);
    // ...
  }
}
```

### After (변경 후)

```typescript
@Injectable()
export class CoupangAdapter implements ChannelAdapter {
  constructor(
    private readonly coupangOrderClient: CoupangOrderClient,      // 주문 관련만
    private readonly coupangReturnClient: CoupangReturnClient,    // 반품 관련만
    private readonly coupangExchangeClient: CoupangExchangeClient, // 교환 관련만
    private readonly wmsApiService: WmsApiService,
  ) {}

  async syncFromChannel() {
    const orders = await this.coupangOrderClient.getAllOrderSheetsByStatus(...);
    // ...
  }

  async executeReturnApprove() {
    await this.coupangReturnClient.approveReturnRequest(...);
    // ...
  }
}
```

---

## ✅ 장점

### 1. 단일 책임 원칙 준수

- 각 클라이언트는 특정 도메인(주문, 반품, 교환, 상품)만 담당
- 클래스 크기가 작아져 이해하기 쉬움

### 2. 유지보수 용이성

- 쿠팡의 주문 API 변경 시 `CoupangOrderClient`만 수정
- 변경 영향 범위가 명확함

### 3. 테스트 용이성

- 각 도메인별로 독립적인 테스트 작성 가능
- Mock 객체 생성이 간단해짐

### 4. 의존성 명확화

- Adapter가 어떤 기능을 사용하는지 생성자에서 명확히 표현
- 불필요한 의존성 주입 방지

### 5. 확장성

- 새로운 쿠팡 API 추가 시 해당 도메인 클라이언트에만 추가
- 다른 도메인에 영향 없음

---

## 🚨 주의사항

### 1. 기존 코드 호환성

- 기존 `CoupangAdapter`의 모든 기능이 정상 동작해야 함
- 통합 테스트로 검증 필수

### 2. 환경변수 관리

- 모든 클라이언트가 동일한 환경변수 사용
- `CoupangBaseClient`에서 중앙 관리

### 3. 에러 처리

- 각 클라이언트에서 일관된 에러 처리
- 로깅 형식 통일

### 4. 순환 의존성 방지

- 클라이언트 간 상호 참조 금지
- 필요 시 공통 유틸리티 함수로 분리

---

## 📊 메서드 분류표

| 도메인          | 메서드 수 | 주요 기능                             |
| --------------- | --------- | ------------------------------------- |
| Base (공통)     | 3         | 인증, 설정, URL 관리                  |
| Order (주문)    | 8         | 발주서 조회, 송장 처리, 배송 히스토리 |
| Return (반품)   | 9         | 반품 조회/처리, 출고중지, 회수송장    |
| Exchange (교환) | 4         | 교환 조회/처리, 송장 업로드           |
| Product (상품)  | 1         | 재고 관리                             |
| **합계**        | **25**    |                                       |

---

## 🎯 성공 기준

1. ✅ 모든 기존 테스트 통과
2. ✅ `CoupangAdapter`의 모든 기능 정상 동작
3. ✅ 각 클라이언트별 단위 테스트 작성 완료
4. ✅ 코드 리뷰 승인
5. ✅ 문서 업데이트 완료

---

## 📝 검토 체크리스트

- [ ] 메서드 분류가 적절한가?
- [ ] 파일명 네이밍 규칙이 명확한가?
- [ ] Base 클래스 설계가 합리적인가?
- [ ] 마이그레이션 계획이 실행 가능한가?
- [ ] 기존 코드와의 호환성이 보장되는가?
- [ ] 테스트 전략이 충분한가?
- [ ] 문서화가 충분한가?

---

## 📅 예상 일정

- **Phase 1** (Zod 스키마 분리): 1일
- **Phase 2** (Base 클래스): 0.5일
- **Phase 3** (도메인 클라이언트): 2일
- **Phase 4** (Adapter 수정): 1일
- **Phase 5** (정리 및 문서화): 0.5일
- **총 예상 기간**: 5일

---

## 🔗 참고 자료

- Node.js Design Patterns (책)
- 단일 책임 원칙 (SRP)
- 쿠팡 API 공식 문서
