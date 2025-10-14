# Requirements Document

## Introduction

현재 결제 시스템에서 사용자가 동시에 여러 결제창을 열거나, 결제 과정에서 알 수 없는 상태가 발생할 수 있는 문제를 해결하기 위한 가벼운 수정 작업입니다. 이 작업은 기존 구조를 크게 변경하지 않고 DB 제약조건과 서비스 로직 개선을 통해 안정성을 높이는 것을 목표로 합니다.

## Requirements

### Requirement 1

**User Story:** As a user, I want to seamlessly switch between payment windows on different devices, so that I can complete my payment without being blocked by previous sessions.

#### Acceptance Criteria

1. WHEN a user attempts to authorize a payment for an intent THEN the system SHALL check if there is already an active payment attempt for that intent
2. WHEN an active payment attempt exists with status 'PENDING', 'REQUIRES_ACTION', or 'PROCESSING' THEN the system SHALL automatically cancel the previous attempt and proceed with the new one
3. WHEN the system cancels a previous attempt THEN it SHALL set the previous attempt status to 'CANCELED' and log the cancellation
4. WHEN a user tries to open a second payment window on a different device or tab THEN the database SHALL prevent creation of duplicate active attempts through unique constraint as a safety net

### Requirement 2

**User Story:** As a system administrator, I want payment intents to handle unknown states gracefully, so that payments don't get stuck in limbo when external payment succeeds but internal processing fails.

#### Acceptance Criteria

1. WHEN external payment authorization succeeds but internal processing fails THEN the system SHALL set the intent status to 'UNKNOWN'
2. WHEN a user retries payment on an intent with 'UNKNOWN' status THEN the system SHALL query the payment provider to recover the actual status
3. IF the provider inquiry shows 'AUTHORIZED' or 'CAPTURED' status THEN the system SHALL update the intent status accordingly and return success
4. WHEN the payment intent status is 'UNKNOWN' THEN the system SHALL provide clear messaging to the user about checking payment status

### Requirement 3

**User Story:** As a developer, I want the database schema to support the new concurrent payment prevention and unknown state handling, so that the system can enforce these rules at the data layer.

#### Acceptance Criteria

1. WHEN the database migration runs THEN it SHALL create a unique index on payment_attempts table for (intent_id) WHERE status IN ('PENDING','REQUIRES_ACTION','PROCESSING')
2. WHEN the database migration runs THEN it SHALL add 'UNKNOWN' as a valid value to the payment_intent_status enum
3. WHEN two concurrent requests try to create active attempts for the same intent THEN the database SHALL reject the second request due to unique constraint violation as a safety net

### Requirement 4

**User Story:** As a user, I want to receive clear feedback when my previous payment session is automatically canceled, so that I understand what happened and can proceed confidently.

#### Acceptance Criteria

1. WHEN the system cancels a previous active attempt THEN it SHALL return a response code "PREVIOUS_ATTEMPT_CANCELED"
2. WHEN the client receives "PREVIOUS_ATTEMPT_CANCELED" response THEN it SHALL display a user-friendly message about the session switch
3. WHEN a previous attempt is canceled THEN the system SHALL log the cancellation with the previous attempt ID for debugging purposes
