import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { WalletSchema, billingMethods, paymentMethods } from '../schema';
import { BillingMethod } from '../types';
@Injectable()
export class BillingMethodService {
  private readonly logger = new Logger(BillingMethodService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async registerCmsBillingMethod(
    userId: string,
    cmsMemberId: string,
    displayName?: string,
  ): Promise<BillingMethod> {
    const rows = await this.dbService.db
      .insert(billingMethods)
      .values({
        userId,
        providerType: 'CMS_BATCH',
        cmsMemberId,
        displayName: displayName ?? null,
        status: 'ACTIVE',
      })
      .returning();

    return rows[0];
  }

  async revoke(billingMethodId: string, userId: string): Promise<void> {
    const existing = await this.findById(billingMethodId);
    if (!existing || existing.status !== 'ACTIVE' || existing.userId !== userId) {
      throw new Error('billing method not found or already inactive');
    }

    const updated = await this.dbService.db
      .update(billingMethods)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(billingMethods.id, billingMethodId), eq(billingMethods.userId, userId), eq(billingMethods.status, 'ACTIVE')))
      .returning({ id: billingMethods.id });

    if (updated.length === 0) {
      throw new Error('billing method not found or already inactive');
    }
  }

  async getBillingKey(billingMethodId: string): Promise<string> {
    const rows = await this.dbService.db
      .select({ billingKey: billingMethods.billingKey })
      .from(billingMethods)
      .where(and(eq(billingMethods.id, billingMethodId), eq(billingMethods.status, 'ACTIVE')))
      .limit(1);

    const key = rows[0]?.billingKey;
    if (!key) {
      throw new Error('billing key not found or billing method inactive');
    }
    return key;
  }

  async getCustomerKey(billingMethodId: string): Promise<string> {
    const rows = await this.dbService.db
      .select({ customerKey: billingMethods.customerKey })
      .from(billingMethods)
      .where(and(eq(billingMethods.id, billingMethodId), eq(billingMethods.status, 'ACTIVE')))
      .limit(1);

    const key = rows[0]?.customerKey;
    if (!key) {
      throw new Error('customer key not found or billing method inactive');
    }
    return key;
  }

  async getUserBillingMethods(userId: string): Promise<BillingMethod[]> {
    return this.dbService.db
      .select()
      .from(billingMethods)
      .where(and(eq(billingMethods.userId, userId), eq(billingMethods.status, 'ACTIVE')));
  }

  async findById(id: string): Promise<BillingMethod | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(billingMethods)
      .where(eq(billingMethods.id, id))
      .limit(1);
    return rows[0];
  }

  async findOrCreateForBilling(userId: string, providerType: string, billingMethodId: string) {
    const [existing] = await this.dbService.db
      .select()
      .from(paymentMethods)
      .where(
        sql`${paymentMethods.userId} = ${userId}
        AND ${paymentMethods.type} = ${providerType}
        AND ${paymentMethods.isDeleted} = false
        AND ${paymentMethods.providerData}->>'billingMethodId' = ${billingMethodId}`,
      )
      .limit(1);

    if (existing) return existing;

    const [row] = await this.dbService.db
      .insert(paymentMethods)
      .values({
        userId,
        type: providerType as 'CMS_BATCH',
        displayName: null,
        isReusable: true,
        isDeleted: false,
        providerData: { billingMethodId },
      })
      .returning();

    if (!row) throw new Error('BILLING_PAYMENT_METHOD_INSERT_FAILED');
    return row;
  }

  async handleBillingDeletedWebhook(billingKey: string): Promise<void> {
    const rows = await this.dbService.db
      .update(billingMethods)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(and(eq(billingMethods.billingKey, billingKey), eq(billingMethods.status, 'ACTIVE')))
      .returning({ id: billingMethods.id });

    if (rows.length === 0) {
      this.logger.warn(`BILLING_DELETED webhook: no active billing method found for billingKey`);
    }
  }
}
