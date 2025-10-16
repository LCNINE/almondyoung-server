# Requirements Document

## Introduction

현재 결제 시스템은 provider 응답을 일관되지 않게 저장하고 있습니다. HMS 카드는 원본 응답을 저장하지 않고, BNPL은 `cmsResponseSnapshot`에 저장하며, 에러 메시지는 별도 필드에 중복 저장됩니다. 이로 인해 디버깅이 어렵고, 감사 추적이 불완전하며, 유지보수가 복잡합니다.

이 기능은 모든 결제 provider의 응답을 일관된 방식으로 저장하고, BNPL의 비동기 정산 프로세스를 명확하게 추적할 수 있도록 스키마와 저장 로직을 리팩토링합니다.

### 핵심 목표

1. 모든 provider 응답을 `providerResponseSnapshot`에 일관되게 저장
2. 중복 필드 제거 (errorMessage 등)
3. BNPL CMS 응답 이력을 별도 테이블로 분리하여 추적
4. Authorize/Capture 2단계 결제 패턴 명확화

## Requirements

### Requirement 1: Payment Attempts 응답 저장 표준화

**User Story:** As a developer, I want all payment provider responses to be stored consistently, so that I can debug issues and audit transactions effectively.

#### Acceptance Criteria

1. WHEN any payment provider (HMS_CARD, HMS_BNPL, TOSS, etc.) returns a response THEN the system SHALL store the complete response in `providerResponseSnapshot` jsonb field
2. WHEN a payment attempt is created THEN the system SHALL store both success and failure responses in the snapshot
3. WHEN querying payment attempts THEN the system SHALL be able to extract error messages from the snapshot without a separate `errorMessage` field
4. IF a provider response contains sensitive data THEN the system SHALL sanitize it before storage (out of scope for this spec)

### Requirement 2: 중복 필드 제거 및 정규화

**User Story:** As a system architect, I want to eliminate redundant data storage, so that the schema is cleaner and easier to maintain.

#### Acceptance Criteria

1. WHEN storing payment attempts THEN the system SHALL remove the `errorMessage` field from the schema
2. WHEN storing payment attempts THEN the system SHALL keep `transactionId` and `approvalNumber` fields for indexing and quick lookups
3. WHEN an error occurs THEN the system SHALL extract the error message from `providerResponseSnapshot` using a helper function
4. WHEN displaying payment lists THEN the system SHALL use jsonb extraction or helper functions to show error messages

### Requirement 3: BNPL CMS 응답 이력 추적

**User Story:** As a finance operations manager, I want to track all CMS withdrawal attempts and results, so that I can understand why payments failed and manage retries effectively.

#### Acceptance Criteria

1. WHEN a BNPL CMS batch withdrawal is requested THEN the system SHALL create a record in `bnpl_cms_responses` table with type 'BATCH_REQUEST_SUBMITTED'
2. WHEN a CMS withdrawal result is confirmed THEN the system SHALL create a new record in `bnpl_cms_responses` with type 'BATCH_RESULT_CONFIRMED'
3. WHEN a CMS withdrawal is retried THEN the system SHALL create a new record with type 'BATCH_RETRY_ATTEMPTED'
4. WHEN querying CMS history for an event THEN the system SHALL return all responses in chronological order
5. WHEN a CMS batch fails THEN the system SHALL store the complete HMS error response including error codes and messages

### Requirement 4: BNPL Authorize/Capture 패턴 구현

**User Story:** As a payment system developer, I want BNPL payments to follow the authorize-then-capture pattern, so that funds are only withdrawn after batch settlement.

#### Acceptance Criteria

1. WHEN a customer makes a BNPL purchase THEN the system SHALL create a payment attempt with status 'AUTHORIZED' (not 'CAPTURED')
2. WHEN the monthly CMS batch succeeds THEN the system SHALL update all related payment attempts to status 'CAPTURED'
3. WHEN the monthly CMS batch fails THEN the system SHALL update all related payment attempts to status 'FAILED'
4. WHEN a CMS batch fails THEN the system SHALL NOT support partial success (all or nothing)
5. WHEN a payment attempt is in 'AUTHORIZED' state THEN the system SHALL allow it to be captured or failed based on CMS results

