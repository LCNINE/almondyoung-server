# Design Document

## Overview

This design document outlines the comprehensive unit testing strategy for the almondyoung wallet server controllers. The testing framework will leverage Jest and NestJS testing utilities to create isolated unit tests that mock external dependencies while maintaining realistic test scenarios. The design focuses on environment-based configuration switching between real PG test servers for card payments and mock servers for BNPL services.

## Architecture

### Test Environment Configuration

The testing system will use a layered configuration approach:

1. **Environment Variables**: Primary configuration source
   - `USE_MOCK`: Boolean flag to control mock vs real API usage
   - `NODE_ENV`: Environment context (development/test/production)
   - `SW_KEY`, `CUST_KEY`: HMS API credentials
   - `MOCK_SERVER_URL`: Mock server endpoint

2. **Test Configuration Layer**: Jest setup and module configuration
   - Custom test modules with mocked dependencies
   - Environment-specific provider configurations
   - Shared test utilities and fixtures

3. **Mock Strategy Layer**: Intelligent mocking based on payment method
   - Card payments: Use PG test server when `USE_MOCK=false`
   - BNPL payments: Always use mock server for consistency
   - Point payments: Always use internal mock implementations

### Testing Strategy

#### Controller Testing Approach

Each controller will be tested using the NestJS Testing Module pattern:

```typescript
// Test Module Structure
TestingModule.createTestingModule({
  controllers: [ControllerUnderTest],
  providers: [
    {
      provide: ServiceDependency,
      useValue: mockServiceImplementation
    },
    // Environment-based HMS API provider
    {
      provide: 'HMS_API_CLIENT',
      useFactory: () => createTestApiClient()
    }
  ]
})
```

#### Mock Implementation Strategy

1. **Service Layer Mocking**: Mock all service dependencies with realistic return values
2. **HMS API Wrapper Mocking**: Use ApiClientFactory with test configuration
3. **Database Mocking**: Mock DbService with transaction support
4. **File Upload Mocking**: Mock multer file objects for BNPL consent testing

## Components and Interfaces

### Test Utilities

#### TestApiClientFactory
```typescript
interface TestApiClientConfig {
  useMock: boolean;
  paymentMethod: 'CARD' | 'BNPL' | 'POINT';
  testScenario?: 'success' | 'error' | 'timeout';
}

class TestApiClientFactory {
  static createForTest(config: TestApiClientConfig): HmsAPI | MockHmsAPI
  static createForBnpl(): MockHmsAPI
  static createForCard(useMock?: boolean): HmsAPI | MockHmsAPI
  static createDefault(): HmsAPI | MockHmsAPI
}
```

#### MockDataGenerator
```typescript
interface TestDataGenerator {
  generatePaymentSession(): PaymentSessionDto;
  generatePaymentMethod(type: PaymentMethodType): PaymentMethodDto;
  generateCardInfo(): CardInfoDto;
  generateBnplMember(): BnplMemberDto;
  generateFileUpload(): MockFile;
}
```

#### TestResponseBuilder
```typescript
interface TestResponseBuilder {
  buildSuccessResponse<T>(data: T): ApiResponse<T>;
  buildErrorResponse(statusCode: number, message: string): ApiErrorResponse;
  buildHmsApiResponse(scenario: TestScenario): HmsApiResponse;
}
```

### Controller Test Suites

#### PaymentController Tests
- **Process Payment Tests**
  - Success scenarios for each payment method
  - Error handling (validation, not found, server errors)
  - Idempotency key handling
  - Mixed payment method processing

- **Capture Deferred Tests**
  - BNPL capture success scenarios
  - Authorization not found errors
  - Already captured scenarios

#### PaymentMethodController Tests
- **Register Point Method Tests**
  - Successful point method registration
  - Validation error scenarios
  - Idempotency handling

- **Register Recurring Card Tests**
  - HMS CMS card registration success
  - Card validation errors
  - HMS API error handling

- **User Payment Methods Tests**
  - List user payment methods
  - Status filtering
  - Empty result handling

- **Set Default Payment Method Tests**
  - Successful default setting
  - Invalid method ID errors
  - Status validation

#### BnplController Tests
- **Register BNPL Member Tests**
  - Successful member registration
  - HMS API integration
  - Validation error handling

- **Submit Consent Tests**
  - File upload success scenarios
  - File validation (type, size)
  - Missing file errors
  - HMS API submission

- **Get BNPL Status Tests**
  - Member status retrieval
  - Not found scenarios
  - HMS API error handling

#### PaymentSessionController Tests
- **Create Session Tests**
  - Successful session creation
  - Validation error handling
  - Idempotency support
  - Checkout URL generation

- **Get Session Tests**
  - Session retrieval success
  - Not found scenarios
  - Status mapping

#### RefundController Tests
- **Refund Processing Tests**
  - Full refund scenarios
  - Partial refund scenarios
  - Validation errors
  - Payment not found errors

#### SettlementController Tests
- **Monthly Settlement Tests**
  - Batch processing success
  - Error handling
  - Status reporting

- **Batch Status Tests**
  - Status retrieval
  - Not found scenarios

