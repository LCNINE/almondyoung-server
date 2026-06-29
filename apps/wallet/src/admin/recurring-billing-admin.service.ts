import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { SQL, and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { isCmsAgreementRegistered } from '../cms/cms-agreement-status';
import {
  WalletSchema,
  billingAgreements,
  billingMethods,
  charges,
  cmsAgreements,
  cmsMembers,
  cmsWithdrawals,
  paymentIntents,
} from '../schema';
import { CmsMemberPollerService } from '../cms/cms-member-poller.service';
import { CmsSettlementPollerService } from '../cms/cms-settlement-poller.service';
import {
  AdminRecurringBillingListQueryDto,
  AdminRecurringBillingOverviewDto,
  AdminRecurringBillingRowDto,
  AdminRecurringBillingIssueType,
} from './dto/admin-recurring-billing.dto';
import { PaginatedResponseDto } from '@app/shared';

// ─── Pure classification helper ──────────────────────────────────────────────

interface ClassifyInput {
  cmsMemberStatus?: string | null;
  agreementStatus?: string | null;
  withdrawalStatus?: string | null;
  withdrawalUpdatedAt?: Date | null;
  paymentIntentStatus?: string | null;
  paymentDate?: string | null;
}

interface ClassifyResult {
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  needsAction: boolean;
}

function classifyCmsRow(input: ClassifyInput): ClassifyResult {
  const now = new Date();

  if (input.cmsMemberStatus === 'FAILED') {
    return { severity: 'CRITICAL', needsAction: true };
  }

  // REGISTERED 상태인데 동의자료가 미등록/실패인 경우: 출금 시 거부될 수 있으므로 처리 필요
  if (input.cmsMemberStatus === 'REGISTERED' && !isCmsAgreementRegistered(input.agreementStatus)) {
    return { severity: 'WARNING', needsAction: true };
  }

  if (!isCmsAgreementRegistered(input.agreementStatus) && input.cmsMemberStatus === 'PENDING') {
    return { severity: 'WARNING', needsAction: true };
  }

  if (input.withdrawalStatus === 'FAILED') {
    return { severity: 'CRITICAL', needsAction: true };
  }

  if (input.withdrawalStatus === 'PROCESSING' && input.withdrawalUpdatedAt) {
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    if (input.withdrawalUpdatedAt < thirtyMinAgo) {
      return { severity: 'WARNING', needsAction: true };
    }
  }

  if (input.paymentIntentStatus === 'PENDING_SETTLEMENT' && input.paymentDate) {
    // paymentDate is YYYYMMDD; if paymentDate + 2 days < now → WARNING
    const pd = input.paymentDate;
    const year = parseInt(pd.slice(0, 4), 10);
    const month = parseInt(pd.slice(4, 6), 10) - 1;
    const day = parseInt(pd.slice(6, 8), 10);
    const payDate = new Date(year, month, day);
    payDate.setDate(payDate.getDate() + 2);
    if (payDate < now) {
      return { severity: 'WARNING', needsAction: true };
    }
  }

  return { severity: 'INFO', needsAction: false };
}

// ─── Agreement status aggregation ────────────────────────────────────────────

type AgreementStatusSnapshot = Pick<typeof cmsAgreements.$inferSelect, 'status' | 'createdAt'>;

export function aggregateAgreementStatus(agreements: AgreementStatusSnapshot[]): string | null {
  if (agreements.length === 0) return null;

  return agreements.reduce((latest, agreement) =>
    agreement.createdAt > latest.createdAt ? agreement : latest,
  ).status;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RecurringBillingAdminService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsMemberPoller: CmsMemberPollerService,
    private readonly cmsSettlementPoller: CmsSettlementPollerService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  // ── Overview ────────────────────────────────────────────────────────────────

  async getOverview(): Promise<AdminRecurringBillingOverviewDto> {
    // needsAction count는 listNeedsAction과 동일한 데이터 소스에서 가져와야 카드 숫자와 목록이 일치한다.
    const [needsActionRows, memberPendingResult, memberFailedResult, withdrawalRequestedResult, withdrawalProcessingResult, withdrawalFailedResult] =
      await Promise.all([
        this.fetchNeedsActionRows(),
        this.db.select({ value: count() }).from(cmsMembers).where(eq(cmsMembers.status, 'PENDING')),
        this.db.select({ value: count() }).from(cmsMembers).where(eq(cmsMembers.status, 'FAILED')),
        this.db.select({ value: count() }).from(cmsWithdrawals).where(eq(cmsWithdrawals.status, 'REQUESTED')),
        this.db.select({ value: count() }).from(cmsWithdrawals).where(eq(cmsWithdrawals.status, 'PROCESSING')),
        this.db.select({ value: count() }).from(cmsWithdrawals).where(eq(cmsWithdrawals.status, 'FAILED')),
      ]);

    return {
      needsAction: needsActionRows.length,
      memberPending: memberPendingResult[0]?.value ?? 0,
      memberFailed: memberFailedResult[0]?.value ?? 0,
      withdrawalRequested: withdrawalRequestedResult[0]?.value ?? 0,
      settlementPending: withdrawalProcessingResult[0]?.value ?? 0,
      withdrawalFailed: withdrawalFailedResult[0]?.value ?? 0,
    };
  }

  // ── List items ───────────────────────────────────────────────────────────────

  async listItems(
    query: AdminRecurringBillingListQueryDto,
  ): Promise<PaginatedResponseDto<AdminRecurringBillingRowDto>> {
    const view = query.view ?? 'needs-action';

    switch (view) {
      case 'members':
        return this.listMembers(query);
      case 'withdrawals':
        return this.listWithdrawals(query);
      case 'contracts':
        return this.listContracts(query);
      default:
        return this.listNeedsAction(query);
    }
  }

  // ── needs-action view ───────────────────────────────────────────────────────

  private async listNeedsAction(
    query: AdminRecurringBillingListQueryDto,
  ): Promise<PaginatedResponseDto<AdminRecurringBillingRowDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const rows = await this.fetchNeedsActionRows();
    const total = rows.length;
    const data = rows.slice(offset, offset + limit);

    return { data, total, page, limit };
  }

  private async fetchNeedsActionRows(): Promise<AdminRecurringBillingRowDto[]> {
    // Query 1: FAILED cms_members
    const failedMembers = await this.db
      .select({
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
      })
      .from(cmsMembers)
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .where(eq(cmsMembers.status, 'FAILED'));

    // Query 2: FAILED withdrawals
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const failedWithdrawals = await this.db
      .select({
        withdrawal: cmsWithdrawals,
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
        charge: charges,
        intent: paymentIntents,
      })
      .from(cmsWithdrawals)
      .leftJoin(cmsMembers, eq(cmsMembers.cmsMemberId, cmsWithdrawals.cmsMemberId))
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .leftJoin(charges, eq(charges.id, cmsWithdrawals.chargeId))
      .leftJoin(paymentIntents, eq(paymentIntents.id, cmsWithdrawals.intentId))
      .where(eq(cmsWithdrawals.status, 'FAILED'));

    // Query 3: PROCESSING withdrawals stale > 30min
    const processingWithdrawals = await this.db
      .select({
        withdrawal: cmsWithdrawals,
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
        charge: charges,
        intent: paymentIntents,
      })
      .from(cmsWithdrawals)
      .leftJoin(cmsMembers, eq(cmsMembers.cmsMemberId, cmsWithdrawals.cmsMemberId))
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .leftJoin(charges, eq(charges.id, cmsWithdrawals.chargeId))
      .leftJoin(paymentIntents, eq(paymentIntents.id, cmsWithdrawals.intentId))
      .where(and(eq(cmsWithdrawals.status, 'PROCESSING'), lte(cmsWithdrawals.updatedAt, thirtyMinAgo)));

    // Query 4: PENDING members (agreement check follows)
    const pendingMembers = await this.db
      .select({
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
      })
      .from(cmsMembers)
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .where(eq(cmsMembers.status, 'PENDING'));

    // Query 5: REGISTERED members (may still have incomplete agreement)
    const registeredMembers = await this.db
      .select({
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
      })
      .from(cmsMembers)
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .where(eq(cmsMembers.status, 'REGISTERED'));

    // Load agreements for pending + registered members
    const allMemberIds = [
      ...pendingMembers.map((r) => r.cmsMember.cmsMemberId),
      ...registeredMembers.map((r) => r.cmsMember.cmsMemberId),
    ];
    const agreementsForAll =
      allMemberIds.length > 0
        ? await this.db.select().from(cmsAgreements).where(inArray(cmsAgreements.cmsMemberId, allMemberIds))
        : [];

    const agreementsByMemberId = new Map<string, AgreementStatusSnapshot[]>();
    for (const ag of agreementsForAll) {
      const existing = agreementsByMemberId.get(ag.cmsMemberId) ?? [];
      existing.push({ status: ag.status, createdAt: ag.createdAt });
      agreementsByMemberId.set(ag.cmsMemberId, existing);
    }

    // Build rows
    const rows: AdminRecurringBillingRowDto[] = [];
    const seen = new Set<string>();

    // FAILED members
    for (const r of failedMembers) {
      const key = `member:${r.cmsMember.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push(this.buildMemberRow(r.cmsMember, r.billingMethod, r.billingAgreement, null, 'PROVIDER_METHOD'));
    }

    // PENDING members with incomplete agreement
    for (const r of pendingMembers) {
      const key = `member:${r.cmsMember.id}`;
      if (seen.has(key)) continue;

      const agreements = agreementsByMemberId.get(r.cmsMember.cmsMemberId) ?? [];
      const aggStatus = aggregateAgreementStatus(agreements);
      if (aggStatus !== '등록') {
        seen.add(key);
        rows.push(this.buildMemberRow(r.cmsMember, r.billingMethod, r.billingAgreement, aggStatus, 'PROVIDER_MANDATE'));
      }
    }

    // REGISTERED members with incomplete agreement (동의자료 미등록/실패)
    for (const r of registeredMembers) {
      const key = `member:${r.cmsMember.id}`;
      if (seen.has(key)) continue;

      const agreements = agreementsByMemberId.get(r.cmsMember.cmsMemberId) ?? [];
      const aggStatus = aggregateAgreementStatus(agreements);
      if (aggStatus !== '등록') {
        seen.add(key);
        rows.push(this.buildMemberRow(r.cmsMember, r.billingMethod, r.billingAgreement, aggStatus, 'PROVIDER_MANDATE'));
      }
    }

    // FAILED withdrawals
    for (const r of failedWithdrawals) {
      const key = `withdrawal:${r.withdrawal.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push(
        this.buildWithdrawalRow(r.withdrawal, r.cmsMember, r.billingMethod, r.billingAgreement, r.charge, r.intent),
      );
    }

    // PROCESSING stale withdrawals
    for (const r of processingWithdrawals) {
      const key = `withdrawal:${r.withdrawal.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push(
        this.buildWithdrawalRow(r.withdrawal, r.cmsMember, r.billingMethod, r.billingAgreement, r.charge, r.intent),
      );
    }

    return rows;
  }

  // ── members view ─────────────────────────────────────────────────────────────

  private async listMembers(
    query: AdminRecurringBillingListQueryDto,
  ): Promise<PaginatedResponseDto<AdminRecurringBillingRowDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (query.cmsMemberStatus) {
      conditions.push(eq(cmsMembers.status, query.cmsMemberStatus));
    }
    if (query.userId) {
      conditions.push(eq(cmsMembers.userId, query.userId));
    }
    if (query.cmsMemberId) {
      conditions.push(eq(cmsMembers.cmsMemberId, query.cmsMemberId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db.select({ value: count() }).from(cmsMembers).where(whereClause),
      this.db
        .select({
          cmsMember: cmsMembers,
          billingMethod: billingMethods,
          billingAgreement: billingAgreements,
        })
        .from(cmsMembers)
        .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
        .leftJoin(
          billingAgreements,
          and(
            eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
            eq(billingAgreements.status, 'ACTIVE'),
            eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
          ),
        )
        .where(whereClause)
        .orderBy(desc(cmsMembers.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.value ?? 0;

    // Load agreements for these members
    const memberIds = rows.map((r) => r.cmsMember.cmsMemberId);
    const agreements =
      memberIds.length > 0
        ? await this.db.select().from(cmsAgreements).where(inArray(cmsAgreements.cmsMemberId, memberIds))
        : [];

    const agreementsByMemberId = new Map<string, AgreementStatusSnapshot[]>();
    for (const ag of agreements) {
      const existing = agreementsByMemberId.get(ag.cmsMemberId) ?? [];
      existing.push({ status: ag.status, createdAt: ag.createdAt });
      agreementsByMemberId.set(ag.cmsMemberId, existing);
    }

    const data = rows.map((r) => {
      const agreements = agreementsByMemberId.get(r.cmsMember.cmsMemberId) ?? [];
      const aggStatus = aggregateAgreementStatus(agreements);
      return this.buildMemberRow(r.cmsMember, r.billingMethod, r.billingAgreement, aggStatus, 'PROVIDER_METHOD');
    });

    return { data, total, page, limit };
  }

  // ── withdrawals view ─────────────────────────────────────────────────────────

  private async listWithdrawals(
    query: AdminRecurringBillingListQueryDto,
  ): Promise<PaginatedResponseDto<AdminRecurringBillingRowDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (query.withdrawalStatus) {
      conditions.push(eq(cmsWithdrawals.status, query.withdrawalStatus));
    }
    if (query.cmsMemberId) {
      conditions.push(eq(cmsWithdrawals.cmsMemberId, query.cmsMemberId));
    }
    if (query.transactionId) {
      conditions.push(eq(cmsWithdrawals.transactionId, query.transactionId));
    }
    if (query.paymentIntentId) {
      conditions.push(eq(cmsWithdrawals.intentId, query.paymentIntentId));
    }
    if (query.dateType === 'paymentDate') {
      if (query.dateFrom) conditions.push(gte(cmsWithdrawals.paymentDate, query.dateFrom));
      if (query.dateTo) conditions.push(lte(cmsWithdrawals.paymentDate, query.dateTo));
    } else if (query.dateType === 'createdAt') {
      if (query.dateFrom) conditions.push(gte(cmsWithdrawals.createdAt, new Date(query.dateFrom)));
      if (query.dateTo) conditions.push(lte(cmsWithdrawals.createdAt, new Date(query.dateTo)));
    } else if (query.dateType === 'updatedAt') {
      if (query.dateFrom) conditions.push(gte(cmsWithdrawals.updatedAt, new Date(query.dateFrom)));
      if (query.dateTo) conditions.push(lte(cmsWithdrawals.updatedAt, new Date(query.dateTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db.select({ value: count() }).from(cmsWithdrawals).where(whereClause),
      this.db
        .select({
          withdrawal: cmsWithdrawals,
          cmsMember: cmsMembers,
          billingMethod: billingMethods,
          billingAgreement: billingAgreements,
          charge: charges,
          intent: paymentIntents,
        })
        .from(cmsWithdrawals)
        .leftJoin(cmsMembers, eq(cmsMembers.cmsMemberId, cmsWithdrawals.cmsMemberId))
        .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
        .leftJoin(
          billingAgreements,
          and(
            eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
            eq(billingAgreements.status, 'ACTIVE'),
            eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
          ),
        )
        .leftJoin(charges, eq(charges.id, cmsWithdrawals.chargeId))
        .leftJoin(paymentIntents, eq(paymentIntents.id, cmsWithdrawals.intentId))
        .where(whereClause)
        .orderBy(desc(cmsWithdrawals.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.value ?? 0;
    const data = rows.map((r) =>
      this.buildWithdrawalRow(r.withdrawal, r.cmsMember, r.billingMethod, r.billingAgreement, r.charge, r.intent),
    );

    return { data, total, page, limit };
  }

  // ── contracts view ───────────────────────────────────────────────────────────

  private async listContracts(
    query: AdminRecurringBillingListQueryDto,
  ): Promise<PaginatedResponseDto<AdminRecurringBillingRowDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [
      eq(billingMethods.providerType, 'CMS_BATCH'),
      eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
    ];
    if (query.userId) {
      conditions.push(eq(billingAgreements.userId, query.userId));
    }
    if (query.contractId) {
      conditions.push(eq(billingAgreements.subscriberRef, query.contractId));
      conditions.push(eq(billingAgreements.subscriberType, 'MEMBERSHIP'));
    }

    const whereClause = and(...conditions);

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(billingAgreements)
        .leftJoin(billingMethods, eq(billingMethods.id, billingAgreements.billingMethodId))
        .where(whereClause),
      this.db
        .select({
          billingAgreement: billingAgreements,
          billingMethod: billingMethods,
          cmsMember: cmsMembers,
        })
        .from(billingAgreements)
        .leftJoin(billingMethods, eq(billingMethods.id, billingAgreements.billingMethodId))
        .leftJoin(cmsMembers, eq(cmsMembers.billingMethodId, billingMethods.id))
        .where(whereClause)
        .orderBy(desc(billingAgreements.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.value ?? 0;

    const data = rows.map((r): AdminRecurringBillingRowDto => {
      const classification = classifyCmsRow({
        cmsMemberStatus: r.cmsMember?.status ?? null,
      });
      return {
        issueType: 'CONTRACT',
        severity: classification.severity,
        needsAction: classification.needsAction,
        userId: r.billingAgreement.userId,
        providerType: r.billingMethod?.providerType ?? 'CMS_BATCH',
        billingMethodId: r.billingMethod?.id ?? undefined,
        billingAgreementId: r.billingAgreement.id,
        subscriberRef: r.billingAgreement.subscriberRef,
        subscriberType: r.billingAgreement.subscriberType,
        providerState: {
          cmsMemberId: r.cmsMember?.cmsMemberId ?? undefined,
          cmsMemberStatus: r.cmsMember?.status ?? undefined,
        },
        createdAt: r.billingAgreement.createdAt.toISOString(),
        updatedAt: r.billingAgreement.updatedAt.toISOString(),
      };
    });

    return { data, total, page, limit };
  }

  // ── Row builders ─────────────────────────────────────────────────────────────

  private buildMemberRow(
    cmsMember: typeof cmsMembers.$inferSelect,
    billingMethod: typeof billingMethods.$inferSelect | null,
    billingAgreement: typeof billingAgreements.$inferSelect | null,
    agreementStatus: string | null,
    issueType: AdminRecurringBillingIssueType,
  ): AdminRecurringBillingRowDto {
    const classification = classifyCmsRow({
      cmsMemberStatus: cmsMember.status,
      agreementStatus,
    });

    return {
      issueType,
      severity: classification.severity,
      needsAction: classification.needsAction,
      userId: cmsMember.userId,
      providerType: billingMethod?.providerType ?? 'CMS_BATCH',
      billingMethodId: cmsMember.billingMethodId,
      billingAgreementId: billingAgreement?.id ?? undefined,
      subscriberRef: billingAgreement?.subscriberRef ?? undefined,
      subscriberType: billingAgreement?.subscriberType ?? undefined,
      providerState: {
        cmsMemberId: cmsMember.cmsMemberId,
        cmsMemberRowId: cmsMember.id,
        cmsMemberStatus: cmsMember.status,
        agreementStatus,
        resultCode: cmsMember.resultCode ?? null,
        resultMessage: cmsMember.resultMessage ?? null,
      },
      createdAt: cmsMember.createdAt.toISOString(),
      updatedAt: cmsMember.updatedAt.toISOString(),
    };
  }

  private buildWithdrawalRow(
    withdrawal: typeof cmsWithdrawals.$inferSelect,
    cmsMember: typeof cmsMembers.$inferSelect | null,
    billingMethod: typeof billingMethods.$inferSelect | null,
    billingAgreement: typeof billingAgreements.$inferSelect | null,
    charge: typeof charges.$inferSelect | null,
    intent: typeof paymentIntents.$inferSelect | null,
  ): AdminRecurringBillingRowDto {
    const classification = classifyCmsRow({
      withdrawalStatus: withdrawal.status,
      withdrawalUpdatedAt: withdrawal.updatedAt,
      paymentIntentStatus: intent?.status ?? null,
      paymentDate: withdrawal.paymentDate,
    });

    return {
      issueType: 'PROVIDER_CHARGE',
      severity: classification.severity,
      needsAction: classification.needsAction,
      userId: cmsMember?.userId ?? '',
      providerType: billingMethod?.providerType ?? 'CMS_BATCH',
      billingMethodId: billingMethod?.id ?? undefined,
      billingAgreementId: billingAgreement?.id ?? undefined,
      subscriberRef: billingAgreement?.subscriberRef ?? undefined,
      subscriberType: billingAgreement?.subscriberType ?? undefined,
      amount: withdrawal.amount,
      actualAmount: withdrawal.actualAmount ?? null,
      paymentIntentId: withdrawal.intentId,
      paymentIntentStatus: intent?.status ?? undefined,
      chargeId: charge?.id ?? undefined,
      chargeStatus: charge?.status ?? undefined,
      providerState: {
        cmsMemberId: withdrawal.cmsMemberId,
        cmsMemberStatus: cmsMember?.status ?? undefined,
        withdrawalId: withdrawal.id,
        transactionId: withdrawal.transactionId,
        withdrawalStatus: withdrawal.status,
        paymentDate: withdrawal.paymentDate,
        resultCode: withdrawal.resultCode ?? null,
        resultMessage: withdrawal.resultMessage ?? null,
      },
      createdAt: withdrawal.createdAt.toISOString(),
      updatedAt: withdrawal.updatedAt.toISOString(),
    };
  }

  // ── Agreement state by subscriberRefs ────────────────────────────────────────

  async getAgreementStateByRefs(subscriberRefs: string[]): Promise<
    Record<
      string,
      {
        billingAgreementId: string;
        billingMethodId: string;
        providerType: string;
        cmsMemberId: string | null;
        cmsMemberRowId: string | null;
        cmsMemberStatus: string | null;
        agreementStatus: string | null;
      } | null
    >
  > {
    if (!subscriberRefs.length) return {};

    const agreementRows = await this.db
      .select({
        billingAgreement: billingAgreements,
        billingMethod: billingMethods,
        cmsMember: cmsMembers,
      })
      .from(billingAgreements)
      .leftJoin(billingMethods, eq(billingMethods.id, billingAgreements.billingMethodId))
      .leftJoin(cmsMembers, eq(cmsMembers.billingMethodId, billingMethods.id))
      .where(
        and(
          inArray(billingAgreements.subscriberRef, subscriberRefs),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      );

    const cmsMemberIds = agreementRows.map((r) => r.cmsMember?.cmsMemberId).filter((id): id is string => !!id);

    const cmsAgreementRows =
      cmsMemberIds.length > 0
        ? await this.db.select().from(cmsAgreements).where(inArray(cmsAgreements.cmsMemberId, cmsMemberIds))
        : [];

    const cmsAgreementsByMemberId = new Map<string, AgreementStatusSnapshot[]>();
    for (const ag of cmsAgreementRows) {
      const existing = cmsAgreementsByMemberId.get(ag.cmsMemberId) ?? [];
      existing.push({ status: ag.status, createdAt: ag.createdAt });
      cmsAgreementsByMemberId.set(ag.cmsMemberId, existing);
    }

    const result: Record<
      string,
      {
        billingAgreementId: string;
        billingMethodId: string;
        providerType: string;
        cmsMemberId: string | null;
        cmsMemberRowId: string | null;
        cmsMemberStatus: string | null;
        agreementStatus: string | null;
      } | null
    > = {};

    for (const ref of subscriberRefs) {
      result[ref] = null;
    }

    for (const r of agreementRows) {
      const ref = r.billingAgreement.subscriberRef;
      const cmsMemberIdStr = r.cmsMember?.cmsMemberId ?? null;
      const agreements = cmsMemberIdStr ? (cmsAgreementsByMemberId.get(cmsMemberIdStr) ?? []) : [];
      const aggStatus = aggregateAgreementStatus(agreements);

      result[ref] = {
        billingAgreementId: r.billingAgreement.id,
        billingMethodId: r.billingAgreement.billingMethodId,
        providerType: r.billingMethod?.providerType ?? 'CMS_BATCH',
        cmsMemberId: r.cmsMember?.cmsMemberId ?? null,
        cmsMemberRowId: r.cmsMember?.id ?? null,
        cmsMemberStatus: r.cmsMember?.status ?? null,
        agreementStatus: aggStatus,
      };
    }

    return result;
  }

  // ── Poll ─────────────────────────────────────────────────────────────────────

  async pollMember(id: string): Promise<AdminRecurringBillingRowDto> {
    const rows = await this.db.select().from(cmsMembers).where(eq(cmsMembers.id, id)).limit(1);
    const member = rows[0];
    if (!member) throw new Error(`CMS member not found: ${id}`);

    if (!['REGISTERED', 'FAILED', 'DELETED'].includes(member.status)) {
      await this.cmsMemberPoller.pollMemberById(id);
    }

    const refreshed = await this.db.select().from(cmsMembers).where(eq(cmsMembers.id, id)).limit(1);
    const updated = refreshed[0] ?? member;

    const billingMethodRows = await this.db
      .select({
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
      })
      .from(billingMethods)
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, billingMethods.id),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .where(eq(billingMethods.id, updated.billingMethodId))
      .limit(1);

    const bm = billingMethodRows[0];

    const agreementRows = await this.db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.cmsMemberId, updated.cmsMemberId));

    const aggStatus = aggregateAgreementStatus(agreementRows);

    return this.buildMemberRow(
      updated,
      bm?.billingMethod ?? null,
      bm?.billingAgreement ?? null,
      aggStatus,
      'PROVIDER_METHOD',
    );
  }

  async pollWithdrawal(id: string): Promise<AdminRecurringBillingRowDto> {
    const rows = await this.db.select().from(cmsWithdrawals).where(eq(cmsWithdrawals.id, id)).limit(1);
    const withdrawal = rows[0];
    if (!withdrawal) throw new Error(`CMS withdrawal not found: ${id}`);

    if (!['SUCCEEDED', 'FAILED', 'DELETED'].includes(withdrawal.status)) {
      await this.cmsSettlementPoller.pollWithdrawalById(id);
    }

    const refreshed = await this.db.select().from(cmsWithdrawals).where(eq(cmsWithdrawals.id, id)).limit(1);
    const updated = refreshed[0] ?? withdrawal;

    const memberRows = await this.db
      .select({
        cmsMember: cmsMembers,
        billingMethod: billingMethods,
        billingAgreement: billingAgreements,
        charge: charges,
        intent: paymentIntents,
      })
      .from(cmsWithdrawals)
      .leftJoin(cmsMembers, eq(cmsMembers.cmsMemberId, cmsWithdrawals.cmsMemberId))
      .leftJoin(billingMethods, eq(billingMethods.id, cmsMembers.billingMethodId))
      .leftJoin(
        billingAgreements,
        and(
          eq(billingAgreements.billingMethodId, cmsMembers.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
          eq(billingAgreements.subscriberType, 'MEMBERSHIP'),
        ),
      )
      .leftJoin(charges, eq(charges.id, cmsWithdrawals.chargeId))
      .leftJoin(paymentIntents, eq(paymentIntents.id, cmsWithdrawals.intentId))
      .where(eq(cmsWithdrawals.id, id))
      .limit(1);

    const joined = memberRows[0];

    return this.buildWithdrawalRow(
      updated,
      joined?.cmsMember ?? null,
      joined?.billingMethod ?? null,
      joined?.billingAgreement ?? null,
      joined?.charge ?? null,
      joined?.intent ?? null,
    );
  }
}
