import { Module } from '@nestjs/common';
import { IdempotencyService } from '../services/idempotency.service';
import { IdempotencyInterceptor } from '../interceptor/idempotency.interceptor';

@Module({
  providers: [
    IdempotencyService,
    IdempotencyInterceptor,
  ],
  exports: [
    IdempotencyService,
    IdempotencyInterceptor,
  ],
})
export class IdempotencyModule { }