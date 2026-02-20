import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AuthorizationModule,
  JwtAuthGuard,
  authorizationSchema,
} from '@app/authorization';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { PAYMENTS_EVENTS_V1_STREAM } from '@packages/event-contracts';
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
import { IntentCreationService } from './intents/application/intent-creation.service';
import { LegExecutionService } from './intents/application/leg-execution.service';
import { IntentTerminationService } from './intents/application/intent-termination.service';
import { RefundOrchestrationService } from './intents/application/refund-orchestration.service';
import { ExpirationJob } from './jobs/expiration.job';
import { ReconcileJob } from './jobs/reconcile.job';
import { PointsPaymentProvider } from './providers/points/points.provider';
import { PointsLedgerService } from './providers/points/points-ledger.service';
import { ProviderRegistry } from './providers/provider.registry';
import { ReconcileController } from './reconcile/reconcile.controller';
import { ReconcileService } from './reconcile/reconcile.service';
import { OutboxDispatcherService } from './messaging/outbox-dispatcher.service';
import { PaymentsCommandConsumer } from './messaging/payments-command.consumer';
import { AttemptService } from './intents/support/attempt.service';
import { ManualActionQueueService } from './intents/support/manual-action-queue.service';

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
      streams: [PAYMENTS_EVENTS_V1_STREAM],
      serviceName: process.env.SERVICE_NAME ?? 'wallet',
      enableDLQ: true,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    IntentsController,
    RefundRequestsController,
    ReconcileController,
    PaymentsCommandConsumer,
  ],
  providers: [
    StateTransitionService,
    AttemptService,
    ManualActionQueueService,
    IntentCreationService,
    LegExecutionService,
    IntentTerminationService,
    RefundOrchestrationService,
    IntentsService,
    ReconcileService,
    OutboxDispatcherService,
    ExpirationJob,
    ReconcileJob,
    IdempotencyService,
    PointsLedgerService,
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
