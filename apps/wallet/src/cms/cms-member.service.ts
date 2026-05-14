import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, billingMethods, cmsMembers } from '../schema';
import { BillingMethod, CmsMember } from '../types';
import { CmsApiClient } from './cms-api.client';
import { BillingMethodService } from '../billing/billing-method.service';

@Injectable()
export class CmsMemberService {
  private readonly logger = new Logger(CmsMemberService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  /**
   * 효성 회원 등록 + billing_methods 레코드 생성.
   * 회원등록은 비동기(D+1 결과 확인)이므로 PENDING 상태로 생성.
   */
  async registerMember(
    userId: string,
    dto: {
      paymentCompany: string;
      payerName: string;
      payerNumber: string;
      paymentNumber: string;
    },
  ): Promise<{ cmsMember: CmsMember; billingMethod: BillingMethod }> {
    // 효성 회원 ID는 고객사가 직접 발급 (20자 이내, A-F0-9)
    const memberId = randomBytes(10).toString('hex').toUpperCase();

    const result = await this.cmsApi.createMember({
      memberId,
      memberName: dto.payerName,
      paymentKind: 'CMS',
      paymentCompany: dto.paymentCompany,
      paymentNumber: dto.paymentNumber,
      payerName: dto.payerName,
      payerNumber: dto.payerNumber,
    });

    if (!result.ok) {
      if (result.statusCode >= 500) {
        throw new Error(`CMS member registration API error: ${result.error.code} ${result.error.message}`);
      }
      throw new Error(`CMS member registration failed: ${result.error.code} ${result.error.message}`);
    }

    const cmsMemberId = result.data.member.memberId;
    if (!cmsMemberId) {
      throw new Error('CMS API returned no memberId');
    }

    const displayName = `${dto.paymentCompany} ${dto.payerName}`;
    const billingMethod = await this.billingMethodService.registerCmsBillingMethod(userId, cmsMemberId, displayName);

    const rows = await this.dbService.db
      .insert(cmsMembers)
      .values({
        billingMethodId: billingMethod.id,
        userId,
        cmsMemberId,
        paymentCompany: dto.paymentCompany,
        payerName: dto.payerName,
        payerNumber: dto.payerNumber,
        status: 'PENDING',
      })
      .returning();

    return { cmsMember: rows[0], billingMethod };
  }

  async findByCmsMemberId(cmsMemberId: string): Promise<CmsMember | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.cmsMemberId, cmsMemberId))
      .limit(1);
    return rows[0];
  }

  async findByBillingMethodId(billingMethodId: string): Promise<CmsMember | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.billingMethodId, billingMethodId))
      .limit(1);
    return rows[0];
  }

  async findByUserId(userId: string): Promise<CmsMember[]> {
    return this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.userId, userId));
  }

  async findPendingMembers(): Promise<CmsMember[]> {
    return this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.status, 'PENDING'));
  }

  async updateStatus(
    id: string,
    status: 'REGISTERED' | 'FAILED' | 'DELETED',
    resultCode?: string,
    resultMessage?: string,
  ): Promise<void> {
    await this.dbService.db
      .update(cmsMembers)
      .set({
        status,
        resultCode: resultCode ?? null,
        resultMessage: resultMessage ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cmsMembers.id, id));
  }

  async updateBankAccount(
    billingMethodId: string,
    userId: string,
    dto: { paymentCompany: string; payerName: string; payerNumber: string; paymentNumber: string },
  ): Promise<void> {
    const cmsMember = await this.findByBillingMethodId(billingMethodId);
    if (!cmsMember || cmsMember.userId !== userId) {
      throw new Error('CMS billing method not found or access denied');
    }

    const result = await this.cmsApi.updateMember(cmsMember.cmsMemberId, {
      paymentKind: 'CMS',
      paymentCompany: dto.paymentCompany,
      paymentNumber: dto.paymentNumber,
      payerName: dto.payerName,
      payerNumber: dto.payerNumber,
    });

    if (!result.ok) {
      throw new Error(`CMS member update failed: ${result.error.code} ${result.error.message}`);
    }

    await Promise.all([
      this.dbService.db
        .update(cmsMembers)
        .set({
          paymentCompany: dto.paymentCompany,
          payerName: dto.payerName,
          payerNumber: dto.payerNumber,
          status: 'PENDING',
          resultCode: null,
          resultMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(cmsMembers.id, cmsMember.id)),
      this.dbService.db
        .update(billingMethods)
        .set({ displayName: `${dto.payerName} (${dto.paymentCompany})`, updatedAt: new Date() })
        .where(eq(billingMethods.id, billingMethodId)),
    ]);
  }

  async deleteMember(cmsMemberId: string): Promise<void> {
    const result = await this.cmsApi.deleteMember(cmsMemberId);
    if (!result.ok) {
      this.logger.error(`CMS member deletion failed: ${result.error.code} ${result.error.message}`);
      throw new Error(`CMS member deletion failed: ${result.error.code} ${result.error.message}`);
    }

    await this.dbService.db
      .update(cmsMembers)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(cmsMembers.cmsMemberId, cmsMemberId));
  }
}
