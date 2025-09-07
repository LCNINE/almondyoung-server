# Database Transaction and Concurrency Control Implementation

## Overview

This document describes the implementation of task 6.2: "데이터베이스 트랜잭션 및 동시성 제어" for the recurring payment system.

## Implementation Details

### 1. Atomic Transaction Processing

The `processRecurringPayment` method now wraps the entire payment process in a database transaction:

```typescript
return await this.db.db.transaction(async (tx) => {
    // 1. Acquire payment method lock
    await this.acquirePaymentMethodLock(tx, request.paymentMethodId, request.userId);
    
    // 2. Process payment through existing PaymentService
    const paymentResult = await this.paymentService.processPayment(...);
    
    // 3. Update PaymentEvents metadata within transaction
    if (paymentResult.success && paymentEventId) {
        await this.updatePaymentEventMetadata(tx, paymentEventId, ...);
    }
    
    return response;
});
```

### 2. Database-Level Concurrency Control

#### Payment Method Locking
- Uses `SELECT FOR UPDATE` to acquire exclusive locks on payment methods
- Prevents concurrent modifications during payment processing
- Validates payment method status after acquiring lock

```typescript
const [lockedPaymentMethod] = await tx
    .select({...})
    .from(schema.paymentMethod)
    .where(and(
        eq(schema.paymentMethod.id, paymentMethodId),
        eq(schema.paymentMethod.userId, userId)
    ))
    .for('update')  // Exclusive lock
    .limit(1);
```

#### Deadlock Handling
- Detects PostgreSQL deadlock error codes (40001, 40P01)
- Converts deadlocks to ConflictException with user-friendly message
- Implements retry logic with exponential backoff

### 3. Consistency Between PaymentEvents and Payment Processing

#### Enhanced Metadata Recording
- Records subscription payment metadata within the same transaction
- Ensures consistency between payment processing and event recording
- Includes concurrency control flags in metadata

```typescript
const enhancedMetadata = {
    ...existingMetadata,
    isSubscriptionPayment: true,
    subscriptionType: recurringMetadata.recurringContext?.subscriptionType,
    transactionProcessedAt: new Date().toISOString(),
    concurrencyControlApplied: true,
};
```

### 4. Retry Logic for Transient Failures

#### Automatic Retry with Exponential Backoff
```typescript
async processRecurringPaymentWithRetry(
    request: RecurringPaymentRequestDto,
    idempotencyKey?: string,
    maxRetries: number = 3
): Promise<RecurringPaymentResponseDto>
```

- Retries on deadlocks, serialization failures, and connection issues
- Uses exponential backoff: 1s, 2s, 4s (max 5s)
- Does not retry business logic errors (validation failures)

#### Retryable Error Detection
```typescript
private isRetryableError(error: any): boolean {
    const retryableErrorCodes = [
        '40001', // serialization_failure
        '40P01', // deadlock_detected
        '53300', // too_many_connections
        '08006', // connection_failure
    ];
    
    return retryableErrorCodes.includes(error.code) ||
           retryableMessages.some(msg => errorMessage.includes(msg));
}
```

## Requirements Compliance

### Requirement 7.4: Atomic Transaction Guarantee
✅ **Implemented**: All recurring payment operations are wrapped in database transactions
- Payment method validation and locking
- Payment processing through existing PaymentService
- PaymentEvents metadata updates
- Automatic rollback on any failure

### Requirement 7.5: Database-Level Concurrency Control
✅ **Implemented**: SELECT FOR UPDATE prevents concurrent access
- Exclusive locks on payment methods during processing
- Deadlock detection and retry logic
- Proper error handling for concurrent requests

## Key Features

1. **Atomic Operations**: All payment processing steps are atomic
2. **Deadlock Prevention**: SELECT FOR UPDATE with proper error handling
3. **Retry Logic**: Automatic retry for transient database errors
4. **Consistency**: PaymentEvents and payment processing are consistent
5. **Error Handling**: Proper distinction between retryable and non-retryable errors

## Test Coverage

The implementation includes comprehensive tests for:
- ✅ Atomic transaction processing
- ✅ Payment method locking with SELECT FOR UPDATE
- ✅ Deadlock detection and ConflictException handling
- ✅ Payment method status validation after lock acquisition
- ✅ PaymentEvents metadata updates within transactions
- ✅ Retry logic with exponential backoff
- ✅ Retryable vs non-retryable error classification

## Integration with Existing System

The implementation integrates seamlessly with:
- Existing PaymentService for payment processing
- Existing IdempotencyService for duplicate prevention
- Existing database schema and transaction patterns
- Existing error handling and logging systems

## Performance Considerations

1. **Lock Duration**: Locks are held only during critical sections
2. **Retry Backoff**: Exponential backoff prevents thundering herd
3. **Error Classification**: Quick failure for non-retryable errors
4. **Transaction Scope**: Minimal transaction scope for better concurrency

This implementation ensures that recurring payments are processed reliably with proper concurrency control and data consistency guarantees.