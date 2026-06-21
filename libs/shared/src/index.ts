export * from './shared.module';
export * from './shared.service';
export * from './dto';
export * from './decorators/api-paginated-response.decorator';
export * from './decorators/skip-response-envelope.decorator';
export * from './interceptors/response.interceptor';
export * from './pipes/zod-validation.pipe';
export * from './pim/pim.port';
export * from './pim/pim.client';
export * from './pim/pim.orchestrator';
export * from './streams';

// HTTP server tuning
export * from './http/keep-alive';

// Filters
export * from './filters/application.exception';
export * from './filters/domain-exceptions';
export * from './filters/http-exception.filter';

// Re-export from packages for backward compatibility
export * from '@packages/domain-types';
