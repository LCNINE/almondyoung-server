import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { WalletSchema, billingAgreements, billingMethods, cmsAgreements, cmsMembers, paymentMethods } from '../schema';
import { isCmsAgreementRegistered } from '../cms/cms-agreement-status';
import { BillingMethod, CmsAgreementRecord, CmsMember } from '../types';
import { CmsApiClient } from '../cms/cms-api.client';
import { interpretLiveCmsMemberStatus } from '../cms/cms-member-status';
import { CmsOperationError } from '../cms/cms-errors';

export interface CmsBillingMethodStatusRow {
  billingMethodId: string;
  userId: string;
  providerType: string;
  displayName: string | null;
  billingMethodStatus: string;
  cmsMemberId: string | null;
  cmsMemberStatus: string;
  agreementStatus: string | null;
  isSelectableForRecurringBilling: boolean;
  statusLabel: string;
  resultCode: string | null;
  resultMessage: string | null;
  paymentCompany: string | null;
  payerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
@Injectable()
export class BillingMethodService {
  private readonly logger = new Logger(BillingMethodService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
  ) {}

  async registerCmsBillingMethod(userId: string, cmsMemberId: string, displayName?: string): Promise<BillingMethod> {
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

    if (existing.providerType === 'CMS_BATCH') {
      await this.deleteCmsBillingMethod(existing);
      return;
    }

    const updated = await this.dbService.db
      .update(billingMethods)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(billingMethods.id, billingMethodId),
          eq(billingMethods.userId, userId),
          eq(billingMethods.status, 'ACTIVE'),
        ),
      )
      .returning({ id: billingMethods.id });

