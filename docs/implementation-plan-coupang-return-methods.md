# 쿠팡 어댑터 미구현 메서드 구현 계획서

## 📋 개요

**목적**: 쿠팡 어댑터의 반품 관련 미구현 메서드 2개를 구현하여 반품 프로세스를 완성합니다.

**대상 파일**: `apps/channel-adapter/src/services/adapters/coupang.adapter.ts`

**관련 API 서비스**: `apps/channel-adapter/src/services/apis/coupang.api.service.ts`

---

## 🎯 구현 대상 메서드

### 1. `executeReturnProcessAlreadyShipped`

- **명령 타입**: `return.process_already_shipped`
- **목적**: 출고중지요청/반품접수미확인 상태에서 이미 발송한 경우 상태를 변경
- **사용 API**: `completedShipment()`

### 2. `executeReturnRegisterCollectionInvoice`

- **명령 타입**: `return.register_collection_invoice`
- **목적**: 반품/교환에 대한 회수송장을 직접 등록
- **사용 API**: `registerReturnInvoice()`

---

## 📚 API 분석

### 1. completedShipment API

**위치**: `CoupangApiService.completedShipment()`

**요청 스키마** (`CoupangCompletedShipmentRequest`):

```typescript
{
  vendorId: string;
  receiptId: number; // 취소(반품)접수번호
  deliveryCompanyCode: string; // 택배사 코드 (예: 'CJGLS')
  invoiceNumber: string; // 운송장 번호
}
```

**응답 스키마** (`CoupangCompletedShipmentResponse`):

```typescript
{
  code: number;
  message: string;
  data: {
    resultCode: string;
    resultMessage: string;
  }
}
```

**API 엔드포인트**:

```
PATCH /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/returnRequests/{receiptId}/completedShipment
```

**사용 시나리오**:

- 고객이 반품 요청을 했지만 이미 상품이 발송된 경우
- 출고중지 요청이 왔지만 이미 출고가 완료된 경우
- 송장 정보를 등록하여 쿠팡에 "이미 발송됨"을 알림

---

### 2. registerReturnInvoice API

**위치**: `CoupangApiService.registerReturnInvoice()`

**요청 스키마** (`CoupangRegisterReturnInvoiceRequest`):

```typescript
{
  vendorId: string;
  receiptId: number; // 취소(반품)접수번호
  collectionType: 'RETURN' | 'EXCHANGE'; // 회수 유형
  deliveryCompanyCode: string; // 택배사 코드
  invoiceNumber: string; // 운송장 번호
}
```

**응답 스키마** (`CoupangRegisterReturnInvoiceResponse`):

```typescript
{
  code: number;
  message: string;
  data: {
    receiptId: number;
    resultCode: string;
    resultMessage: string;
  }
}
```

**API 엔드포인트**:

```
POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/return-exchange-invoices/manual
```

**사용 시나리오**:

- 반품 승인 후 고객이 상품을 회수하기 위한 송장 등록
- 교환 승인 후 불량품을 회수하기 위한 송장 등록
- 판매자가 직접 택배사를 통해 회수 송장을 발급한 경우

---

## 🔧 구현 계획

### 1. executeReturnProcessAlreadyShipped 구현

#### 입력 (표준 명령)

```typescript
{
  type: 'return.process_already_shipped',
  claimId: string,              // 내부 표준 클레임 ID
  tracking: {
    companyCode: string,        // 표준 택배사 코드 (예: 'CJ')
    number: string              // 운송장 번호
  }
}
```

#### 처리 흐름

1. **claimId → receiptId 변환**
   - 내부 표준 claimId를 쿠팡 receiptId로 매핑
   - 현재는 claimId를 그대로 receiptId로 사용 (추후 매핑 테이블 구현 필요)

2. **택배사 코드 변환**
   - 표준 택배사 코드 → 쿠팡 택배사 코드
   - 예: 'CJ' → 'CJGLS', 'HANJIN' → 'HANJIN'
   - 헬퍼 메서드 활용: `mapDeliveryCompanyCode()`

3. **API 호출**

   ```typescript
   await this.coupangApiService.completedShipment({
     vendorId: config.vendorId,
     receiptId: Number(command.claimId),
     deliveryCompanyCode: coupangCompanyCode,
     invoiceNumber: command.tracking.number,
   });
   ```

4. **결과 반환**
   - 성공: `{ success: true, processedCount: 1 }`
   - 실패: `{ success: false, failedCount: 1, errors: [...] }`

