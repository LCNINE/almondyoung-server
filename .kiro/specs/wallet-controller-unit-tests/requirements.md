# Requirements Document

## Introduction

아몬드영 wallet 서버의 controller 계층에 대한 포괄적인 단위테스트 구현이 필요합니다. 현재 시스템은 hms-api-wrapper를 통해 외부 결제 시스템과 통신하며, 신용카드 결제는 PG사의 테스트서버를, BNPL(Buy Now Pay Later) 서비스는 mock 서버를 사용해야 합니다. 환경변수를 통해 이러한 분기를 관리하고, 기존 비즈니스 로직의 변경을 최소화하면서 모든 테스트가 통과하도록 해야 합니다.

## Requirements

### Requirement 1

**User Story:** As a developer, I want comprehensive unit tests for all wallet controllers, so that I can ensure the API endpoints work correctly with external payment systems.

#### Acceptance Criteria

1. WHEN running unit tests THEN all payment controller endpoints SHALL be tested with proper mocking
2. WHEN running unit tests THEN all payment-method controller endpoints SHALL be tested with proper mocking
3. WHEN running unit tests THEN all BNPL controller endpoints SHALL be tested with proper mocking
4. WHEN running unit tests THEN all payment-session controller endpoints SHALL be tested with proper mocking
5. WHEN running unit tests THEN all refund controller endpoints SHALL be tested with proper mocking
6. WHEN running unit tests THEN all settlement controller endpoints SHALL be tested with proper mocking

### Requirement 2

**User Story:** As a developer, I want environment-based configuration for external API testing, so that I can use appropriate test servers for different payment methods.

#### Acceptance Criteria

1. WHEN USE_MOCK environment variable is true THEN BNPL services SHALL use mock server responses
2. WHEN USE_MOCK environment variable is false THEN BNPL services SHALL use real HMS API wrapper
3. WHEN testing card payments THEN system SHALL use PG test server configuration
4. WHEN testing BNPL payments THEN system SHALL use mock server configuration based on USE_MOCK flag
5. IF environment variables are missing THEN system SHALL default to mock mode for safety

### Requirement 3

**User Story:** As a developer, I want proper mocking of hms-api-wrapper integration, so that unit tests can run independently without external dependencies.

#### Acceptance Criteria

1. WHEN running unit tests THEN hms-api-wrapper calls SHALL be properly mocked
2. WHEN mocking HMS API responses THEN realistic response structures SHALL be used
3. WHEN testing error scenarios THEN appropriate error responses SHALL be mocked
4. WHEN testing success scenarios THEN valid success responses SHALL be mocked
5. IF hms-api-wrapper is not available THEN tests SHALL still pass with mocked responses

### Requirement 4

**User Story:** As a developer, I want minimal changes to existing business logic, so that the current functionality remains intact while adding comprehensive testing.

#### Acceptance Criteria

1. WHEN implementing tests THEN existing controller logic SHALL NOT be modified unless absolutely necessary
2. WHEN implementing tests THEN existing service dependencies SHALL be properly mocked
3. WHEN tests fail due to business logic issues THEN only critical bugs SHALL be fixed
4. WHEN tests fail due to test setup issues THEN test configuration SHALL be adjusted instead of business logic
5. IF business logic changes are required THEN they SHALL be minimal and well-documented

### Requirement 5

**User Story:** As a developer, I want proper test data and fixtures, so that tests can simulate realistic payment scenarios.

#### Acceptance Criteria

1. WHEN creating test data THEN realistic payment amounts and user IDs SHALL be used
2. WHEN creating test data THEN valid card information formats SHALL be used for card tests
3. WHEN creating test data THEN valid BNPL member information SHALL be used for BNPL tests
4. WHEN creating test data THEN proper session IDs and payment method IDs SHALL be generated
5. IF test data is invalid THEN tests SHALL provide clear error messages

### Requirement 6

**User Story:** As a developer, I want comprehensive error handling tests, so that I can verify proper HTTP status codes and error messages are returned.

#### Acceptance Criteria

1. WHEN testing error scenarios THEN proper HTTP status codes SHALL be returned (400, 404, 500)
2. WHEN testing validation errors THEN BadRequestException SHALL be thrown with descriptive messages
3. WHEN testing not found scenarios THEN NotFoundException SHALL be thrown with appropriate messages
4. WHEN testing server errors THEN InternalServerErrorException SHALL be handled gracefully
5. IF unexpected errors occur THEN they SHALL be caught and converted to appropriate HTTP exceptions

### Requirement 7

**User Story:** As a developer, I want idempotency testing, so that I can verify duplicate requests are handled correctly.

#### Acceptance Criteria

1. WHEN testing endpoints with idempotency keys THEN duplicate requests SHALL return same results
2. WHEN testing without idempotency keys THEN requests SHALL be processed normally
3. WHEN testing with invalid idempotency keys THEN appropriate validation SHALL occur
4. WHEN testing idempotent operations THEN no side effects SHALL occur on duplicate calls
5. IF idempotency is not supported THEN tests SHALL verify normal processing behavior

### Requirement 8

**User Story:** As a developer, I want file upload testing for BNPL consent, so that I can verify file handling works correctly.

#### Acceptance Criteria

1. WHEN testing BNPL consent submission THEN file upload functionality SHALL be tested
2. WHEN testing with valid file types THEN uploads SHALL be processed successfully
3. WHEN testing with invalid file types THEN appropriate validation errors SHALL be returned
4. WHEN testing with oversized files THEN size limit validation SHALL be enforced
5. IF file is missing THEN appropriate error messages SHALL be returned