# 쿠팡 API 서비스 리팩토링 Task List

> **참조 문서**: `docs/coupang-api-refactoring-spec.md`  
> **목표**: 40개 이상의 메서드를 가진 `CoupangApiService`를 관심사별로 분리하여 유지보수성 향상

---

## 📋 Phase 1: Zod 스키마 분리

### Task 1.1: 디렉토리 구조 생성

- [ ] `apps/channel-adapter/src/zods/coupang/` 디렉토리 생성
- [ ] 디렉토리 구조 확인

**예상 시간**: 5분

---

### Task 1.2: coupang-common.zod.ts 생성

- [ ] `apps/channel-adapter/src/zods/coupang/coupang-common.zod.ts` 파일 생성
- [ ] 기존 파일에서 다음 항목 이동:
  - [ ] `createCoupangApiResponseSchema()` 헬퍼 함수
  - [ ] `CurrencySchema`
  - [ ] `CoupangDeliveryCompanyCodeSchema`
  - [ ] `CoupangOrderStatusSchema`
  - [ ] `OrdererSchema`
  - [ ] `ReceiverSchema`
  - [ ] `COUPANG_STATUS_MAPPING` 상수
  - [ ] `mapCoupangStatusToInternal()` 함수
  - [ ] `validateCoupangDateRange()` 함수
- [ ] 타입 export 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 30분

---

### Task 1.3: coupang-order.zod.ts 생성

- [ ] `apps/channel-adapter/src/zods/coupang/coupang-order.zod.ts` 파일 생성
- [ ] `coupang-common.zod.ts`에서 필요한 항목 import
- [ ] 기존 파일에서 다음 항목 이동:
  - [ ] `OrderItemSchema`
  - [ ] `CoupangOrderSheetSchema`
  - [ ] `CoupangOrderSheetListResponseSchema`
  - [ ] `CoupangSingleOrderSheetResponseSchema`
  - [ ] `CoupangOrderSheetByOrderIdResponseSchema`
  - [ ] `CoupangAcknowledgeOrdersheetsRequestSchema`
  - [ ] `CoupangAcknowledgeOrdersheetsResponseSchema`
  - [ ] `OrderSheetInvoiceApplyDtoSchema`
  - [ ] `CoupangUploadInvoiceRequestSchema`
  - [ ] `CoupangUploadInvoiceResponseSchema`
  - [ ] `OrderSheetUpdateInvoiceDtoSchema`
  - [ ] `CoupangUpdateInvoiceRequestSchema`
  - [ ] `CoupangUpdateInvoiceResponseSchema`
  - [ ] `CoupangDeliveryHistoryRequestSchema`
  - [ ] `CoupangDeliveryHistoryItemSchema`
  - [ ] `CoupangDeliveryHistoryResponseSchema`
- [ ] 타입 export 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 45분

---

### Task 1.4: coupang-return.zod.ts 생성

- [ ] `apps/channel-adapter/src/zods/coupang/coupang-return.zod.ts` 파일 생성
- [ ] `coupang-common.zod.ts`에서 필요한 항목 import
- [ ] 기존 파일에서 다음 항목 이동:
  - [ ] `CoupangReturnItemSchema`
  - [ ] `CoupangReturnReceiptSchema`
  - [ ] `GetReturnRequestsParamsSchema`
  - [ ] `GetReturnRequestsResponseSchema`
  - [ ] `SingleReturnItemSchema`
  - [ ] `ReturnDeliveryDtoSchema`
  - [ ] `CoupangSingleReturnRequestSchema`
  - [ ] `GetSingleReturnRequestResponseSchema`
  - [ ] `CoupangStoppedShipmentRequestSchema`
  - [ ] `CoupangStoppedShipmentResponseSchema`
  - [ ] `CoupangCompletedShipmentRequestSchema`
  - [ ] `CoupangCompletedShipmentResponseSchema`
  - [ ] `CoupangConfirmReturnReceiptRequestSchema`
  - [ ] `CoupangConfirmReturnReceiptResponseSchema`
  - [ ] `CoupangApproveReturnRequestSchema`
  - [ ] `CoupangApproveReturnResponseSchema`
  - [ ] `GetReturnWithdrawalHistoryParamsSchema`
  - [ ] `CoupangReturnWithdrawalItemSchema`
  - [ ] `GetReturnWithdrawalHistoryResponseSchema`
  - [ ] `GetReturnWithdrawalHistoryByIdsRequestSchema`
  - [ ] `GetReturnWithdrawalHistoryByIdsResponseSchema`
  - [ ] `CoupangRegisterReturnInvoiceRequestSchema`
  - [ ] `CoupangRegisterReturnInvoiceDataSchema`
  - [ ] `CoupangRegisterReturnInvoiceResponseSchema`