#### 에러 처리

- receiptId가 유효하지 않은 경우
- 이미 처리된 반품인 경우
- 택배사 코드가 유효하지 않은 경우
- API 호출 실패 시

---

### 2. executeReturnRegisterCollectionInvoice 구현

#### 입력 (표준 명령)

```typescript
{
  type: 'return.register_collection_invoice',
  claimId: string,              // 내부 표준 클레임 ID
  collectionType: 'RETURN' | 'EXCHANGE', // 회수 유형
  tracking: {
    companyCode: string,        // 표준 택배사 코드
    number: string              // 운송장 번호
  }
}
```

#### 처리 흐름

1. **claimId → receiptId 변환**
   - 내부 표준 claimId를 쿠팡 receiptId로 매핑

2. **택배사 코드 변환**
   - 표준 택배사 코드 → 쿠팡 택배사 코드
   - 헬퍼 메서드 활용: `mapDeliveryCompanyCode()`

3. **API 호출**

   ```typescript
   await this.coupangApiService.registerReturnInvoice({
     vendorId: config.vendorId,
     receiptId: Number(command.claimId),
     collectionType: command.collectionType,
     deliveryCompanyCode: coupangCompanyCode,
     invoiceNumber: command.tracking.number,
   });
   ```

4. **결과 반환**
   - 성공: `{ success: true, processedCount: 1 }`
   - 실패: `{ success: false, failedCount: 1, errors: [...] }`

#### 에러 처리

- receiptId가 유효하지 않은 경우
- collectionType이 유효하지 않은 경우
- 이미 송장이 등록된 경우
- 택배사 코드가 유효하지 않은 경우
- API 호출 실패 시

---

## 🛠️ 구현 상세

### 공통 헬퍼 메서드 활용

기존에 구현된 `mapDeliveryCompanyCode()` 메서드 사용:

```typescript
private mapDeliveryCompanyCode(standardCode: string): string {
  const mapping: Record<string, string> = {
    CJ: 'CJGLS',
    HANJIN: 'HANJIN',
    LOTTE: 'LOTTE',
    LOGEN: 'LOGEN',
    KGB: 'KDEXP',
    EPOST: 'EPOST',
    // ... 기타 매핑
  };
  return mapping[standardCode] || standardCode;
}
```

### 에러 처리 패턴

```typescript
try {
  // API 호출
  const response = await this.coupangApiService.someMethod(payload);

  // 성공 로깅
  this.logger.log(`✅ [쿠팡] 작업 성공: ${command.claimId}`);

  return {
    success: true,
    processedCount: 1,
  };
} catch (error) {
  // 실패 로깅
  this.logger.error(`❌ [쿠팡] 작업 실패: ${command.claimId}`, error.message);

  return {
    success: false,
    processedCount: 0,
    failedCount: 1,
    errors: [
      {
        id: command.claimId,
        message: error.message,
      },
    ],
  };
}
```

---

## 📝 구현 코드 템플릿

### 1. executeReturnProcessAlreadyShipped

```typescript
/**
 * 🔄 이미출고처리 명령 실행
 *
 * 출고중지요청/반품접수미확인 상태에서 이미 발송한 경우 상태를 변경합니다.
 *
 * @param command 표준 명령 객체
 * @returns 처리 결과
 */
private async executeReturnProcessAlreadyShipped(
  command: any,
): Promise<SyncResult> {
  this.logger.log(
    `🔄 [쿠팡] 이미출고처리 실행: claimId=${command.claimId}`,
  );

  try {
    // 1. 택배사 코드 변환
    const coupangCompanyCode = this.mapDeliveryCompanyCode(
      command.tracking.companyCode,
    );

    // 2. API 호출
    const response = await this.coupangApiService.completedShipment({
      vendorId: process.env.COUPANG_VENDOR_ID!,
      receiptId: Number(command.claimId),
      deliveryCompanyCode: coupangCompanyCode,
      invoiceNumber: command.tracking.number,
    });

    // 3. 결과 확인
    if (response.data.resultCode === 'SUCCESS') {
      this.logger.log(
        `✅ [쿠팡] 이미출고처리 성공: ${command.claimId} - ${response.data.resultMessage}`,
      );
      return {
        success: true,
        processedCount: 1,
      };
    } else {
      throw new Error(response.data.resultMessage);
    }
  } catch (error) {
    this.logger.error(
      `❌ [쿠팡] 이미출고처리 실패: ${command.claimId}`,
      error.message,
    );
    return {
      success: false,
      processedCount: 0,
      failedCount: 1,
      errors: [
        {
          id: command.claimId,
          message: error.message,
        },
      ],
    };
  }
}
```

