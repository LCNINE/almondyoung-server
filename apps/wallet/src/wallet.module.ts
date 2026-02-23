import { CanActivate, ExecutionContext, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { validateWalletEnv } from './config/env';
import { HealthController } from './health.controller';
import { walletSchema } from './schema';

// Domain
import { StateTransitionService } from './domain/state-transition/state-transition.service';
import {
  DrizzleIdempotencyRepository,
  IDEMPOTENCY_REPOSITORY,
} from './domain/idempotency/idempotency.repository';
import { IdempotencyService } from './domain/idempotency/idempotency.service';
import { HttpIdempotencyInterceptor } from './domain/idempotency/http-idempotency.interceptor';

// Providers
import { PointsPaymentProvider } from './providers/points/points.provider';
import { PointsLedgerService } from './providers/points/points-ledger.service';
import { ProviderRegistry } from './providers/provider.registry';

// Customers
import { PaymentCustomersService } from './payment-customers/payment-customers.service';

// Methods
import { PaymentMethodsService } from './payment-methods/payment-methods.service';
import { PaymentMethodsController } from './payment-methods/payment-methods.controller';

// Charges
import { ChargesService } from './charges/charges.service';

// Intents
import { PaymentIntentsService } from './payment-intents/payment-intents.service';
import { PaymentIntentsController } from './payment-intents/payment-intents.controller';
import { ConfirmService } from './payment-intents/confirm.service';
import { CaptureService } from './payment-intents/capture.service';

// Refunds
import { RefundsService } from './refunds/refunds.service';
import { RefundsController } from './refunds/refunds.controller';

// Admin
import { PointsAdminService } from './admin/points-admin.service';
import { PointsAdminController } from './admin/points-admin.controller';

// Messaging + Jobs
import { OutboxDispatcherService } from './messaging/outbox-dispatcher.service';
import { ExpirationJob } from './jobs/expiration.job';

// ─── Simple API-key guard ─────────────────────────────────────────────────────

@Injectable()
class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const type = context.getType<'http'>();
    if (type !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, string | string[] | undefined>; url: string }>();

    // Health endpoints are public
    const path = (request.url ?? '').split('?')[0];
    if (path === '/v1/health' || path === '/v1/ready' || path.startsWith('/docs')) {
      return true;
    }

    const apiKey = process.env.WALLET_API_KEY;

    // Allow X-Client-Secret for wallet-web facing endpoints (validated at service layer)
    const clientSecretHeader = getHeader(request.headers, 'x-client-secret');
    if (clientSecretHeader) {
      const FRONTEND_PATTERNS = [
        /^\/v1\/payment-intents\/[^/]+$/,            // GET /v1/payment-intents/:id
        /^\/v1\/payment-intents\/[^/]+\/confirm$/,   // POST /v1/payment-intents/:id/confirm
        /^\/v1\/payment-intents\/[^/]+\/cancel$/,    // POST /v1/payment-intents/:id/cancel
        /^\/v1\/payment-methods$/,                   // GET /v1/payment-methods?external_user_id=
      ];
      if (FRONTEND_PATTERNS.some((re) => re.test(path))) {
        return true;
      }
    }

    const authHeader = getHeader(request.headers, 'authorization');
    if (!authHeader || !apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (token !== apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Invalid API key' });
    }

    return true;
  }
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name];
  if (Array.isArray(val)) return val[0];
  return val;
}

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWalletEnv,
      envFilePath: ['.env', 'apps/wallet/.env'],
    }),
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: walletSchema,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    PaymentIntentsController,
    PaymentMethodsController,
    RefundsController,
    PointsAdminController,
  ],
  providers: [
    // Guards & interceptors
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpIdempotencyInterceptor },

    // Domain
    StateTransitionService,
    IdempotencyService,
    { provide: IDEMPOTENCY_REPOSITORY, useClass: DrizzleIdempotencyRepository },

    // Providers
    PointsLedgerService,
    PointsPaymentProvider,
    ProviderRegistry,

    // Customers / Methods / Charges
    PaymentCustomersService,
    PaymentMethodsService,
    ChargesService,

    // Intents
    PaymentIntentsService,
    ConfirmService,
    CaptureService,

    // Refunds
    RefundsService,

    // Admin
    PointsAdminService,

    // Messaging + Jobs
    OutboxDispatcherService,
    ExpirationJob,
  ],
})
export class WalletModule {}
