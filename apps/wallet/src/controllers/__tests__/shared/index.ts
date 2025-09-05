// controllers/__tests__/shared/index.ts

// Test utilities
export * from './test-utils';
export * from './test-api-client-factory';
export * from './mock-data-generator';
export * from './test-fixtures';
export * from './response-builders';

// Re-export commonly used types
export type {
  TestScenario,
  TestApiClientConfig,
} from './test-api-client-factory';

export type {
  ApiResponse,
  ApiErrorResponse,
  HmsApiResponse,
} from './response-builders';