- **Retry Failed Batch Tests**
  - Retry logic
  - Max retry limits
  - Manual review flagging

## Data Models

### Test Data Models

#### MockPaymentSession
```typescript
interface MockPaymentSession {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  expiresAt: Date;
  createdAt: Date;
  metadata?: Record<string, any>;
}
```

#### MockPaymentMethod
```typescript
interface MockPaymentMethod {
  id: string;
  userId: string;
  methodType: PaymentMethodType;
  methodName: string;
  status: PaymentMethodStatus;
  isDefault: boolean;
  hmsMemberId?: string;
  createdAt: Date;
}
```

#### MockHmsApiResponse
```typescript
interface MockHmsApiResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, any>;
}
```

### Test Scenario Models

#### PaymentTestScenario
```typescript
interface PaymentTestScenario {
  name: string;
  input: ProcessPaymentDto;
  expectedOutput: ProcessPaymentResponseDto;
  mockResponses: {
    paymentService: any;
    hmsApi?: any;
  };
  expectedErrors?: {
    statusCode: number;
    message: string;
  };
}
```

## Error Handling

### Test Error Scenarios

#### HTTP Status Code Testing
- **400 Bad Request**: Validation errors, business rule violations
- **404 Not Found**: Resource not found scenarios
- **500 Internal Server Error**: Unexpected errors, external API failures

#### Error Response Format Testing
```typescript
interface ExpectedErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
}
```

#### HMS API Error Simulation
- Network timeout errors
- Authentication failures
- Service unavailable responses
- Invalid request format errors

### Error Handling Test Patterns

#### Controller Error Mapping Tests
```typescript
describe('Error Handling', () => {
  it('should map service errors to appropriate HTTP status codes', async () => {
    // Test service error -> HTTP status mapping
  });
  
  it('should handle HMS API errors gracefully', async () => {
    // Test external API error handling
  });
  
  it('should provide meaningful error messages', async () => {
    // Test error message clarity
  });
});
```

## Testing Strategy

### Test Organization

#### Test File Structure
```
src/controllers/__tests__/
├── payment.controller.spec.ts
├── payment-method.controller.spec.ts
├── bnpl.controller.spec.ts
├── payment-session.controller.spec.ts
├── refund.controller.spec.ts
├── settlement.controller.spec.ts
└── shared/
    ├── test-utils.ts
    ├── mock-data.ts
    ├── test-fixtures.ts
    └── api-client-mocks.ts
```

#### Test Categories

1. **Happy Path Tests**: Successful operation scenarios
2. **Validation Tests**: Input validation and business rule enforcement
3. **Error Handling Tests**: Exception scenarios and error responses
4. **Integration Tests**: HMS API wrapper integration
5. **Idempotency Tests**: Duplicate request handling
6. **File Upload Tests**: Multipart form data handling (BNPL consent)

### Mock Strategy

#### Service Layer Mocking
- Mock all service dependencies with Jest mocks
- Provide realistic return values based on test scenarios
- Support both success and error scenarios

#### HMS API Wrapper Integration
- Leverage existing hms-api-wrapper Mock/Real switching via USE_MOCK environment variable
- Use ApiClientFactory.createFromEnv() for standard client creation
- TestApiClientFactory provides test-specific environment configuration
- BNPL always uses Mock mode, Card can use Test server or Mock based on credentials

#### Database Mocking
- Mock DbService with transaction support
- Simulate database constraints and errors
- Provide realistic query results

### Test Data Management

#### Fixture Management
- Centralized test data generation
- Consistent data formats across tests
- Easy scenario switching

#### Environment Configuration
- Test-specific environment variables
- Isolated test configurations
- Clean test state management

## Implementation Approach

### Phase 1: Test Infrastructure Setup
1. Create shared test utilities and fixtures
2. Implement mock data generators
3. Set up environment-based API client factory
4. Configure Jest test environment

### Phase 2: Controller Test Implementation
1. Implement PaymentController tests
2. Implement PaymentMethodController tests
3. Implement BnplController tests
4. Implement remaining controller tests

### Phase 3: Integration and Validation
1. Run all tests with mock configuration
2. Test with real PG test server for card payments
3. Validate error handling scenarios
4. Performance and reliability testing

### Phase 4: Documentation and Maintenance
1. Document test scenarios and configurations
2. Create test execution guidelines
3. Set up continuous integration
4. Establish test maintenance procedures

## Configuration Management

### Environment Variables
```bash
# Test Configuration
USE_MOCK=true
NODE_ENV=test
MOCK_SERVER_URL=http://localhost:3005

# HMS API Configuration
SW_KEY=test_sw_key
CUST_KEY=test_cust_key

# Database Configuration
DATABASE_URL=postgresql://test_user:test_pass@localhost:5432/test_db
```

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleNameMapping: {
    '^@app/(.*)$': '<rootDir>/libs/$1/src',
  },
  collectCoverageFrom: [
    'apps/wallet/src/controllers/**/*.ts',
    '!**/*.spec.ts',
    '!**/*.interface.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

This design provides a comprehensive testing framework that maintains the existing business logic while ensuring thorough test coverage with appropriate mocking strategies for different payment methods and external API integrations.