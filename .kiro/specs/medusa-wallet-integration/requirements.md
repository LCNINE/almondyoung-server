# Requirements Document

## Introduction

This feature implements a Wallet payment server for Medusa.js integration in a small startup MVP environment. The system provides external payment server functionality supporting both immediate payment (autocapture) and BNPL (Buy Now Pay Later) with manual capture. The architecture uses redirect-based payment confirmation without webhooks, focusing on CS operations (inquiry/refund/cancel) and extensibility for future PG additions, Kafka events, and multi-merchant routing.

## Requirements

### Requirement 1: Payment Session Management

**User Story:** As a Medusa.js e-commerce platform, I want to create payment sessions through the Wallet server, so that customers can complete payments using various payment methods.

#### Acceptance Criteria

1. WHEN a payment session is requested THEN the system SHALL create a unique session with UUIDv7 identifier
2. WHEN creating a payment session THEN the system SHALL support both autocapture (requiresManualCapture: false) and BNPL (requiresManualCapture: true) modes
3. WHEN a payment session is created THEN the system SHALL return a checkout URL for customer redirection
4. WHEN a payment session is created THEN the system SHALL map Medusa PaymentSession.id to metadata.medusaPaymentSessionId
5. WHEN a payment session expires THEN the system SHALL mark it as expired and prevent further processing
6. IF requiresManualCapture is true THEN the system SHALL only authorize payments without automatic capture

### Requirement 2: Payment Processing and State Management

**User Story:** As a payment system, I want to manage payment states through a clear lifecycle, so that all payment operations are tracked and auditable.

#### Acceptance Criteria

1. WHEN a payment is initiated THEN the system SHALL set phase to PENDING
2. WHEN payment authorization succeeds THEN the system SHALL transition to AUTHORIZED phase
3. WHEN autocapture is enabled AND authorization succeeds THEN the system SHALL automatically transition to CAPTURED phase
4. WHEN manual capture is requested on AUTHORIZED payment THEN the system SHALL transition to CAPTURED phase
5. WHEN payment fails at any stage THEN the system SHALL transition to FAILED phase
6. WHEN payment is canceled before authorization THEN the system SHALL transition to CANCELED phase
7. WHEN payment is refunded THEN the system SHALL transition to REFUNDED phase

### Requirement 3: BNPL (Buy Now Pay Later) Support

**User Story:** As a customer, I want to use BNPL payment options, so that I can purchase items and pay later according to agreed terms.

#### Acceptance Criteria

1. WHEN BNPL payment is authorized THEN the system SHALL create a hold record and set phase to AUTHORIZED
2. WHEN BNPL payment is authorized THEN the system SHALL record hold in internal ledger (bnpl_events table)
3. WHEN monthly settlement batch runs THEN the system SHALL process holds into CAPTURED payments via posting
4. WHEN BNPL account is created THEN the system SHALL set credit limits and billing cycle day
5. WHEN BatchCMS API is called THEN the system SHALL use paymentKey as the unique provider identifier
6. IF user exceeds credit limit THEN the system SHALL reject new BNPL transactions
7. WHEN BNPL settlement occurs THEN the system SHALL manage internal ledger while external BatchCMS handles payment execution only

### Requirement 4: Refund Processing

**User Story:** As a merchant or customer service representative, I want to process refunds for completed payments, so that customers can receive money back for returned items or disputes.

#### Acceptance Criteria

1. WHEN refund is requested on CAPTURED payment THEN the system SHALL create refund event
2. WHEN refund is processed THEN the system SHALL call external payment gateway refund API
3. WHEN refund completes successfully THEN the system SHALL update payment status to REFUNDED
4. WHEN partial refund is requested THEN the system SHALL support multiple refund events up to original amount
5. IF refund fails at gateway THEN the system SHALL maintain REFUND_REQUESTED status for retry

### Requirement 5: Payment Gateway Integration

**User Story:** As a payment system, I want to integrate with external payment gateways through adapters, so that I can support multiple payment providers while maintaining consistent internal interfaces.

#### Acceptance Criteria