### 2. executeReturnRegisterCollectionInvoice

```typescript
/**
 * 🚚 회수송장 등록 명령 실행
 *
 * 반품/교환에 대한 회수송장을 직접 등록합니다.
 *
 * @param command 표준 명령 객체
 * @returns 처리 결과
 */
private async executeReturnRegisterCollectionInvoice(
  command: any,
): Promise<SyncResult> {
  this.logger.log(
    `🚚 [쿠팡] 회수송장 등록 실행: claimId=${command.claimId}, type=${command.collectionType}`,
  );

  try {
    // 1. 택배사 코드 변환
    const coupangCompanyCode = this.mapDeliveryCompanyCode(
      command.tracking.companyCode,
    );

    // 2. API 호출
    const response = await this.coupangApiService.registerReturnInvoice({
      vendorId: process.env.COUPANG_VENDOR_ID!,
      receiptId: Number(command.claimId),
      collectionType: command.collectionType,
      deliveryCompanyCode: coupangCompanyCode,
      invoiceNumber: command.tracking.number,
    });

    // 3. 결과 확인
    if (response.data.resultCode === 'SUCCESS') {
      this.logger.log(
        `✅ [쿠팡] 회수송장 등록 성공: ${command.claimId} - ${response.data.resultMessage}`,
      );
      return {
        success: true,
        processedCount: 1,
      };
    } else {
      throw new Error(response.data.resultMessage);
    }
  } catch (error) {
    this.logger.error(
      `❌ [쿠팡] 회수송장 등록 실패: ${command.claimId}`,
      error.message,
    );
    return {
      success: false,
      processedCount: 0,
      failedCount: 1,
      errors: [
        {
          id: command.claimId,
          message: error.message,
        },
      ],
    };
  }
}
```

---

## ✅ 검증 계획

### 1. 단위 테스트

- [ ] `executeReturnProcessAlreadyShipped` 성공 케이스
- [ ] `executeReturnProcessAlreadyShipped` 실패 케이스
- [ ] `executeReturnRegisterCollectionInvoice` 성공 케이스 (RETURN)
- [ ] `executeReturnRegisterCollectionInvoice` 성공 케이스 (EXCHANGE)
- [ ] `executeReturnRegisterCollectionInvoice` 실패 케이스

### 2. 통합 테스트

- [ ] 실제 쿠팡 API 호출 테스트 (Mock 서버 사용)
- [ ] 택배사 코드 변환 검증
- [ ] 에러 핸들링 검증

### 3. 수동 테스트 시나리오

#### 시나리오 1: 이미출고처리

```typescript
const result = await orchestrator.execute('coupang', {
  type: 'return.process_already_shipped',
  claimId: '12345678',
  tracking: {
    companyCode: 'CJ',
    number: '123456789012',
  },
});
```

#### 시나리오 2: 반품 회수송장 등록

```typescript
const result = await orchestrator.execute('coupang', {
  type: 'return.register_collection_invoice',
  claimId: '12345678',
  collectionType: 'RETURN',
  tracking: {
    companyCode: 'HANJIN',
    number: '987654321098',
  },
});
```

#### 시나리오 3: 교환 회수송장 등록

```typescript
const result = await orchestrator.execute('coupang', {
  type: 'return.register_collection_invoice',
  claimId: '87654321',
  collectionType: 'EXCHANGE',
  tracking: {
    companyCode: 'LOTTE',
    number: '555666777888',
  },
});
```

---

## 📌 주의사항

### 1. claimId → receiptId 매핑

- **현재**: claimId를 그대로 receiptId로 사용
- **향후**: 별도 매핑 테이블 구현 필요
- **이유**: 내부 표준 ID와 쿠팡 ID가 다를 수 있음

### 2. 택배사 코드 매핑

- 표준 코드와 쿠팡 코드가 다른 경우 반드시 변환 필요
- 매핑되지 않은 코드는 그대로 전달 (fallback)

### 3. 에러 처리

- API 응답의 `resultCode`를 확인하여 성공/실패 판단
- 실패 시 `resultMessage`를 에러 메시지로 사용

### 4. 로깅

