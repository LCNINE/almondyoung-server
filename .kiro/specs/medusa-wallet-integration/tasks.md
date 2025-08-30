# Implementation Plan

- [x ] 1. Set up core project structure and types

  - Create shared types for payments, refunds, BNPL, and admin operations
  - Define error codes and standard error response interfaces
  - Set up controllers/ and services/ folder structure
  - Configure root app.module.ts to register all controllers and services
  - _Requirements: 1.1, 8.2, 9.2_

- [x ] 2. Implement database layer and core models

  - Set up Drizzle ORM configuration and database connection
  - Create database service with connection management in services/ folder
  - Implement basic database operations for payment sessions and events
  - _Requirements: 1.1, 2.1, 2.2_

- [ ] 3. Create payment gateway adapter interfaces and mock implementation

  - Define PaymentGatewayPort interface with core methods
  - Implement MockAdapter for testing with success/failure scenarios
  - Create adapter registry for gateway selection
  - _Requirements: 5.1, 5.2, 5.5_

- [ ] 4. Implement idempotency service

  - Create IdempotencyService in services/ folder with key generation and validation
  - Implement request deduplication logic with 24-hour expiry
  - Add database operations for idempotency key storage
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 5. Build payment session management

  - Implement PaymentSessionsController in controllers/ folder with create session endpoint
  - Create PaymentsService in services/ folder with session creation logic
  - Add checkout URL generation and session expiry handling
  - Implement Medusa PaymentSession.id mapping to metadata.medusaPaymentSessionId
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 6. Implement payment approval and state management

  - Add payment approval endpoint to PaymentsController in controllers/ folder
  - Implement payment event creation and session phase updates in PaymentsService
  - Handle both autocapture and manual capture modes with proper phase transitions
  - Create payment status query functionality with paymentKey support
  - _Requirements: 2.1, 2.2, 2.3, 2.7, 1.6_

- [ ] 7. Add manual capture and void operations

  - Implement manual capture endpoint for AUTHORIZED payments in PaymentsController
  - Add void/cancel operation for pending payments
  - Create payment state transition validation in PaymentsService
  - Write tests for capture and void workflows
  - _Requirements: 2.4, 2.5, 2.6_

- [ ] 8. Implement BNPL account and hold management

  - Create BnplService in services/ folder with account creation and management
  - Implement BNPL hold creation during payment authorization with internal ledger management
  - Add credit limit validation and balance tracking
  - Create BNPL event recording with paymentKey references for audit trail
  - Implement separation between internal ledger and external BatchCMS payment execution
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.7_

- [ ] 9. Build refund processing system

  - Implement RefundsController in controllers/ folder with refund creation endpoint
  - Create RefundsService in services/ folder with gateway integration
  - Add refund event creation and payment status updates
  - Support partial refunds with amount validation
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 10. Create BatchCMS payment gateway adapter

  - Implement BatchCmsAdapter with real API integration and paymentKey handling
  - Add authentication, request formatting, and response parsing
  - Implement retry logic with exponential backoff for timeouts
  - Handle gateway-specific error codes and mapping to standardized error codes
  - Ensure paymentKey is used as unique provider identifier for all operations
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 11. Implement monthly BNPL settlement batch processing

  - Create BatchService in services/ folder for monthly settlement operations
  - Implement settlement batch creation and item processing
  - Add BNPL hold capture during settlement
  - Create admin endpoint for manual batch execution
  - _Requirements: 3.3, 7.4_

- [ ] 12. Build admin operations and monitoring

  - Create AdminController in controllers/ folder with payment query and management endpoints
  - Implement payment filtering by user, status, and date range
  - Add payment timeline view with all events
  - Create manual capture and void operations for admin use
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 13. Add error handling and logging

  - Implement structured logging with payment context including action, provider, paymentId, paymentKey, status
  - Create error categorization with standardized error codes (VALIDATION*\*, PG*\*, IDEMPOTENCY_CONFLICT, BNPL_ONBOARDING_REQUIRED)
  - Add validation error handling with field-specific messages
  - Implement health check endpoint in controllers/ folder for monitoring
  - Ensure sensitive payment details are excluded from logs
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 14. Create comprehensive test suite

  - Create integration tests for API endpoints using MockAdapter
  - Test error scenarios and edge cases with standardized error codes
  - Verify idempotency behavior and event sourcing workflows
  - Test BNPL limit enforcement and paymentKey handling
  - _Requirements: All requirements validation_

- [ ] 15. Set up application configuration and deployment preparation

  - Configure environment variables for database and gateway settings
  - Set up NestJS application bootstrap with proper module imports in app.module.ts
  - Create Docker configuration for containerized deployment
  - Add basic security headers and request validation
  - _Requirements: 9.1, 9.3_

- [ ] 16. Implement separate payment sessions controller

  - Create dedicated PaymentSessionsController for session management operations
  - Move session creation logic from PaymentsController to PaymentSessionsController
  - Ensure clear separation between session management and payment operations
  - Update routing and endpoint organization for better API structure
  - _Requirements: 10.1_

- [ ] 17. Add paymentKey management and tracking
  - Implement paymentKey storage and retrieval in all payment operations
  - Add paymentKey-based lookup functionality in services
  - Ensure paymentKey is included in all event logging and audit trails
  - Create database indexes for efficient paymentKey queries
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