    if (updated.length === 0) {
      throw new Error('billing method not found or already inactive');
    }
  }

  private async deleteCmsBillingMethod(method: BillingMethod): Promise<void> {
    const cmsMember = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.billingMethodId, method.id))
      .limit(1)
      .then((rows) => rows[0]);

    if (cmsMember?.cmsMemberId && cmsMember.status !== 'DELETED') {
      await this.guardAgainstStaleRegisteredDeletion(cmsMember);

      const result = await this.cmsApi.deleteMember(cmsMember.cmsMemberId);
      if (!result.ok) {
        this.logger.error(`CMS member deletion failed: ${result.error.code} ${result.error.message}`);
        throw new Error(`CMS member deletion failed: ${result.error.code} ${result.error.message}`);
      }
    }

    await this.dbService.db.transaction(async (tx) => {
      await tx
        .update(billingMethods)
        .set({ status: 'DELETED', updatedAt: new Date() })
        .where(and(eq(billingMethods.id, method.id), eq(billingMethods.userId, method.userId)));

      await tx
        .update(billingAgreements)
        .set({ status: 'REVOKED', updatedAt: new Date() })
        .where(and(eq(billingAgreements.billingMethodId, method.id), eq(billingAgreements.status, 'ACTIVE')));

      if (cmsMember) {
        await tx
          .update(cmsMembers)
          .set({ status: 'DELETED', updatedAt: new Date() })
          .where(eq(cmsMembers.id, cmsMember.id));
      }
    });
  }

  /**
   * 삭제 가드 (ADR-0027 §5-4). deleteMember 는 효성 자동이체 약정 자체를 지운다.
   * 저장된 상태가 stale(실패/심사중)인데 효성 실측이 REGISTERED 면, 사용자가
   * "실패한 줄 알고" 정상 등록된 계좌를 오삭제하려는 상황이다. 최신 상태로 갱신한 뒤
   * 삭제를 막아 재확인을 유도한다. 효성 조회 실패(점검/장애) 시엔 저장 상태 기준으로 진행한다.
   */
  private async guardAgainstStaleRegisteredDeletion(cmsMember: CmsMember): Promise<void> {
    if (cmsMember.status === 'REGISTERED') return; // 이미 등록된 걸 알고 지우는 정상 흐름

    const live = await this.cmsApi.getMember(cmsMember.cmsMemberId);
    if (!live.ok) {
      this.logger.warn(
        `CMS status re-check failed before deletion (${cmsMember.cmsMemberId}): ${live.error.code} — proceeding on stored status ${cmsMember.status}`,
      );
      return;
    }

    if (interpretLiveCmsMemberStatus(live.data.member.status) !== 'REGISTERED') return;

    // stale 발산 감지: 저장은 non-REGISTERED, 효성 실측은 REGISTERED.
    const resultCode = live.data.member.result?.code ?? null;
    const resultMessage = live.data.member.result?.message ?? null;
    await this.dbService.db
      .update(cmsMembers)
      .set({ status: 'REGISTERED', resultCode, resultMessage, updatedAt: new Date() })
      .where(eq(cmsMembers.id, cmsMember.id));

    this.logger.warn(
      `Blocked stale deletion of REGISTERED CMS member ${cmsMember.cmsMemberId} (stored=${cmsMember.status}, live=REGISTERED)`,
    );
    throw new CmsOperationError(
      'CMS_MEMBER_DELETE_BLOCKED_REGISTERED',
      '이 계좌는 은행 심사를 통과해 정상 등록되어 있습니다. 최신 상태로 갱신했으니, 삭제하시려면 다시 확인 후 시도해주세요.',
      409,
      `stored=${cmsMember.status} live=REGISTERED`,
    );
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

  async assertSelectableForRecurringBilling(userId: string, billingMethodId: string): Promise<BillingMethod> {
    const method = await this.findById(billingMethodId);
    if (!method || method.userId !== userId || method.status !== 'ACTIVE') {
      throw new Error('billing method not found or inactive');
    }

    if (method.providerType !== 'CMS_BATCH') {
      return method;
    }

    const statuses = await this.getUserCmsBillingMethodStatuses(userId);
    const status = statuses.find((row) => row.billingMethodId === billingMethodId);
    if (!status?.isSelectableForRecurringBilling) {
      throw new Error('CMS billing method is not ready for recurring billing');
    }

    return method;
  }

  async findLatestSelectableForRecurringBilling(userId: string): Promise<BillingMethod | undefined> {
    const methods = await this.dbService.db
      .select()
      .from(billingMethods)
      .where(and(eq(billingMethods.userId, userId), eq(billingMethods.status, 'ACTIVE')))
      .orderBy(desc(billingMethods.createdAt));

    if (methods.length === 0) return undefined;

    const cmsStatuses = await this.getUserCmsBillingMethodStatuses(userId);
    const selectableCmsIds = new Set(
      cmsStatuses.filter((status) => status.isSelectableForRecurringBilling).map((status) => status.billingMethodId),
    );

    return methods.find((method) => method.providerType !== 'CMS_BATCH' || selectableCmsIds.has(method.id));
  }

  async getUserCmsBillingMethodStatuses(userId: string): Promise<CmsBillingMethodStatusRow[]> {
    const methods = await this.dbService.db
      .select()
      .from(billingMethods)
      .where(
        and(
          eq(billingMethods.userId, userId),
          eq(billingMethods.providerType, 'CMS_BATCH'),
          ne(billingMethods.status, 'DELETED'),
        ),
      )
      .orderBy(desc(billingMethods.createdAt));

    if (methods.length === 0) return [];

    const methodIds = methods.map((m) => m.id);
    const members: CmsMember[] = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(inArray(cmsMembers.billingMethodId, methodIds));

    const cmsMemberIds = members.map((m) => m.cmsMemberId);
    let allAgreements: CmsAgreementRecord[] = [];
    if (cmsMemberIds.length > 0) {
      allAgreements = await this.dbService.db
        .select()
        .from(cmsAgreements)
        .where(inArray(cmsAgreements.cmsMemberId, cmsMemberIds))
        .orderBy(desc(cmsAgreements.createdAt));
    }

    const latestAgreementByCmsMemberId = new Map<string, CmsAgreementRecord>();
    for (const agreement of allAgreements) {
      if (!latestAgreementByCmsMemberId.has(agreement.cmsMemberId)) {
        latestAgreementByCmsMemberId.set(agreement.cmsMemberId, agreement);
      }
    }

    const memberByBillingMethodId = new Map<string, CmsMember>();
    for (const member of members) {
      memberByBillingMethodId.set(member.billingMethodId, member);
    }

    return methods.map((method) => {
      const member = memberByBillingMethodId.get(method.id);
      const agreement = member ? latestAgreementByCmsMemberId.get(member.cmsMemberId) : undefined;
      const cmsMemberStatus = member?.status ?? 'PENDING';
      const agreementStatus = agreement?.status ?? null;
      const isSelectableForRecurringBilling =
        method.status === 'ACTIVE' && cmsMemberStatus === 'REGISTERED' && isCmsAgreementRegistered(agreementStatus);

      return {
        billingMethodId: method.id,
        userId: method.userId,
        providerType: method.providerType,
        displayName: method.displayName ?? null,
        billingMethodStatus: method.status,
        cmsMemberId: member?.cmsMemberId ?? null,
        cmsMemberStatus,
        agreementStatus,
        isSelectableForRecurringBilling,
        statusLabel: this.computeCmsStatusLabel(method.status, cmsMemberStatus, agreementStatus),
        resultCode: member?.resultCode ?? null,
        resultMessage: member?.resultMessage ?? null,
        paymentCompany: member?.paymentCompany ?? null,
        payerName: member?.payerName ?? null,
        createdAt: method.createdAt,
        updatedAt: method.updatedAt,
      };
    });
  }

  private computeCmsStatusLabel(
    billingMethodStatus: string,
    cmsMemberStatus: string,
    agreementStatus: string | null,
  ): string {
    if (billingMethodStatus === 'REVOKED') return '해지됨';
    if (cmsMemberStatus === 'DELETED') return '삭제됨';
    if (cmsMemberStatus === 'FAILED') return '심사 실패';
    if (cmsMemberStatus === 'PENDING') return '심사 중';
    if (cmsMemberStatus === 'REGISTERED') {
      if (isCmsAgreementRegistered(agreementStatus)) return '사용 가능';
      return '동의자료 확인 필요';
    }
    return '알 수 없음';
  }

  async findById(id: string): Promise<BillingMethod | undefined> {
    const rows = await this.dbService.db.select().from(billingMethods).where(eq(billingMethods.id, id)).limit(1);
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
