import { CanActivate, ExecutionContext, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import {
  AUTH_CONFIG,
  AuthenticationService,
  JwtAccessStrategy,
  JwtAuthGuard,
} from '@app/authorization';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { UGC_COMMAND_STREAM } from '@packages/event-contracts/streams';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
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

// Points (user-facing)
import { PointsController } from './points/points.controller';
import { BankTransferAdminService } from './admin/bank-transfer-admin.service';
import { BankTransferAdminController } from './admin/bank-transfer-admin.controller';

// Messaging + Jobs
import { OutboxDispatcherService } from './messaging/outbox-dispatcher.service';
import { ExpirationJob } from './jobs/expiration.job';

// Consumers
import { UgcCommandConsumer } from './consumers/ugc-command.consumer';

// ─── JWT-authenticated request interface ─────────────────────────────────────

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  cookies?: Record<string, string | undefined>;
  user?: {
    userId?: string;
    sub?: string;
    id?: string;
    [key: string]: unknown;
  };
  /** Set by WalletAuthGuard when JWT cookie auth succeeds */
  jwtUserId?: string;
  /** Set by WalletAuthGuard when API-key auth is used (merchant backend) */
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
  /^\/v1\/points\/balance\/?$/,                 // GET /v1/points/balance
];

@Injectable()
class WalletAuthGuard implements CanActivate {
  constructor(private readonly jwtAuthGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      if (await this.tryJwtAuth(context, request)) {
        return true;
      }

      // No valid JWT cookie — try API key fallback
      if (this.tryApiKeyAuth(request)) {
        return true;
      }

      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
    }

    // ── API key path (merchant backend) ────────────────────────────────────
    this.requireApiKeyAuth(request);
    return true;
  }

  private async tryJwtAuth(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): Promise<boolean> {
    const originalAuthHeader = getHeader(request.headers, 'authorization');
    const cookieToken = getAccessTokenFromRequest(request);
    const injectedAuthHeader = cookieToken ? `Bearer ${cookieToken}` : null;

    // Shared JwtAccessStrategy extracts Authorization first, then cookie.
    // Inject cookie token into Authorization to avoid parser/proxy variance.
    if (injectedAuthHeader) {
      setHeader(request.headers, 'authorization', injectedAuthHeader);
    }

    try {
      const activated = await resolveCanActivate(this.jwtAuthGuard.canActivate(context));
      if (!activated) return false;
    } catch {
      return false;
    } finally {
      if (injectedAuthHeader !== null) {
        setHeader(request.headers, 'authorization', originalAuthHeader);
      }
    }

    const jwtUserId = getUserIdFromRequestUser(request.user);
    if (!jwtUserId) return false;

    request.jwtUserId = jwtUserId;
    return true;
  }

  private tryApiKeyAuth(request: AuthenticatedRequest): boolean {
    const apiKey = process.env.WALLET_API_KEY;
    const token = getBearerToken(getHeader(request.headers, 'authorization'));
    if (!apiKey || !token || token !== apiKey) {
      return false;
    }

    request.isApiKeyAuth = true;
    return true;
  }

  private requireApiKeyAuth(request: AuthenticatedRequest): void {
    const apiKey = process.env.WALLET_API_KEY;
    const token = getBearerToken(getHeader(request.headers, 'authorization'));
    if (!token || !apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing authorization' });
    }

    if (token !== apiKey) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Invalid API key' });
    }

    request.isApiKeyAuth = true;
  }
}

function getUserIdFromRequestUser(user: AuthenticatedRequest['user']): string | null {
  if (!user) return null;
  const candidate = user.userId ?? user.sub ?? user.id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function getBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}

function getAccessTokenFromRequest(request: AuthenticatedRequest): string | null {
  const fromCookies = request.cookies?.accessToken;
  if (typeof fromCookies === 'string' && fromCookies.length > 0) {
    return fromCookies;
  }

  const cookieHeader = getHeader(request.headers, 'cookie');
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, 'accessToken');
}

function setHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
  value: string | undefined,
): void {
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();

  if (value === undefined) {
    delete headers[name];
    delete headers[lower];
    delete headers[upper];
    return;
  }

  headers[name] = value;
  headers[lower] = value;
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
    return val[0];
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

async function resolveCanActivate(
  result: boolean | Promise<boolean> | unknown,
): Promise<boolean> {
  if (typeof result === 'boolean') {
    return result;
  }
  if (isObservable(result)) {
    return firstValueFrom(result as Observable<boolean>);
  }
  if (result && typeof (result as Promise<boolean>).then === 'function') {
    return result as Promise<boolean>;
  }
  return Boolean(result);
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
    PassportModule.register({ defaultStrategy: 'jwt' }),
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: walletSchema,
    }),
    ScheduleModule.forRoot(),
    EventsModule.forConsumerModule({
      streams: [UGC_COMMAND_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'wallet-consumer',
      enableAutoDLQ: true,
      validation: { validateOnConsume: false },
    }),
  ],
  controllers: [
    HealthController,
    PaymentIntentsController,
    PaymentMethodsController,
    RefundsController,
    PointsAdminController,
    BankTransferAdminController,
    PointsController,
    UgcCommandConsumer,
  ],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => {
        const secret = process.env.USER_JWT_SECRET;
        if (!secret) {
          throw new Error('USER_JWT_SECRET is not defined in environment variables');
        }
        return {
          secret,
          issuer: process.env.JWT_ISSUER ?? 'almondyoung-auth',
          audience: process.env.JWT_AUDIENCE ?? 'almondyoung',
        };
      },
    },
    AuthenticationService,
    JwtAccessStrategy,
    JwtAuthGuard,

    // Guards & interceptors
    { provide: APP_GUARD, useClass: WalletAuthGuard },
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
