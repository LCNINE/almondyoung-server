# Implementation Plan

## Task Execution Rules

**중요**: 각 task 완료 후 반드시 다음 프로세스를 따라야 합니다:

1. ✅ Task 구현 완료
2. 🔍 코드 리뷰 요청 및 피드백 반영
3. 💾 개별 커밋 생성 (커밋 메시지 형식: `feat(payment): [task description]` 또는 `refactor(payment): [task description]`)
4. ➡️ 다음 task로 진행

## Tasks

- [x] 1. 스키마 변경 및 마이그레이션
  - `payment_attempts` 테이블에 `providerResponseSnapshot` jsonb 컬럼 추가
  - `payment_attempts` 테이블에서 `errorMessage` 컬럼 제거
  - `payment_attempts` 테이블에서 `eventContext` → `requestMetadata` 리네임
  - `bnpl_events` 테이블에서 `cmsResponseSnapshot` 컬럼 제거
  - 새 테이블 `bnpl_cms_responses` 생성 (batchId, accountId, eventId, responseType, cmsResponseSnapshot, previousStatus, newStatus, metadata, createdAt)
  - 인덱스 생성 (batch_id, account_id, event_id, response_type, created_at)
  - Drizzle 스키마 파일 업데이트 (`apps/wallet/src/shared/database/schema.ts`)
  - 마이그레이션 파일 생성 및 테스트
  - _Requirements: 1.1, 2.1, 3.1, 5.1_

- [x] 2. PaymentAttemptRepository 업데이트
  - `create()` 메서드 수정: `result.raw`를 `providerResponseSnapshot`에 저장
  - `create()` 메서드 수정: `request.metadata`를 `requestMetadata`에 저장 (eventContext → requestMetadata)
  - `errorMessage` 필드 제거
  - `getErrorMessage()` 헬퍼 메서드 추가 (provider별 에러 메시지 추출)
  - `updateStatusBatch()` 메서드 추가 (여러 attempt 상태 일괄 업데이트)
  - _Requirements: 1.1, 2.1, 6.1_

- [x] 3. BnplCmsResponseRepository 생성
  - 새 Repository 파일 생성 (`apps/wallet/src/services/bnpl-cms-response.repository.ts`)
  - `createResponse()` 메서드 구현 (CMS 응답 기록)
  - `findByBatchId()` 메서드 구현 (배치별 이력 조회)
  - `findByAccountId()` 메서드 구현 (계정별 이력 조회)
  - `findByEventId()` 메서드 구현 (이벤트별 이력 조회)
  - `findLatestByBatchId()` 메서드 구현 (최신 응답 조회)
  - DI 설정 (app.module.ts에 provider 등록)
  - _Requirements: 3.1, 3.2, 6.2_

- [x] 4. BnplSettlementService 생성
  - 새 Service 파일 생성 (`apps/wallet/src/services/bnpl-settlement.service.ts`)
  - `createMonthlyBatch()` 메서드 구현 (월말 배치 생성 및 CMS 출금 신청)
  - `processCmsResult()` 메서드 구현 (CMS 출금 결과 처리 - 성공/실패)
  - `retryFailedBatch()` 메서드 구현 (실패한 배치 재시도)
  - `getBatchStatus()` 메서드 구현 (배치 상태 조회)
  - 트랜잭션 처리 로직 구현
  - DI 설정 (app.module.ts에 provider 등록)
  - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. BnplAccountService 업데이트
  - `updateCmsResponse()` 메서드 제거 (BnplSettlementService로 이동)
  - `restoreCreditLimit()` 메서드 추가 (CMS 실패 시 한도 복원)
  - 기존 메서드에서 `cmsResponseSnapshot` 관련 로직 제거
  - _Requirements: 4.4, 7.4_

- [x] 6. 통합 테스트 작성
  - BNPL 전체 플로우 테스트 (주문 → 배치 생성 → CMS 성공 → CAPTURED)
  - BNPL 실패 및 재시도 테스트 (주문 → 배치 생성 → CMS 실패 → 재시도 → 성공)
  - Provider 응답 저장 테스트 (HMS_CARD, HMS_BNPL, TOSS)
  - 에러 메시지 추출 테스트 (getErrorMessage 헬퍼)
  - CMS 응답 이력 조회 테스트
  - 테스트 파일: `apps/wallet/test/integration/payment-response-storage.integration.spec.ts`
  - _Requirements: 1.1, 3.4, 4.1, 4.2, 4.3_

- [x] 7. 레이어 아키텍처 리팩토링
  - BnplSettlementService를 Business Layer (Port)로 리팩토링
  - Implementation Layer 클래스 생성:
    - `bnpl-batch-creator.impl.ts` - 배치 생성 로직
    - `bnpl-cms-processor.impl.ts` - CMS 결과 처리 로직
    - `bnpl-retry-manager.impl.ts` - 재시도 관리 로직
  - BnplSettlementService에서 Repository 직접 참조 제거
  - Implementation Layer가 Repository를 사용하도록 변경
  - app.module.ts에 Implementation Layer providers 등록
  - 테스트 모듈에 Implementation Layer providers 추가
  - 모든 테스트 통과 확인 (9개 테스트)
  - _Requirements: Layer Architecture 규칙 준수_

## Notes

- 각 task는 독립적으로 커밋되어야 합니다
- 코드 리뷰는 각 task 완료 후 진행합니다
- Kafka 이벤트 발행은 이번 spec에서 제외됩니다 (추후 구현)
- Redis 캐싱은 이번 spec에서 제외됩니다 (추후 구현)
- 스케줄러 구현은 제외됩니다 (메서드만 구현)
- 기존 데이터 마이그레이션은 제외됩니다 (새 스키마만 적용)

## Commit Message Examples

```bash
# Task 1
git commit -m "refactor(payment): add providerResponseSnapshot and remove errorMessage from payment_attempts"

# Task 2
git commit -m "refactor(payment): update PaymentAttemptRepository to use providerResponseSnapshot"

# Task 3
git commit -m "feat(payment): add BnplCmsResponseRepository for CMS response history tracking"

# Task 4
git commit -m "feat(payment): add BnplSettlementService for batch processing"

# Task 5
git commit -m "refactor(payment): update BnplAccountService and remove CMS response logic"

# Task 6
git commit -m "test(payment): add integration tests for payment response storage refactor"
```
