import { CanActivate, ExecutionContext, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule, JwtService } from '@nestjs/jwt';
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
import { TossPaymentProvider } from './providers/toss/toss.provider';
import { BankTransferPaymentProvider } from './providers/bank-transfer/bank-transfer.provider';
import { ProviderRegistry } from './providers/provider.registry';

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
import { CancelService } from './payment-intents/cancel.service';
import { TossApproveService } from './payment-intents/toss-approve.service';

// Refunds
import { RefundsService } from './refunds/refunds.service';
import { RefundsController } from './refunds/refunds.controller';

// Admin
import { PointsAdminService } from './admin/points-admin.service';
import { PointsAdminController } from './admin/points-admin.controller';
import { BankTransferAdminService } from './admin/bank-transfer-admin.service';
import { BankTransferAdminController } from './admin/bank-transfer-admin.controller';

// Messaging + Jobs
import { OutboxDispatcherService } from './messaging/outbox-dispatcher.service';
import { ExpirationJob } from './jobs/expiration.job';

// ─── JWT-authenticated request interface ─────────────────────────────────────

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  /** Set by ApiKeyGuard when JWT cookie auth succeeds */
  jwtUserId?: string;
  /** Set by ApiKeyGuard when API-key auth is used (merchant backend) */
  isApiKeyAuth?: boolean;
}

// ─── Auth guard (API key + JWT cookie) ───────────────────────────────────────

/**
 * Endpoints accessible via JWT cookie (browser / wallet-web / storefront).
 * These paths must NOT accept a body-supplied userId; the guard reads it
 * from the JWT claims and attaches it to request.jwtUserId.
 */
const JWT_COOKIE_PATTERNS = [
  /^\/v1\/payment-intents\/[^/]+\/?$/,          // GET /v1/payment-intents/:id
  /^\/v1\/payment-intents\/[^/]+\/confirm\/?$/, // POST /v1/payment-intents/:id/confirm
  /^\/v1\/payment-intents\/[^/]+\/cancel\/?$/,  // POST /v1/payment-intents/:id/cancel
  /^\/v1\/payment-methods\/?$/,                 // GET /v1/payment-methods
];

@Injectable()
class ApiKeyGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) { }

  canActivate(context: ExecutionContext): boolean {
    const type = context.getType<'http'>();
    if (type !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    // Health & docs are public
    const path = normalizePath((request.url ?? '').split('?')[0]);
    if (path === '/v1/health' || path === '/v1/ready' || path.startsWith('/docs')) {
      return true;
    }

    // ── JWT cookie path (browser-facing endpoints) ──────────────────────────
    // API key is accepted as a fallback (e.g. merchant backend calling GET /v1/payment-methods)
    if (JWT_COOKIE_PATTERNS.some((re) => re.test(path))) {
      const jwtUserId = this.extractUserIdFromCookie(request);
      if (jwtUserId) {
        request.jwtUserId = jwtUserId;
        return true;
      }

      // No valid JWT cookie — try API key fallback
      const apiKeyFallback = process.env.WALLET_API_KEY;
      const authHeaderFallback = getHeader(request.headers, 'authorization');
      if (apiKeyFallback && authHeaderFallback) {
        const keyValue = authHeaderFallback.startsWith('Bearer ')
          ? authHeaderFallback.slice(7)
          : authHeaderFallback;
        if (keyValue === apiKeyFallback) {
          request.isApiKeyAuth = true;
          return true;
        }
      }

      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
    }

    // ── API key path (merchant backend) ────────────────────────────────────
    const apiKey = process.env.WALLET_API_KEY;
    const authHeader = getHeader(request.headers, 'authorization');
    if (!authHeader || !apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (token !== apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Invalid API key' });
    }

    request.isApiKeyAuth = true;
    return true;
  }

  private extractUserIdFromCookie(request: AuthenticatedRequest): string | null {
    const cookieHeader = getHeader(request.headers, 'cookie');
    if (!cookieHeader) return null;

    const accessToken = parseCookieValue(cookieHeader, 'accessToken');
    if (!accessToken) return null;

    try {
      const secret = process.env.USER_JWT_SECRET;
      if (!secret) return null;
      const payload = this.jwtService.verify<{ sub?: string; id?: string; userId?: string }>(
        accessToken,
        { secret },
      );
      return payload.sub ?? payload.id ?? payload.userId ?? null;
    } catch {
      return null;
    }
  }
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lowerName = name.toLowerCase();
  const direct = headers[name] ?? headers[lowerName] ?? headers[name.toUpperCase()];
  if (direct !== undefined) {
    if (Array.isArray(direct)) {
      return lowerName === 'cookie' ? direct.join('; ') : direct[0];
    }
    return direct;
  }

  const key = Object.keys(headers).find((k) => k.toLowerCase() === lowerName);
  const val = key ? headers[key] : undefined;
  if (Array.isArray(val)) {
    return lowerName === 'cookie' ? val.join('; ') : val[0];
  }
  return val;
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function normalizePath(path: string): string {
  if (!path) return '/';

  const collapsed = path.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
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
    JwtModule.register({}),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    PaymentIntentsController,
    PaymentMethodsController,
    RefundsController,
    PointsAdminController,
    BankTransferAdminController,
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
    TossPaymentProvider,
    BankTransferPaymentProvider,
    ProviderRegistry,

    // Methods / Charges
    PaymentMethodsService,
    ChargesService,

    // Intents
    PaymentIntentsService,
    ConfirmService,
    CaptureService,
    CancelService,
    TossApproveService,

    // Refunds
    RefundsService,

    // Admin
    PointsAdminService,
    BankTransferAdminService,

    // Messaging + Jobs
    OutboxDispatcherService,
    ExpirationJob,
  ],
})
export class WalletModule { }