- [ ] 타입 export 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 1시간

---

### Task 1.5: coupang-exchange.zod.ts 생성

- [ ] `apps/channel-adapter/src/zods/coupang/coupang-exchange.zod.ts` 파일 생성
- [ ] `coupang-common.zod.ts`에서 필요한 항목 import
- [ ] 기존 파일에서 다음 항목 이동:
  - [ ] `GetExchangeRequestsParamsSchema`
  - [ ] `ExchangeAddressDtoSchema`
  - [ ] `InvoiceVendorItemDtoSchema`
  - [ ] `DeliveryInvoiceDtoSchema`
  - [ ] `DeliveryInvoiceGroupDtoSchema`
  - [ ] `ReturnDeliveryItemDtoSchema`
  - [ ] `ReturnDeliveryDestinationDtoSchema`
  - [ ] `ReturnDeliveryDtoForExchangeSchema`
  - [ ] `CollectInformationsDtoSchema`
  - [ ] `ExchangeItemDtoSchema`
  - [ ] `CoupangExchangeRequestSchema`
  - [ ] `GetExchangeRequestsResponseSchema`
  - [ ] `CoupangConfirmExchangeReceiptRequestSchema`
  - [ ] `CoupangConfirmExchangeReceiptResponseSchema`
  - [ ] `CoupangRejectExchangeRequestSchema`
  - [ ] `CoupangRejectExchangeResponseSchema`
  - [ ] `CoupangUploadExchangeInvoiceItemSchema`
  - [ ] `CoupangUploadExchangeInvoiceRequestSchema`
  - [ ] `CoupangUploadExchangeInvoiceResponseSchema`
- [ ] 타입 export 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 45분

---

### Task 1.6: coupang-product.zod.ts 생성

- [ ] `apps/channel-adapter/src/zods/coupang/coupang-product.zod.ts` 파일 생성
- [ ] 기존 파일에서 다음 항목 이동:
  - [ ] `CoupangUpdateStockResponseSchema`
- [ ] 타입 export 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 10분

---

### Task 1.7: index.ts 생성 (Zod 통합 export)

- [ ] `apps/channel-adapter/src/zods/coupang/index.ts` 파일 생성
- [ ] 모든 Zod 파일 export 추가:
  ```typescript
  export * from './coupang-common.zod';
  export * from './coupang-order.zod';
  export * from './coupang-return.zod';
  export * from './coupang-exchange.zod';
  export * from './coupang-product.zod';
  ```
- [ ] 파일 저장

**예상 시간**: 5분

---

### Task 1.8: Import 경로 수정

- [ ] `coupang.api.service.ts`의 import 경로 수정
  - 변경 전: `import { ... } from '../../zods/coupang.api.zod'`
  - 변경 후: `import { ... } from '../../zods/coupang'`
- [ ] `coupang.adapter.ts`의 import 경로 수정
- [ ] 기타 파일에서 `coupang.api.zod` import 검색 및 수정
- [ ] 컴파일 에러 확인 및 수정

**예상 시간**: 30분

---

### Task 1.9: Phase 1 테스트 및 검증

- [ ] `npm run build` 실행하여 컴파일 에러 확인
- [ ] 기존 테스트 실행: `npm run test`
- [ ] 모든 import가 정상 동작하는지 확인
- [ ] 기존 `coupang.api.zod.ts` 파일 백업 (삭제 전)

**예상 시간**: 20분

**Phase 1 총 예상 시간**: ~4시간

---

## 📋 Phase 2: Base 클래스 생성

### Task 2.1: 디렉토리 구조 생성

- [ ] `apps/channel-adapter/src/services/clients/` 디렉토리 생성
- [ ] `apps/channel-adapter/src/services/clients/coupang/` 디렉토리 생성

**예상 시간**: 5분

---

### Task 2.2: CoupangBaseClient 생성

- [ ] `coupang-base.client.service.ts` 파일 생성
- [ ] 추상 클래스 선언 (abstract class)
- [ ] `HttpService` 주입 받기
- [ ] 기존 `CoupangApiService`에서 공통 메서드 이동:
  - [ ] `getApiConfig()` - API 설정 로드
  - [ ] `generateAuthHeader()` - 인증 헤더 생성
  - [ ] `getApiBaseUrl()` - Base URL 결정
