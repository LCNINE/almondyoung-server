import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { AUTH_CONFIG, AuthenticationService, JwtAccessStrategy, JwtAuthGuard } from '@app/authorization';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from '@app/db';
import { EventsModule, EventTraceApiModule } from '@app/events';
import { UGC_COMMAND_STREAM, WALLET_COMMAND_STREAM, PAYMENT_STREAM } from '@packages/event-contracts/streams';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { validateWalletEnv } from './config/env';
import { WALLET_JWT_AUTH_KEY } from './wallet-auth.decorator';
import { WALLET_ADMIN_AUTH_KEY } from './wallet-admin-auth.decorator';
import { HealthController } from './health.controller';
import { walletSchema } from './schema';

// Domain
import { StateTransitionService } from './domain/state-transition/state-transition.service';
import { DrizzleIdempotencyRepository, IDEMPOTENCY_REPOSITORY } from './domain/idempotency/idempotency.repository';
import { IdempotencyService } from './domain/idempotency/idempotency.service';
import { HttpIdempotencyInterceptor } from './domain/idempotency/http-idempotency.interceptor';

// Providers
import { PointsPaymentProvider } from './providers/points/points.provider';
import { PointsLedgerService } from './providers/points/points-ledger.service';
import { TossApiClient } from './providers/toss/toss-api.client';
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
import { AutoCaptureService } from './payment-intents/auto-capture.service';
import { CancelService } from './payment-intents/cancel.service';
import { TossApproveService } from './payment-intents/toss-approve.service';

// Refunds
import { RefundsService } from './refunds/refunds.service';
import { RefundsController } from './refunds/refunds.controller';

// Admin
import { PointsAdminService } from './admin/points-admin.service';
import { PointsAdminController } from './admin/points-admin.controller';
import { PaymentIntentAdminService } from './admin/payment-intent-admin.service';
import { PaymentIntentAdminController } from './admin/payment-intent-admin.controller';
import { RefundAdminController } from './admin/refund-admin.controller';

// Points (user-facing)
import { PointsController } from './points/points.controller';
import { BankTransferAdminService } from './admin/bank-transfer-admin.service';

// Messaging + Jobs
import { OutboxDispatcherService } from './messaging/outbox-dispatcher.service';
import { ExpirationJob } from './jobs/expiration.job';
import { PointsExpirationJob } from './jobs/points-expiration.job';

// Webhooks
import { TossWebhookController } from './webhooks/toss-webhook.controller';
import { TossWebhookService } from './webhooks/toss-webhook.service';
import { TossWebhookRepository } from './webhooks/toss-webhook.repository';

// Billing
import { BillingMethodService } from './billing/billing-method.service';
import { BillingMethodController } from './billing/billing-method.controller';
import { BillingAgreementService } from './billing/billing-agreement.service';
import { BillingAgreementController } from './billing/billing-agreement.controller';
import { DirectBillingChargeService } from './billing/direct-billing-charge.service';
import { DirectBillingChargeController } from './billing/direct-billing-charge.controller';

// Checkout
import { CheckoutSessionService } from './checkout/checkout-session.service';
import { CheckoutSessionController } from './checkout/checkout-session.controller';
import { CheckoutSessionExpirationService } from './checkout/checkout-session-expiration.service';

// CMS
import { CmsApiClient } from './cms/cms-api.client';
import { CmsMemberService } from './cms/cms-member.service';
import { CmsMemberPollerService } from './cms/cms-member-poller.service';
import { CmsAgreementService } from './cms/cms-agreement.service';
import { CmsAgreementController } from './cms/cms-agreement.controller';
import { CmsBatchProvider } from './cms/cms-batch.provider';
import { CmsSettlementPollerService } from './cms/cms-settlement-poller.service';

// Consumers
import { UgcCommandConsumer } from './consumers/ugc-command.consumer';
import { BillingChargeConsumer } from './consumers/billing-charge.consumer';

export { WALLET_JWT_AUTH_KEY, WalletJwtAuth } from './wallet-auth.decorator';

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

