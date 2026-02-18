import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  AuthorizationModule,
  JwtAuthGuard,
  authorizationSchema,
} from '@app/authorization';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PAYMENT_STREAM } from '@packages/event-contracts';
import { WALLET_SCOPES } from './auth/wallet.scopes';
import { validateWalletEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { walletSchema } from './schema';
import { StateTransitionService } from './domain/state-transition/state-transition.service';
import {
  DrizzleIdempotencyRepository,
  IDEMPOTENCY_REPOSITORY,
} from './domain/idempotency/idempotency.repository';
import { IdempotencyService } from './domain/idempotency/idempotency.service';
import { HttpIdempotencyInterceptor } from './domain/idempotency/http-idempotency.interceptor';
import { IntentsController } from './intents/intents.controller';
import { IntentsService } from './intents/intents.service';
import { RefundRequestsController } from './intents/refund-requests.controller';
import { PointsPaymentProvider } from './providers/points.provider';
import { ProviderRegistry } from './providers/provider.registry';

const combinedSchema = { ...walletSchema, ...authorizationSchema };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWalletEnv,
      envFilePath: ['.env', 'apps/wallet/.env'],
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'wallet',
      scopes: WALLET_SCOPES,
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: combinedSchema,
    }),
    EventsModule.forRoot({
      streams: [PAYMENT_STREAM],
      serviceName: process.env.SERVICE_NAME ?? 'wallet',
      enableDLQ: true,
    }),
  ],
  controllers: [HealthController, IntentsController, RefundRequestsController],
  providers: [
    StateTransitionService,
    IntentsService,
    IdempotencyService,
    PointsPaymentProvider,
    ProviderRegistry,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useClass: DrizzleIdempotencyRepository,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpIdempotencyInterceptor,
    },
  ],
})
export class WalletModule {}
