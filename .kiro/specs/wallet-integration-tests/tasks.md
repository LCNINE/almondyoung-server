# Implementation Plan

- [ ] 1. Set up integration test infrastructure
  - Create base integration test class with database transaction management
  - Implement test environment manager for NestJS application setup/teardown
  - Configure test-specific database connection and transaction isolation
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 2. Create integration test data management system
  - [ ] 2.1 Implement integration test data factory
    - Create factory methods for generating test users, payment methods, and BNPL members in actual database
    - Implement test data cleanup mechanisms with proper foreign key handling
    - Add test data isolation using unique test IDs and proper scoping
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 2.2 Create test transaction management utilities
    - Implement database transaction creation and rollback for test isolation
    - Add connection pool management specifically for integration tests
    - Create test data context tracking for proper cleanup
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 3. Implement external API integration testing framework
  - [ ] 3.1 Create API client test factory
    - Implement factory for creating real vs mocked HMS API clients based on environment
    - Add payment API client factory with configurable mock/real selection
    - Create mock response setup utilities for consistent API testing
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 3.2 Implement API error simulation utilities
    - Create utilities for simulating various API error conditions (timeout, network failure, invalid response)
    - Add API response validation helpers to ensure mock responses match real API format
    - Implement API call tracking and verification for integration tests
    - _Requirements: 5.1, 5.2, 5.4_

- [ ] 4. Create PaymentMethodController integration tests
  - [ ] 4.1 Implement createGeneralPaymentMethod integration tests
    - Write tests that verify actual database insertion of payment method data
    - Test HMS API integration with real/mocked API calls based on environment
    - Verify database constraint violations and proper error handling
    - Test transaction rollback on API failures
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 4.2 Implement createBNPLMethod integration tests
    - Write tests that verify actual database insertion of BNPL member data
    - Test HMS API integration for BNPL member registration
    - Verify duplicate member detection through database constraints
    - Test error handling for invalid member data with actual validation
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 4.3 Implement submitConsent integration tests
    - Write tests that verify database updates for consent submission
    - Test member lookup from actual database and proper error handling
    - Verify consent status updates and duplicate submission prevention
    - Test transaction integrity for consent processing
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 4.4 Implement getPaymentMethods integration tests
    - Write tests that verify actual database queries for payment method retrieval
    - Test user lookup and proper 404 handling from database
    - Verify payment method filtering and status handling from database
    - Test performance of payment method queries with realistic data volumes
    - _Requirements: 1.1, 1.3_

  - [ ] 4.5 Implement deletePaymentMethod integration tests
    - Write tests that verify actual database deletion of payment methods
    - Test foreign key constraint handling and cascade deletion
    - Verify default payment method protection through database constraints
    - Test transaction rollback on deletion failures
    - _Requirements: 1.1, 1.3, 1.4_

- [ ] 5. Create PaymentController integration tests
  - [ ] 5.1 Implement processPayment integration tests
    - Write tests that verify actual database queries for payment method lookup
    - Test payment record insertion and status updates in database
    - Verify external payment API integration with real/mocked calls
    - Test transaction rollback on payment processing failures
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 5.2 Implement getPaymentHistory integration tests
    - Write tests that verify actual database queries for payment history retrieval
    - Test user validation and proper error handling from database
    - Verify payment filtering and pagination with actual database data
    - Test query performance with realistic payment history volumes
    - _Requirements: 2.1, 2.2_

  - [ ] 5.3 Implement getPaymentStatus integration tests
    - Write tests that verify actual database queries for payment status lookup
    - Test payment ID validation and proper 404 handling from database
    - Verify status updates and real-time status checking
    - Test concurrent payment status updates and database consistency
    - _Requirements: 2.1, 2.2, 2.4_

- [ ] 6. Implement performance monitoring and testing
  - [ ] 6.1 Create test performance monitoring system
    - Implement API response time measurement during integration tests
    - Add database query performance tracking and reporting
    - Create memory usage monitoring for integration test execution
    - Generate performance reports with thresholds and alerts
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 6.2 Implement load testing for integration scenarios
    - Create concurrent user simulation for payment method operations
    - Test database connection pool behavior under load
    - Verify system behavior at memory and connection limits
    - Add stress testing for external API integration points
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 7. Create HMS API integration test scenarios (PRIORITY)
  - [ ] 7.1 Implement HMS paymentProfiles integration tests
    - Write tests that verify actual HMS API paymentProfiles.create() calls for card registration
    - Test HMS API paymentProfiles.get() for member validation and card info retrieval
    - Verify HMS API error handling and response parsing for paymentProfiles
    - Test database storage of HMS member IDs and payment method data consistency
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 7.2 Implement HMS paymentTryansactions integration tests
    - Write tests that verify actual HMS API paymentTryansactions.requestTryansaction() calls
    - Test HMS API paymentTryansactions.cancelTryansaction() for refund scenarios
    - Verify payment transaction data storage and HMS response integration
    - Test error scenarios with actual HMS API error responses
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 7.3 Implement complete HMS payment flow integration tests
    - Write end-to-end tests: HMS paymentProfiles.create() → Database storage → HMS paymentTryansactions.requestTryansaction()
    - Test HMS API failure scenarios and database rollback consistency
    - Verify HMS member ID lifecycle from registration to payment completion
    - Test concurrent HMS API calls and database transaction integrity
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4_

- [ ] 8. Create integration test documentation and usage guide
  - Write documentation for running integration tests locally
  - Create troubleshooting guide for common integration test issues
  - Document test data management and cleanup procedures
  - Add examples of how to add new integration tests
  - _Requirements: 4.4, 6.4_