import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, billingMethods } from '../schema';
import { BillingMethod } from '../types';
import { TossApiClient } from '../providers/toss/toss-api.client';
import { NicepayBillingApiClient, IssueBillingKeyOptions } from '../providers/nicepay/nicepay-billing-api.client';

@Injectable()
export class BillingMethodService {
  private readonly logger = new Logger(BillingMethodService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly tossApi: TossApiClient,
    private readonly nicepayBillingApi: NicepayBillingApiClient,
  ) {}

  async issueTossBillingKey(userId: string, authKey: string, customerKey: string): Promise<BillingMethod> {
    const result = await this.tossApi.issueBillingKey(authKey, customerKey);
    if (!result.ok) {
      throw new Error(`Toss billing key issuance failed: ${result.error.code} ${result.error.message}`);
    }

    const { billingKey, cardCompany, cardNumber, method } = result.data;
    const displayName = `${cardCompany} ${cardNumber}`;

    const rows = await this.dbService.db
      .insert(billingMethods)
      .values({
        userId,
        providerType: 'TOSS_BILLING',
        billingKey,
        customerKey,
        displayName,
        method: method as Record<string, unknown>,
        status: 'ACTIVE',
      })
      .returning();

    return rows[0];
  }

  async issueNicepayBillingKey(
    userId: string,
    encData: string,
    orderId: string,
    options: IssueBillingKeyOptions = {},
  ): Promise<BillingMethod> {
    const result = await this.nicepayBillingApi.issueBillingKey(encData, orderId, options);
    if (!result.ok) {
      throw new Error(`NicePay billing key issuance failed: ${result.resultCode} ${result.resultMsg}`);
    }

    const { bid, cardCode, cardName } = result.data;
    const displayName = cardName ?? cardCode;

    const rows = await this.dbService.db
      .insert(billingMethods)
      .values({
        userId,
        providerType: 'NICEPAY_BILLING',
        billingKey: bid,
        displayName,
        method: { cardCode, cardName } as Record<string, unknown>,
        status: 'ACTIVE',
      })
      .returning();

    return rows[0];
  }

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

  async revoke(billingMethodId: string): Promise<void> {
    const existing = await this.findById(billingMethodId);
    if (!existing || existing.status !== 'ACTIVE') {
      throw new Error('billing method not found or already inactive');
    }

    // NicePay 빌링키는 NicePay 서버에도 만료 처리
    if (existing.providerType === 'NICEPAY_BILLING' && existing.billingKey) {
      const expireOrderId = billingMethodId.replace(/-/g, '');
      const expireResult = await this.nicepayBillingApi.expireBillingKey(existing.billingKey, expireOrderId);
      if (!expireResult.ok) {
        this.logger.warn(
          `NicePay billing key expire failed (proceeding with revoke): ${expireResult.resultCode} ${expireResult.resultMsg}`,
        );
      }
    }

    const updated = await this.dbService.db
      .update(billingMethods)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(billingMethods.id, billingMethodId), eq(billingMethods.status, 'ACTIVE')))
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