- [ ] 인터페이스 정의:
  ```typescript
  interface CoupangApiConfig {
    vendorId: string;
    accessKey: string;
    secretKey: string;
    apiEndpoint: string;
  }
  ```
- [ ] Logger 추가
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 1시간

---

### Task 2.3: Base 클래스 테스트 작성

- [ ] `coupang-base.client.service.spec.ts` 파일 생성
- [ ] 환경변수 로드 테스트
- [ ] 인증 헤더 생성 테스트
- [ ] Mock 서버 URL 테스트
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1시간

**Phase 2 총 예상 시간**: ~2시간

---

## 📋 Phase 3: 도메인별 클라이언트 생성

### Task 3.1: CoupangOrderClient 생성

- [ ] `coupang-order.client.service.ts` 파일 생성
- [ ] `CoupangBaseClient` 상속
- [ ] `@Injectable()` 데코레이터 추가
- [ ] 기존 `CoupangApiService`에서 메서드 이동:
  - [ ] `getOrderSheets()`
  - [ ] `getSingleOrderSheet()`
  - [ ] `getSingleOrderSheetByOrderId()`
  - [ ] `getAllOrderSheetsByStatus()`
  - [ ] `acknowledgeOrdersheets()`
  - [ ] `uploadInvoices()`
  - [ ] `updateInvoices()`
  - [ ] `getDeliveryHistory()`
- [ ] Zod import 경로 수정 (`../../zods/coupang`)
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 2시간

---

### Task 3.2: CoupangOrderClient 테스트 작성

- [ ] `coupang-order.client.service.spec.ts` 파일 생성
- [ ] 각 메서드별 단위 테스트 작성
- [ ] Mock 데이터 준비
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1.5시간

---

### Task 3.3: CoupangReturnClient 생성

- [ ] `coupang-return.client.service.ts` 파일 생성
- [ ] `CoupangBaseClient` 상속
- [ ] `@Injectable()` 데코레이터 추가
- [ ] 기존 `CoupangApiService`에서 메서드 이동:
  - [ ] `getReturnRequests()`
  - [ ] `getSingleReturnRequest()`
  - [ ] `stoppedShipment()`
  - [ ] `completedShipment()`
  - [ ] `confirmReturnReceipt()`
  - [ ] `approveReturnRequest()`
  - [ ] `getReturnWithdrawalHistory()`
  - [ ] `getReturnWithdrawalHistoryByIds()`
  - [ ] `registerReturnInvoice()`
- [ ] Zod import 경로 수정
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 2시간

---

### Task 3.4: CoupangReturnClient 테스트 작성

- [ ] `coupang-return.client.service.spec.ts` 파일 생성
- [ ] 각 메서드별 단위 테스트 작성
- [ ] Mock 데이터 준비
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1.5시간

---

### Task 3.5: CoupangExchangeClient 생성

- [ ] `coupang-exchange.client.service.ts` 파일 생성
- [ ] `CoupangBaseClient` 상속
- [ ] `@Injectable()` 데코레이터 추가
- [ ] 기존 `CoupangApiService`에서 메서드 이동:
  - [ ] `getExchangeRequests()`
  - [ ] `confirmExchangeReceipt()`
  - [ ] `rejectExchangeRequest()`
  - [ ] `uploadExchangeInvoice()`
- [ ] Zod import 경로 수정
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 1시간

---

### Task 3.6: CoupangExchangeClient 테스트 작성

- [ ] `coupang-exchange.client.service.spec.ts` 파일 생성
- [ ] 각 메서드별 단위 테스트 작성
- [ ] Mock 데이터 준비
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 1시간

---

### Task 3.7: CoupangProductClient 생성

- [ ] `coupang-product.client.service.ts` 파일 생성
- [ ] `CoupangBaseClient` 상속
- [ ] `@Injectable()` 데코레이터 추가
- [ ] 기존 `CoupangApiService`에서 메서드 이동:
  - [ ] `updateStock()`
- [ ] Zod import 경로 수정
- [ ] 파일 저장 및 컴파일 에러 확인

**예상 시간**: 30분

---

### Task 3.8: CoupangProductClient 테스트 작성

- [ ] `coupang-product.client.service.spec.ts` 파일 생성
- [ ] `updateStock()` 메서드 테스트 작성
- [ ] Mock 데이터 준비
- [ ] 테스트 실행 및 통과 확인

**예상 시간**: 30분

