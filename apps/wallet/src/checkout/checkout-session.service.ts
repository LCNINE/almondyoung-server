import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, lt } from 'drizzle-orm';
import { WalletSchema, checkoutSessions } from '../schema';
import { CheckoutSession } from '../types';
import { BillingAgreementService } from '../billing/billing-agreement.service';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class CheckoutSessionService {
  private readonly logger = new Logger(CheckoutSessionService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingAgreementService: BillingAgreementService,
  ) {}

  async create(dto: {
    userId: string;
    amount: number;
    currency: string;
    purpose: CheckoutSession['purpose'];
    metadata?: Record<string, unknown>;
    successUrl: string;
    cancelUrl: string;
    allowComposite?: boolean;
  }): Promise<CheckoutSession> {
    const metadata = dto.metadata ?? {};
    const subscriberRef = metadata.subscriberRef as string | undefined;
    const subscriberType = metadata.subscriberType as string | undefined;

    // Expire existing PENDING sessions for the same subscriberRef
    if (subscriberRef && subscriberType) {
      await this.expireExistingPendingSessions(dto.userId, subscriberRef);
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const rows = await this.dbService.db
      .insert(checkoutSessions)
      .values({
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency,
        purpose: dto.purpose,
        metadata,
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
        allowComposite: dto.allowComposite ?? false,
        status: 'PENDING',
        expiresAt,
      })
      .returning();

    return rows[0];
  }

  async get(sessionId: string): Promise<CheckoutSession | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId))
      .limit(1);

    const session = rows[0];
    if (!session) return undefined;

    // Lazy expiration: if PENDING and past expiresAt, mark as EXPIRED
    if (session.status === 'PENDING' && session.expiresAt < new Date()) {
      await this.dbService.db
        .update(checkoutSessions)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(checkoutSessions.id, sessionId), eq(checkoutSessions.status, 'PENDING')));
      return { ...session, status: 'EXPIRED' };
    }

    return session;
  }

  async complete(sessionId: string, intentId: string, billingMethodId?: string): Promise<void> {
    const rows = await this.dbService.db
      .update(checkoutSessions)
      .set({ intentId, status: 'COMPLETED', updatedAt: new Date() })
      .where(and(eq(checkoutSessions.id, sessionId), eq(checkoutSessions.status, 'PENDING')))
      .returning();

    if (rows.length === 0) {
      throw new Error('checkout session not found or not in PENDING status');
    }

    const session = rows[0];

    // Auto-create billing agreement if subscriberRef is present
    const subscriberRef = (session.metadata as Record<string, unknown>)?.subscriberRef as string | undefined;
    const subscriberType = (session.metadata as Record<string, unknown>)?.subscriberType as string | undefined;

    if (billingMethodId && subscriberRef && subscriberType) {
      try {
        await this.billingAgreementService.create(session.userId, billingMethodId, subscriberRef, subscriberType);
      } catch (e: any) {
        // If agreement already exists (unique constraint), that's fine
        if (!(e?.message ?? '').toLowerCase().includes('unique')) {
          throw e;
        }
        this.logger.warn(`Billing agreement already exists for subscriberRef=${subscriberRef}, updating billing method`);
        const existing = await this.billingAgreementService.findBySubscriberRef(subscriberType, subscriberRef);
        if (existing) {
          await this.billingAgreementService.updateBillingMethod(existing.id, billingMethodId, session.userId);
        }
      }
    }
  }

  private async expireExistingPendingSessions(userId: string, subscriberRef: string): Promise<void> {
    // Find PENDING sessions with matching subscriberRef in metadata
    const pending = await this.dbService.db
      .select()
      .from(checkoutSessions)
      .where(and(eq(checkoutSessions.userId, userId), eq(checkoutSessions.status, 'PENDING')));

    for (const session of pending) {
      const meta = session.metadata as Record<string, unknown>;
      if (meta?.subscriberRef === subscriberRef) {
        await this.dbService.db
          .update(checkoutSessions)
          .set({ status: 'EXPIRED', updatedAt: new Date() })
          .where(and(eq(checkoutSessions.id, session.id), eq(checkoutSessions.status, 'PENDING')));
      }
    }
  }
}