- 모든 API 호출 전후에 로그 기록
- 성공/실패 여부를 명확히 표시
- claimId를 포함하여 추적 가능하도록 함

---

## 🚀 구현 순서

1. **1단계**: `executeReturnProcessAlreadyShipped` 구현
   - 코드 작성
   - 로컬 테스트
   - 에러 처리 검증

2. **2단계**: `executeReturnRegisterCollectionInvoice` 구현
   - 코드 작성
   - 로컬 테스트
   - 에러 처리 검증

3. **3단계**: 통합 테스트
   - Mock 서버를 통한 API 호출 테스트
   - 다양한 시나리오 검증

4. **4단계**: 문서화
   - JSDoc 주석 추가
   - 사용 예제 작성
   - README 업데이트

---

## 📚 참고 자료

### 쿠팡 API 문서

- 이미출고처리 API: `/returnRequests/{receiptId}/completedShipment`
- 회수송장 등록 API: `/return-exchange-invoices/manual`

### 관련 파일

- `apps/channel-adapter/src/services/adapters/coupang.adapter.ts`
- `apps/channel-adapter/src/services/apis/coupang.api.service.ts`
- `apps/channel-adapter/src/zods/coupang.api.zod.ts`

### 기존 구현 참고

- `executeReturnApprove()`: 반품 승인 처리 예제
- `executeReturnConfirmReceipt()`: 반품 입고확인 예제
- `executeDispatchShip()`: 송장 업로드 예제

---

## 📅 예상 일정

- **구현**: 2시간
- **테스트**: 1시간
- **문서화**: 30분
- **총 소요 시간**: 3.5시간

---

## ✨ 완료 기준

- [x] 명세서 작성 완료
- [x] `executeReturnProcessAlreadyShipped` 구현 완료
- [x] `executeReturnRegisterCollectionInvoice` 구현 완료
- [x] TypeScript 타입 에러 해결
- [ ] 단위 테스트 통과
- [ ] 통합 테스트 통과
- [ ] 코드 리뷰 완료
- [ ] 문서화 완료

---

## 🎯 구현 완료 내역

### 구현된 메서드

#### 1. executeReturnProcessAlreadyShipped ✅

- **위치**: `apps/channel-adapter/src/services/adapters/coupang.adapter.ts:935-1000`
- **기능**: 이미 출고된 반품 건에 대한 송장 정보 등록
- **API 사용**: `completedShipment()`
- **주요 로직**:
  - 택배사 코드 변환 (표준 → 쿠팡)
  - API 호출 및 응답 처리
  - 성공/실패 로깅 및 결과 반환

#### 2. executeReturnRegisterCollectionInvoice ✅

- **위치**: `apps/channel-adapter/src/services/adapters/coupang.adapter.ts:1002-1075`
- **기능**: 반품/교환 회수송장 등록
- **API 사용**: `registerReturnInvoice()`
- **주요 로직**:
  - 택배사 코드 변환 (표준 → 쿠팡)
  - collectionType 전달 (RETURN/EXCHANGE)
  - API 호출 및 응답 처리
  - 성공/실패 로깅 및 결과 반환

### 수정된 헬퍼 메서드

#### mapDeliveryCompanyCode 타입 개선 ✅

- **위치**: `apps/channel-adapter/src/services/adapters/coupang.adapter.ts:1643-1710`
- **변경 사항**:
  - 반환 타입을 명시적 union type으로 변경
  - 쿠팡 API가 요구하는 정확한 택배사 코드 enum 타입 반환
  - 매핑 테이블 확장 (EPOST, KGB, HYUNDAI, DHL, FEDEX, UPS, EMS, KDEXP 추가)

### 해결된 이슈

1. **타입 에러 해결**:
   - `deliveryCompanyCode` 타입 불일치 → union type으로 해결
   - `registerReturnInvoice` API 파라미터 수정 (vendorId 제거, returnExchangeDeliveryType 사용)
   - 응답 구조 차이 처리 (completedShipment vs registerReturnInvoice)

2. **API 스키마 정확성**:
   - `CoupangRegisterReturnInvoiceRequest`에 vendorId 불필요 확인
   - `returnExchangeDeliveryType` 필드명 사용 확인
   - 응답 구조 차이 반영 (data.resultCode vs code)

---

**작성일**: 2025-01-24  
**최종 업데이트**: 2025-01-24  
**작성자**: Kiro AI Assistant  
**버전**: 2.0 (구현 완료)