---

### Task 3.9: index.ts 생성 (Client 통합 export)

- [ ] `apps/channel-adapter/src/services/clients/coupang/index.ts` 파일 생성
- [ ] 모든 Client 파일 export 추가:
  ```typescript
  export * from './coupang-base.client.service';
  export * from './coupang-order.client.service';
  export * from './coupang-return.client.service';
  export * from './coupang-exchange.client.service';
  export * from './coupang-product.client.service';
  ```
- [ ] 파일 저장

**예상 시간**: 5분

**Phase 3 총 예상 시간**: ~10시간

---

## 📋 Phase 4: Adapter 수정

### Task 4.1: CoupangAdapter 의존성 주입 수정

- [ ] `coupang.adapter.ts` 파일 열기
- [ ] 생성자에서 `CoupangApiService` 제거
- [ ] 새로운 클라이언트 주입 추가:
  ```typescript
  constructor(
    private readonly coupangOrderClient: CoupangOrderClient,
    private readonly coupangReturnClient: CoupangReturnClient,
    private readonly coupangExchangeClient: CoupangExchangeClient,
    private readonly wmsApiService: WmsApiService,
  ) {}
  ```
- [ ] Import 문 수정
- [ ] 파일 저장

**예상 시간**: 15분

---

### Task 4.2: 주문 관련 메서드 호출 변경

- [ ] `syncFromChannel()` 메서드 수정
  - 변경 전: `this.coupangApiService.getAllOrderSheetsByStatus()`
  - 변경 후: `this.coupangOrderClient.getAllOrderSheetsByStatus()`
- [ ] `getSingleOrderSheet()` 메서드 수정
- [ ] `getSingleOrderSheetByOrderId()` 메서드 수정
- [ ] `getDeliveryHistory()` 메서드 수정
- [ ] `executeOrderPrepare()` 메서드 수정
- [ ] `executeDispatchShip()` 메서드 수정
- [ ] `executeDispatchUpdateTracking()` 메서드 수정
- [ ] 컴파일 에러 확인

**예상 시간**: 1시간

---

### Task 4.3: 반품 관련 메서드 호출 변경

- [ ] `executeReturnApprove()` 메서드 수정
  - 변경 전: `this.coupangApiService.approveReturnRequest()`
  - 변경 후: `this.coupangReturnClient.approveReturnRequest()`
- [ ] `executeReturnConfirmReceipt()` 메서드 수정
- [ ] `executeReturnProcessShipmentStop()` 메서드 수정
- [ ] `executeReturnProcessAlreadyShipped()` 메서드 수정
- [ ] `executeReturnRegisterCollectionInvoice()` 메서드 수정
- [ ] `queryReturnWithdrawalHistory()` 메서드 수정
- [ ] `queryReturnWithdrawalHistoryByClaims()` 메서드 수정
- [ ] 컴파일 에러 확인

**예상 시간**: 1시간

---

### Task 4.4: 교환 관련 메서드 호출 변경

- [ ] `executeExchangeConfirmReceipt()` 메서드 수정
  - 변경 전: `this.coupangApiService.confirmExchangeReceipt()`
  - 변경 후: `this.coupangExchangeClient.confirmExchangeReceipt()`
- [ ] `executeExchangeReject()` 메서드 수정
- [ ] `executeExchangeUploadInvoice()` 메서드 수정
- [ ] `queryExchangeRequests()` 메서드 수정
- [ ] 컴파일 에러 확인

**예상 시간**: 30분

---

### Task 4.5: Module 설정 업데이트

- [ ] `channel-adapter.module.ts` 파일 열기
- [ ] `CoupangApiService` provider 제거
- [ ] 새로운 클라이언트 provider 추가:
  ```typescript
  providers: [
    CoupangOrderClient,
    CoupangReturnClient,
    CoupangExchangeClient,
    CoupangProductClient,
    // ...
  ];
  ```
- [ ] Import 문 수정
- [ ] 파일 저장

**예상 시간**: 15분

---

### Task 4.6: 통합 테스트 실행

- [ ] 전체 빌드: `npm run build`
- [ ] 단위 테스트: `npm run test`
- [ ] E2E 테스트: `npm run test:e2e` (있는 경우)
- [ ] 수동 테스트:
  - [ ] 주문 동기화 테스트
  - [ ] 반품 승인 테스트
  - [ ] 교환 처리 테스트
  - [ ] 송장 업로드 테스트
- [ ] 에러 발생 시 수정 및 재테스트

