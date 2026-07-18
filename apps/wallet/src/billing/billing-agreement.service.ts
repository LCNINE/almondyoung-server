import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, billingAgreements } from '../schema';
import { BillingAgreement } from '../types';
import { BillingMethodService } from './billing-method.service';

@Injectable()
export class BillingAgreementService {
  private readonly logger = new Logger(BillingAgreementService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  async create(
    userId: string,
    billingMethodId: string,
    subscriberRef: string,
    subscriberType: string,
  ): Promise<BillingAgreement> {
    await this.billingMethodService.assertSelectableForRecurringBilling(userId, billingMethodId);

    // subscriberRef(=계약 id)는 계약당 재사용된다. 정기결제 해지가 남긴 REVOKED 행이
    // uq_billing_agreements_subscriber (subscriber_type, subscriber_ref) 비-partial 유니크 인덱스와 충돌해
    // 평범한 INSERT 는 유니크 위반(→500)이 된다. 같은 subscriber 조합이 있으면 그 행을 ACTIVE 로 되살리는
    // upsert 로 처리해 관리자 자동갱신 재활성(같은 계약 id 재사용)을 지원한다.
    const rows = await this.dbService.db
      .insert(billingAgreements)
      .values({
        userId,
        billingMethodId,
        subscriberRef,
        subscriberType,
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: [billingAgreements.subscriberType, billingAgreements.subscriberRef],
        set: { userId, billingMethodId, status: 'ACTIVE', updatedAt: new Date() },
      })
      .returning();

    return rows[0];
  }

  /**
   * 서버 간 호출용 — 유저의 가장 최근 ACTIVE billing_method로 agreement를 생성하거나 기존 것을 반환.
   * subscriberRef+subscriberType 조합이 이미 존재하면 최신 billing_method로 업데이트.
   */
  async createWithAutoMethod(userId: string, subscriberRef: string, subscriberType: string): Promise<BillingAgreement> {
    const [billingMethod, existing] = await Promise.all([
      this.billingMethodService.findLatestSelectableForRecurringBilling(userId),
      this.findBySubscriberRef(subscriberType, subscriberRef),
    ]);

    if (!billingMethod) {
      throw new Error(`no selectable billing method found for user: ${userId}`);
    }

    const billingMethodId = billingMethod.id;
    if (existing) {
      if (existing.billingMethodId !== billingMethodId) {
        await this.updateBillingMethod(existing.id, billingMethodId, userId);
        return { ...existing, billingMethodId };
      }
      return existing;
    }

    return this.create(userId, billingMethodId, subscriberRef, subscriberType);
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

  async updateBillingMethod(agreementId: string, newBillingMethodId: string, userId: string): Promise<void> {
    await this.billingMethodService.assertSelectableForRecurringBilling(userId, newBillingMethodId);

    // Update only if the agreement belongs to userId
    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ billingMethodId: newBillingMethodId, updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.id, agreementId),
          eq(billingAgreements.userId, userId),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or inactive');
    }
  }

  async revoke(agreementId: string, userId: string): Promise<void> {
    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.id, agreementId),
          eq(billingAgreements.userId, userId),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or already inactive');
    }
  }

  async revokeBySubscriberRef(subscriberType: string, subscriberRef: string): Promise<void> {
    await this.dbService.db
      .update(billingAgreements)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.subscriberType, subscriberType),
          eq(billingAgreements.subscriberRef, subscriberRef),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      );
  }
}