@Injectable()
class WalletAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType<'http'>();
    if (type !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();

    const isJwtAuth = this.reflector.getAllAndOverride<boolean>(WALLET_JWT_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isAdminAuth = this.reflector.getAllAndOverride<boolean>(WALLET_ADMIN_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isAdminAuth) {
      // ── Admin path: JWT required, no API-key fallback ────────────────────
      if (!(await this.tryJwtAuth(context, request))) {
        throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
      }

      const roles: string[] = (request.user as any)?.roles ?? [];
      if (!roles.some((r) => r === 'admin' || r === 'master')) {
        throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Admin or master role required' });
      }

      return true;
    }

    if (isJwtAuth) {
      // ── JWT cookie path (browser-facing endpoints) ──────────────────────
      // API key is accepted as a fallback (e.g. merchant backend calling GET /v1/payment-methods)
      if (await this.tryJwtAuth(context, request)) {
        return true;
      }

      if (this.tryApiKeyAuth(request)) {
        return true;
      }

      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Missing or invalid JWT cookie' });
    }

    // ── API key path (merchant backend) ────────────────────────────────────
    this.requireApiKeyAuth(request);
    return true;
  }

  private async tryJwtAuth(context: ExecutionContext, request: AuthenticatedRequest): Promise<boolean> {
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

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
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

async function resolveCanActivate(result: boolean | Promise<boolean> | unknown): Promise<boolean> {
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
    EventsModule.forRoot({
      streams: [PAYMENT_STREAM],
    }),
    EventsModule.forConsumerModule({
      streams: [UGC_COMMAND_STREAM, WALLET_COMMAND_STREAM],
      groupId: process.env.KAFKA_GROUP_ID || 'wallet-consumer',
      enableAutoDLQ: true,
      validation: { validateOnConsume: false },
    }),
    EventTraceApiModule,
  ],
  controllers: [
    HealthController,
    PaymentIntentsController,
    PaymentMethodsController,
    RefundsController,
    PointsAdminController,
    PaymentIntentAdminController,
    RefundAdminController,
    PointsController,
    TossWebhookController,
    BillingMethodController,
    BillingAgreementController,
    DirectBillingChargeController,
    CheckoutSessionController,
    CmsAgreementController,
    UgcCommandConsumer,
    BillingChargeConsumer,
  ],
  providers: [
    {
      provide: AUTH_CONFIG,
      useFactory: () => {
        // dual-mode 지원: USER_JWT_SECRET (HS256 legacy) 또는 OIDC_ISSUER_URL (RS256/OIDC).
        // 둘 중 하나는 반드시 있어야 한다. 공용 라이브러리(libs/authorization) 의 provider 와 동일 정책.
        const secret = process.env.USER_JWT_SECRET;
        const issuerUrl = process.env.OIDC_ISSUER_URL;
        const allowedAud = process.env.ALLOWED_AUDIENCES;

        if (!secret && !issuerUrl) {
          throw new Error(
            'Either USER_JWT_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be defined in environment variables',
          );
        }

        const normalizedIssuer = issuerUrl?.replace(/\/$/, '');

        return {
          secret,
          issuer: process.env.JWT_ISSUER ?? 'almondyoung-auth',
          audience: process.env.JWT_AUDIENCE ?? 'almondyoung',
          jwksUri: normalizedIssuer ? `${normalizedIssuer}/.well-known/jwks.json` : undefined,
          oidcIssuer: normalizedIssuer,
          allowedAudiences: allowedAud
            ? allowedAud
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
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
    TossApiClient,
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
    AutoCaptureService,
    CancelService,
    TossApproveService,

    // Refunds
    RefundsService,

    // Admin
    PointsAdminService,
    BankTransferAdminService,
    PaymentIntentAdminService,

    // Billing
    BillingMethodService,
    BillingAgreementService,
    DirectBillingChargeService,

    // Checkout
    CheckoutSessionService,
    CheckoutSessionExpirationService,

    // CMS
    CmsApiClient,
    CmsMemberService,
    CmsMemberPollerService,
    CmsAgreementService,
    CmsBatchProvider,
    CmsSettlementPollerService,

    // Webhooks
    TossWebhookService,
    TossWebhookRepository,

    // Messaging + Jobs
    OutboxDispatcherService,
    ExpirationJob,
    PointsExpirationJob,
  ],
})
export class WalletModule {}
