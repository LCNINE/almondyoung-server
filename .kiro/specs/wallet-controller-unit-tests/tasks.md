# Implementation Plan

- [x] 1. Set up test infrastructure and shared utilities
  - Create shared test utilities for service mocking and test module configuration
  - Implement TestApiClientFactory that leverages hms-api-wrapper's existing Mock/Real switching
  - Create MockDataGenerator for consistent test data across all controller tests
  - Set up test fixtures and response builders for realistic test scenarios
  - Configure environment variable management for different test scenarios
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Implement PaymentController unit tests
  - [x] 2.1 Create PaymentController test suite with proper mocking setup
    - Set up NestJS testing module with mocked PaymentService dependency
    - Configure environment-based HMS API client mocking
    - Create test data fixtures for payment processing scenarios
    - _Requirements: 1.1, 3.1, 3.2, 4.1, 4.2_

  - [x] 2.2 Implement processPayment endpoint tests
    - Write tests for successful payment processing with different payment methods (CARD, BNPL, POINT)
    - Test idempotency key handling for duplicate requests
    - Test validation error scenarios (invalid amounts, missing required fields)
    - Test not found scenarios (invalid session ID, payment method ID)
    - Test server error handling and proper HTTP status code mapping
    - _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.3 Implement captureDeferred endpoint tests
    - Write tests for successful BNPL capture operations
    - Test authorization not found error scenarios
    - Test already captured scenarios with proper error handling
    - Test invalid authorization ID validation
    - _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 6.5_

- [-] 3. Implement PaymentMethodController unit tests
  - [x] 3.1 Create PaymentMethodController test suite with service mocking
    - Set up NestJS testing module with mocked PaymentService and PaymentMethodService
    - Configure HMS API wrapper mocking for card and point payment methods
    - Create test fixtures for payment method registration scenarios
    - _Requirements: 1.2, 3.1, 3.2, 4.1, 4.2_

  - [x] 3.2 Implement registerPointMethod endpoint tests
    - Write tests for successful point payment method registration
    - Test validation errors for invalid point method data
    - Test idempotency key handling for duplicate registration requests
    - Test service error handling and HTTP status code mapping
    - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 3.3 Implement registerRecurringCard endpoint tests
    - Write tests for successful HMS CMS card registration
    - Test card information validation (card number, expiry date, holder name)
    - Test HMS API error handling and proper error message mapping
    - Test idempotency support for card registration
    - _Requirements: 1.2, 2.3, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 3.4 Implement getUserPaymentMethods endpoint tests
    - Write tests for successful payment method list retrieval
    - Test user not found scenarios
    - Test empty payment method list handling
    - Test status filtering functionality
    - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [-] 3.5 Implement setDefaultPaymentMethod and deletePaymentMethod endpoint tests
    - Write tests for successful default payment method setting
    - Write tests for successful payment method deletion
    - Test validation errors for invalid method IDs
    - Test not found scenarios for non-existent payment methods
    - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 4. Implement BnplController unit tests
  - [ ] 4.1 Create BnplController test suite with HMS API mocking
    - Set up NestJS testing module with mocked PaymentService
    - Configure mock HMS API responses for BNPL operations based on USE_MOCK environment variable
    - Create test fixtures for BNPL member registration and consent scenarios
    - _Requirements: 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2_

  - [ ] 4.2 Implement registerBnplMember endpoint tests
    - Write tests for successful BNPL member registration with mock HMS API
    - Test validation errors for invalid member data
    - Test HMS API error simulation and proper error handling
    - Test idempotency key handling for duplicate member registration
    - _Requirements: 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 4.3 Implement submitConsent endpoint tests with file upload mocking
    - Write tests for successful consent file submission using mock file objects
    - Test file validation (file type, file size limits)
    - Test missing file error scenarios
    - Test HMS API file upload error handling
    - Mock multer file objects for realistic file upload testing
    - _Requirements: 1.3, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 4.4 Implement getBnplMemberStatus endpoint tests
    - Write tests for successful BNPL member status retrieval
    - Test member not found error scenarios
    - Test HMS API error handling and status mapping
    - Test different member status scenarios (PENDING, ACTIVE, INACTIVE)
    - _Requirements: 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 5. Implement PaymentSessionController unit tests
  - [ ] 5.1 Create PaymentSessionController test suite with service mocking
    - Set up NestJS testing module with mocked PaymentSessionService
    - Create test fixtures for payment session creation and retrieval
    - Configure realistic session data with proper expiration and status handling
    - _Requirements: 1.4, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 5.2 Implement createSession endpoint tests
    - Write tests for successful payment session creation
    - Test validation errors for invalid session data (negative amounts, missing user ID)
    - Test idempotency key handling for duplicate session creation
    - Test checkout URL generation and proper response format
    - _Requirements: 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.3 Implement getSession endpoint tests
    - Write tests for successful session retrieval
    - Test session not found error scenarios
    - Test session status mapping and expiration handling
    - Test proper response format with checkout information
    - _Requirements: 1.4, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 6. Implement RefundController unit tests
  - [ ] 6.1 Create RefundController test suite with service mocking
    - Set up NestJS testing module with mocked RefundService
    - Create test fixtures for refund request scenarios
    - Configure realistic refund data with proper amount and payment reference handling
    - _Requirements: 1.5, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 6.2 Implement refund endpoint tests
    - Write tests for successful full refund processing
    - Write tests for successful partial refund processing
    - Test validation errors for invalid refund amounts (exceeding original payment)
    - Test payment not found error scenarios
    - Test already refunded scenarios and proper error handling
    - _Requirements: 1.5, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 7. Implement SettlementController unit tests
  - [ ] 7.1 Create SettlementController test suite with service mocking
    - Set up NestJS testing module with mocked SettlementService
    - Create test fixtures for settlement batch processing scenarios
    - Configure realistic settlement data with proper batch status handling
    - _Requirements: 1.6, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 7.2 Implement runMonthlySettlement endpoint tests
    - Write tests for successful monthly settlement batch execution
    - Test settlement processing with multiple payment events
    - Test error handling for settlement failures
    - Test batch status reporting and proper response format
    - _Requirements: 1.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 7.3 Implement getBatchStatus and retryFailedBatch endpoint tests
    - Write tests for successful batch status retrieval
    - Write tests for successful failed batch retry operations
    - Test batch not found error scenarios
    - Test maximum retry limit enforcement
    - Test manual review flagging for repeatedly failed batches
    - _Requirements: 1.6, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 8. Configure environment-based testing and validation
  - [ ] 8.1 Set up environment variable configuration for test execution
    - Configure USE_MOCK environment variable handling in test setup
    - Set up test-specific environment variables for HMS API credentials
    - Configure mock server URL settings for BNPL testing
    - Create test environment configuration files
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 8.2 Implement test execution with different environment configurations
    - Create test scripts for mock-only execution (USE_MOCK=true)
    - Create test scripts for mixed execution (card PG test server, BNPL mock)
    - Validate that all tests pass in both configurations
    - Test environment variable fallback to mock mode for safety
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 9. Final validation and test execution
  - [ ] 9.1 Run comprehensive test suite validation
    - Execute all controller tests with mock configuration
    - Execute card payment tests with PG test server configuration
    - Validate test coverage meets requirements (minimum 80% coverage)
    - Verify all error scenarios are properly tested
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 9.2 Fix any failing tests and optimize test performance
    - Debug and fix any failing test cases
    - Optimize test execution time and resource usage
    - Ensure test isolation and proper cleanup
    - Validate that business logic remains unchanged unless critical bugs are found
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_