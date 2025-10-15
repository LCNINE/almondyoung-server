# Requirements Document

## Introduction

멤버십 구독 취소 및 환불 기능을 구현한다. 사용자는 구독을 취소할 수 있고, 무료 체험 기간 중 취소 시 전액 환불을 받을 수 있다. 어드민은 정책을 무시하고 강제로 구독을 취소하고 환불 금액을 지정할 수 있다. 구독 계약의 모든 변경 이력은 이벤트 소싱 패턴으로 추적한다.

## Requirements

### Requirement 1: 취소 이유 관리

**User Story:** As a product manager, I want to manage cancellation reasons, so that I can analyze why users cancel their subscriptions

#### Acceptance Criteria

1. WHEN 시스템이 시작되면 THEN 취소 이유 마스터 테이블이 존재해야 한다
2. WHEN 취소 이유를 조회하면 THEN 활성화된 이유 목록이 정렬 순서대로 반환되어야 한다
3. WHEN 취소 이유가 코드, 표시 텍스트, 카테고리를 포함하면 THEN 데이터베이스에 저장되어야 한다

### Requirement 2: 일반 구독 취소

**User Story:** As a user, I want to cancel my subscription with a reason, so that I can stop my membership when I don't need it

#### Acceptance Criteria

1. WHEN 사용자가 활성 구독을 가지고 있고 취소를 요청하면 THEN 구독이 즉시 취소되어야 한다
2. WHEN 무료 체험 기간 중 취소하면 THEN 전액 환불 자격이 부여되어야 한다
3. WHEN 무료 체험 기간이 지난 후 취소하면 THEN 환불 자격이 없어야 한다
4. WHEN 구독이 취소되면 THEN subscriptionContracts의 status가 'CANCELLED'로 변경되어야 한다
5. WHEN 구독이 취소되면 THEN subscriptionEntitlement의 isCurrent가 false로 변경되어야 한다
6. WHEN 구독이 취소되면 THEN subscriptionContractEvents에 'CANCELLED' 이벤트가 추가되어야 한다
7. WHEN 환불 자격이 있으면 THEN subscriptionContractEvents에 'REFUND_REQUESTED' 이벤트가 추가되어야 한다
8. WHEN 취소 이유가 제공되면 THEN 이벤트 메타데이터에 이유 코드와 텍스트가 저장되어야 한다

### Requirement 3: 강제 구독 취소 (어드민)

**User Story:** As an admin, I want to force cancel a subscription with custom refund amount, so that I can handle exceptional cases like system failures

#### Acceptance Criteria

1. WHEN 어드민이 강제 취소를 요청하면 THEN 정책 검증을 건너뛰어야 한다
2. WHEN 어드민이 환불 타입을 'FULL'로 지정하면 THEN 전액 환불 금액이 계산되어야 한다
3. WHEN 어드민이 환불 타입을 'PARTIAL'로 지정하면 THEN 지정된 환불 금액이 사용되어야 한다
4. WHEN 어드민이 환불 타입을 'NONE'으로 지정하면 THEN 환불 금액이 0이어야 한다
5. WHEN 강제 취소가 실행되면 THEN subscriptionContractEvents에 isForced=true로 기록되어야 한다
6. WHEN 강제 취소가 실행되면 THEN 어드민 ID와 메모가 이벤트에 저장되어야 한다

### Requirement 4: 구독 계약 이벤트 소싱

**User Story:** As an admin, I want to see complete history of subscription changes, so that I can audit and resolve disputes

#### Acceptance Criteria

1. WHEN 구독 계약이 생성되면 THEN 'CREATED' 이벤트가 기록되어야 한다
2. WHEN 구독 계약이 변경되면 THEN 해당 이벤트 타입이 기록되어야 한다
3. WHEN 이벤트가 기록되면 THEN 이벤트 메타데이터에 변경 상세 정보가 포함되어야 한다
4. WHEN 이벤트가 기록되면 THEN causedBy 필드에 'USER', 'ADMIN', 'SYSTEM' 중 하나가 저장되어야 한다
5. WHEN 특정 계약의 이벤트를 조회하면 THEN 시간 순서대로 모든 이벤트가 반환되어야 한다
6. WHEN 이벤트가 추가되면 THEN subscriptionContracts의 lastEventId가 업데이트되어야 한다

### Requirement 5: 환불 상태 추적

**User Story:** As a user, I want to know my refund status, so that I can track when I will receive my refund

#### Acceptance Criteria

1. WHEN 환불이 요청되면 THEN subscriptionContracts의 refundRequested가 true로 설정되어야 한다
2. WHEN 환불이 요청되면 THEN eligibleRefundAmount가 저장되어야 한다
3. WHEN Wallet 서버에서 환불 완료 이벤트를 받으면 THEN 'REFUND_COMPLETED' 이벤트가 추가되어야 한다
4. WHEN 환불이 완료되면 THEN subscriptionContracts의 refundCompleted가 true로 설정되어야 한다
5. WHEN Wallet 서버에서 환불 실패 이벤트를 받으면 THEN 'REFUND_FAILED' 이벤트가 추가되어야 한다

### Requirement 6: 취소 정책 검증

**User Story:** As a system, I want to validate cancellation policies, so that refunds are only given when eligible

#### Acceptance Criteria

1. WHEN 구독 취소를 요청하면 THEN 무료 체험 기간 여부를 확인해야 한다
2. WHEN 무료 체험 기간을 확인하면 THEN plan.trialDays와 contract.billingDate를 사용해야 한다
3. WHEN 현재 날짜가 (billingDate + trialDays) 이전이면 THEN 환불 자격이 있어야 한다
4. WHEN 현재 날짜가 (billingDate + trialDays) 이후면 THEN 환불 자격이 없어야 한다
5. WHEN 환불 자격이 있으면 THEN plan.price가 환불 금액으로 계산되어야 한다

### Requirement 7: API 엔드포인트

**User Story:** As a developer, I want clear API endpoints, so that I can integrate cancellation features

#### Acceptance Criteria

1. WHEN POST /subscriptions/cancel을 호출하면 THEN 구독이 취소되고 환불 정보가 반환되어야 한다
2. WHEN POST /admin/subscriptions/:contractId/force-cancel을 호출하면 THEN 강제 취소가 실행되어야 한다
3. WHEN GET /admin/subscriptions/:contractId/events를 호출하면 THEN 계약의 모든 이벤트가 반환되어야 한다
4. WHEN GET /cancellation-reasons를 호출하면 THEN 활성화된 취소 이유 목록이 반환되어야 한다