### Requirement 5: 스키마 마이그레이션 및 데이터 무결성

**User Story:** As a database administrator, I want schema changes to be applied safely, so that existing data is preserved and the system continues to function.

#### Acceptance Criteria

1. WHEN applying schema changes THEN the system SHALL create a migration that adds `providerResponseSnapshot` to `payment_attempts`
2. WHEN applying schema changes THEN the system SHALL create a migration that removes `errorMessage` from `payment_attempts`
3. WHEN applying schema changes THEN the system SHALL create a new table `bnpl_cms_responses`
4. WHEN applying schema changes THEN the system SHALL remove `cmsResponseSnapshot` from `bnpl_events`
5. IF there is existing data THEN the migration SHALL preserve critical information (transactionId, status, etc.)

### Requirement 6: Repository 및 Service 레이어 업데이트

**User Story:** As a backend developer, I want repository and service methods to use the new schema, so that the application works correctly with the refactored structure.

#### Acceptance Criteria

1. WHEN creating a payment attempt THEN the repository SHALL save `result.raw` to `providerResponseSnapshot`
2. WHEN creating a BNPL CMS request THEN the service SHALL create a record in `bnpl_cms_responses`
3. WHEN updating CMS status THEN the service SHALL create a new history record instead of overwriting
4. WHEN querying error messages THEN the repository SHALL provide a helper method to extract from snapshot
5. WHEN a payment fails THEN the system SHALL NOT store error message in a separate field

### Requirement 7: BNPL 배치 처리 메서드 구현

**User Story:** As a finance operations developer, I want methods to handle BNPL batch processing, so that monthly settlements can be executed and tracked.

#### Acceptance Criteria

1. WHEN creating a monthly batch THEN the system SHALL provide a method to aggregate all pending BNPL events
2. WHEN submitting a CMS batch THEN the system SHALL update all events with the batch ID and due date
3. WHEN processing CMS results THEN the system SHALL provide a method to update all attempts and events based on success/failure
4. WHEN a batch fails THEN the system SHALL provide a method to restore credit limits
5. WHEN retrying a failed batch THEN the system SHALL create a new batch ID with retry suffix

### Requirement 8: 코드 리뷰 및 커밋 프로세스

**User Story:** As a team lead, I want each task to be reviewed and committed separately, so that changes are traceable and can be rolled back if needed.

#### Acceptance Criteria

1. WHEN a task is completed THEN the developer SHALL request a code review before proceeding
2. WHEN code review feedback is received THEN the developer SHALL apply all requested changes
3. WHEN all review feedback is addressed THEN the developer SHALL create a single commit for that task
4. WHEN committing THEN the commit message SHALL follow the format: `feat(payment): [task description]` or `refactor(payment): [task description]`
5. WHEN all tasks are complete THEN each task SHALL have its own commit in the git history

## Out of Scope

- Kafka 이벤트 발행 (추후 구현)
- Redis 캐싱 (추후 구현)
- 스케줄러 구현 (메서드만 구현, 스케줄러는 추후)
- 기존 데이터 마이그레이션 스크립트 (새 스키마만 적용)
- 민감 데이터 마스킹/암호화
- 프론트엔드 UI 변경
- API 엔드포인트 변경 (내부 로직만 수정)

## Success Metrics

- 모든 payment provider 응답이 `providerResponseSnapshot`에 저장됨
- `errorMessage` 필드가 스키마에서 제거됨
- BNPL CMS 응답 이력이 `bnpl_cms_responses` 테이블에 추적됨
- BNPL 결제가 AUTHORIZED → CAPTURED 패턴을 따름
- 각 task가 개별 커밋으로 관리됨
- 모든 기존 테스트가 통과함
