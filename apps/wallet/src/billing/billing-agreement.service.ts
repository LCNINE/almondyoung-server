import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, billingAgreements, billingMethods } from '../schema';
import { BillingAgreement } from '../types';

@Injectable()
export class BillingAgreementService {
  private readonly logger = new Logger(BillingAgreementService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async create(
    userId: string,
    billingMethodId: string,
    subscriberRef: string,
    subscriberType: string,
  ): Promise<BillingAgreement> {
    // Verify billing method exists and belongs to user
    const methods = await this.dbService.db
      .select({ id: billingMethods.id })
      .from(billingMethods)
      .where(and(eq(billingMethods.id, billingMethodId), eq(billingMethods.userId, userId), eq(billingMethods.status, 'ACTIVE')))
      .limit(1);

    if (methods.length === 0) {
      throw new Error('billing method not found or inactive');
    }

    const rows = await this.dbService.db
      .insert(billingAgreements)
      .values({
        userId,
        billingMethodId,
        subscriberRef,
        subscriberType,
        status: 'ACTIVE',
      })
      .returning();

    return rows[0];
  }

  async findBySubscriberRef(subscriberType: string, subscriberRef: string): Promise<BillingAgreement | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(billingAgreements)
      .where(
        and(
          eq(billingAgreements.subscriberType, subscriberType),
          eq(billingAgreements.subscriberRef, subscriberRef),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findByUserId(userId: string): Promise<BillingAgreement[]> {
    return this.dbService.db
      .select()
      .from(billingAgreements)
      .where(and(eq(billingAgreements.userId, userId), eq(billingAgreements.status, 'ACTIVE')));
  }

  async updateBillingMethod(agreementId: string, newBillingMethodId: string): Promise<void> {
    // Verify new billing method exists and is active
    const methods = await this.dbService.db
      .select({ id: billingMethods.id, userId: billingMethods.userId })
      .from(billingMethods)
      .where(and(eq(billingMethods.id, newBillingMethodId), eq(billingMethods.status, 'ACTIVE')))
      .limit(1);

    if (methods.length === 0) {
      throw new Error('new billing method not found or inactive');
    }

    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ billingMethodId: newBillingMethodId, updatedAt: new Date() })
      .where(and(eq(billingAgreements.id, agreementId), eq(billingAgreements.status, 'ACTIVE')))
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or inactive');
    }
  }

  async revoke(agreementId: string): Promise<void> {
    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(billingAgreements.id, agreementId), eq(billingAgreements.status, 'ACTIVE')))
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or already inactive');
    }
  }
}