**예상 시간**: 2시간

**Phase 4 총 예상 시간**: ~5시간

---

## 📋 Phase 5: 정리 및 문서화

### Task 5.1: 기존 파일 삭제

- [ ] `coupang.api.service.ts` 파일 삭제 전 최종 확인
- [ ] `apps/channel-adapter/src/services/apis/coupang.api.service.ts` 삭제
- [ ] `coupang.api.zod.ts` 파일 삭제 전 최종 확인
- [ ] `apps/channel-adapter/src/zods/coupang.api.zod.ts` 삭제
- [ ] Git에서 삭제 확인: `git status`

**예상 시간**: 10분

---

### Task 5.2: Import 정리

- [ ] 프로젝트 전체에서 `coupang.api.service` import 검색
- [ ] 프로젝트 전체에서 `coupang.api.zod` import 검색
- [ ] 남아있는 import 문 수정
- [ ] 사용하지 않는 import 제거
- [ ] Lint 실행: `npm run lint`

**예상 시간**: 30분

---

### Task 5.3: 문서 업데이트

- [ ] `README.md` 업데이트 (있는 경우)
- [ ] API 문서 업데이트
- [ ] 아키텍처 다이어그램 업데이트 (있는 경우)
- [ ] 변경 사항 요약 문서 작성:
  - 변경된 파일 목록
  - 새로 추가된 파일 목록
  - 삭제된 파일 목록
  - 주요 변경 사항

**예상 시간**: 1시간

---

### Task 5.4: 코드 리뷰 준비

- [ ] PR(Pull Request) 생성
- [ ] PR 설명 작성:
  - 변경 목적
  - 주요 변경 사항
  - 테스트 결과
  - 스크린샷 (필요시)
- [ ] 리뷰어 지정
- [ ] 라벨 추가 (refactoring, breaking-change 등)

**예상 시간**: 30분

---

### Task 5.5: 최종 검증

- [ ] 모든 테스트 통과 확인
- [ ] 빌드 성공 확인
- [ ] 코드 커버리지 확인
- [ ] 성능 테스트 (필요시)
- [ ] 메모리 누수 확인 (필요시)
- [ ] 문서 완성도 확인

**예상 시간**: 1시간

**Phase 5 총 예상 시간**: ~3시간

---

## 📊 전체 요약

| Phase    | 주요 작업                | 예상 시간  | 상태    |
| -------- | ------------------------ | ---------- | ------- |
| Phase 1  | Zod 스키마 분리          | 4시간      | ⬜ 대기 |
| Phase 2  | Base 클래스 생성         | 2시간      | ⬜ 대기 |
| Phase 3  | 도메인별 클라이언트 생성 | 10시간     | ⬜ 대기 |
| Phase 4  | Adapter 수정             | 5시간      | ⬜ 대기 |
| Phase 5  | 정리 및 문서화           | 3시간      | ⬜ 대기 |
| **총계** |                          | **24시간** |         |

**실제 작업 일수**: 약 3-4일 (하루 6-8시간 작업 기준)

---

## 🚨 주의사항

### 작업 중 체크포인트

- [ ] 각 Phase 완료 후 반드시 테스트 실행
- [ ] 컴파일 에러 발생 시 즉시 해결
- [ ] 변경 사항은 작은 단위로 커밋
- [ ] 기존 기능이 정상 동작하는지 수시로 확인

### 롤백 계획

- [ ] 각 Phase 시작 전 브랜치 생성
- [ ] 문제 발생 시 이전 Phase로 롤백 가능하도록 준비
- [ ] 기존 파일 삭제 전 백업 보관

### 커뮤니케이션

- [ ] 팀원들에게 리팩토링 시작 공지
- [ ] 주요 변경 사항 공유
- [ ] 문제 발생 시 즉시 보고

---

## ✅ 완료 기준

- [ ] 모든 기존 테스트 통과
- [ ] 새로운 단위 테스트 작성 완료
- [ ] 코드 리뷰 승인
- [ ] 문서 업데이트 완료
- [ ] CI/CD 파이프라인 통과
- [ ] 프로덕션 배포 준비 완료

---

## 📝 참고 링크

- 명세서: `docs/coupang-api-refactoring-spec.md`
- 기존 서비스: `apps/channel-adapter/src/services/apis/coupang.api.service.ts`
- 기존 Zod: `apps/channel-adapter/src/zods/coupang.api.zod.ts`
- Adapter: `apps/channel-adapter/src/services/adapters/coupang.adapter.ts`