1. WHEN payment is processed THEN the system SHALL use appropriate gateway adapter based on payment method
2. WHEN gateway returns paymentKey THEN the system SHALL store it as the unique provider identifier for all internal operations
3. WHEN gateway operation fails THEN the system SHALL handle errors gracefully with standardized error codes (PG_TIMEOUT, PG_NETWORK, PG_DECLINED, PG_UNKNOWN)
4. WHEN timeout occurs THEN the system SHALL implement retry logic with exponential backoff
5. WHEN BatchCMS adapter is used THEN the system SHALL handle authentication, request formatting, and response parsing
6. IF gateway is unavailable THEN the system SHALL fail gracefully with appropriate error messages

### Requirement 6: Basic Idempotency

**User Story:** As a payment system, I want basic duplicate request protection, so that accidental double-clicks don't create duplicate payments.

#### Acceptance Criteria

1. WHEN API request includes Idempotency-Key header THEN the system SHALL check for existing operations
2. WHEN duplicate idempotent request is received THEN the system SHALL return cached response
3. WHEN idempotency key expires (24h) THEN the system SHALL allow new operations

### Requirement 7: Basic Admin Operations

**User Story:** As CS staff, I want to view and manage payments, so that I can help customers with payment issues.

#### Acceptance Criteria

1. WHEN admin queries payments THEN the system SHALL support basic filtering by user and status
2. WHEN admin views payment details THEN the system SHALL show payment events timeline
3. WHEN admin initiates manual capture THEN the system SHALL process capture for AUTHORIZED payments
4. WHEN admin runs monthly BNPL batch THEN the system SHALL capture eligible BNPL holds

### Requirement 8: Error Handling and Logging

**User Story:** As a developer, I want comprehensive error handling and structured logging, so that I can debug issues and monitor system health.

#### Acceptance Criteria

1. WHEN errors occur THEN the system SHALL log with structured format including action, provider, paymentId, paymentKey, and status
2. WHEN payment gateway fails THEN the system SHALL return standardized error codes (VALIDATION_*, PG_*, IDEMPOTENCY_CONFLICT, BNPL_ONBOARDING_REQUIRED)
3. WHEN validation fails THEN the system SHALL return clear field-specific error messages
4. WHEN health check is called THEN the system SHALL verify database connection and return status
5. WHEN logging payment operations THEN the system SHALL exclude sensitive payment details from logs

### Requirement 9: Basic Security

**User Story:** As a payment system, I want basic security practices, so that payment data is handled safely.

#### Acceptance Criteria

1. WHEN payment data is stored THEN the system SHALL not store raw card numbers
2. WHEN logs are generated THEN the system SHALL not log sensitive payment details
3. WHEN paymentKey is received THEN the system SHALL store it securely for reference
### Re
quirement 10: API Endpoint Structure

**User Story:** As a developer integrating with the Wallet server, I want clear and consistent API endpoints, so that I can easily implement payment flows.

#### Acceptance Criteria

1. WHEN creating payment sessions THEN the system SHALL provide POST /payment-sessions endpoint
2. WHEN approving payments THEN the system SHALL provide POST /payments/approve endpoint
3. WHEN capturing payments THEN the system SHALL provide POST /payments/:id/capture endpoint
4. WHEN voiding payments THEN the system SHALL provide POST /payments/:id/void endpoint
5. WHEN creating refunds THEN the system SHALL provide POST /payments/:id/refunds endpoint
6. WHEN querying admin data THEN the system SHALL provide GET /admin/payments with filtering capabilities
7. WHEN running batch operations THEN the system SHALL provide POST /admin/batch/capture/run endpoint
8. WHEN checking system health THEN the system SHALL provide GET /health endpoint

### Requirement 11: Payment Key Management

**User Story:** As a payment system, I want to properly manage payment keys from external providers, so that I can track and reference transactions consistently.

#### Acceptance Criteria

1. WHEN external PG issues paymentKey THEN the system SHALL store it as the unique provider identifier
2. WHEN internal operations reference transactions THEN the system SHALL use paymentKey for provider communication
3. WHEN events are logged THEN the system SHALL include paymentKey for traceability
4. WHEN database queries are performed THEN the system SHALL support lookup by paymentKey
5. WHEN audit trails are generated THEN the system SHALL include paymentKey in all relevant records