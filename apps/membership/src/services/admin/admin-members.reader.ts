import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema, pauseEvents } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, desc, asc, ilike, gte, lte, inArray, SQL, count, isNull, isNotNull, notInArray, sql } from 'drizzle-orm';
import { endOfDay } from 'date-fns';
import { ContractEventManager } from '../subscription/contract-event.manager';

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
  /** userId partial search */
  q?: string;
  /** filter by resolved userIds (from user-service lookup) */
  userIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  /** date field for range filter — only meaningful when status=CANCELLED */
  dateCriteria?: 'createdAt' | 'cancelledAt';
}

export interface AdminMemberListItem {
  contractId: string;
  userId: string;
  /** Computed: ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status: string;
  tierCode: string;
  tierPriority: number;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface AdminMembersResponse {
  data: AdminMemberListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminMemberDetail {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  tierPriority: number;
  planId: string;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  autoRenewal: boolean;
  pauseCount: number;
  firstContractCreatedAt: string;
}

export interface BillingEventItem {
  id: string;
  contractId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ContractEventItem {
  id: number;
  contractId: string;
  eventType: string;
  userId: string;
  causedBy: string;
  causedByUserId: string | null;
  createdAt: string;
}

export interface AdminBillingHistoryQuery {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  contractId?: string;
  userId?: string;
  eventType?: string;
}

export interface AdminBillingHistoryItem {
  id: string;
  contractId: string;
  userId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminBillingHistoryResponse {
  data: AdminBillingHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminRecurringContractSummary {
  contractId: string;
  userId: string;
  status: string;
  planId: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
}

export interface AdminRecurringContractsQuery {
  page?: number;
  limit?: number;
  userId?: string;
  contractId?: string;
  status?: string;
  dateType?: 'updatedAt' | 'createdAt' | 'nextBillingDate';
  dateFrom?: string;
  dateTo?: string;
}

export interface AdminRecurringContractListItem {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
  billingInProgress: boolean;
  billingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRecurringContractsResponse {
  data: AdminRecurringContractListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface StuckBillingContractItem {
  contractId: string;
  userId: string;
  planId: string;
  nextBillingDate: string | null;
  billingInProgressSince: string;
  hoursElapsed: number;
}

export interface StuckBillingContractsResponse {
  data: StuckBillingContractItem[];
  total: number;
}

@Injectable()
export class AdminMembersReader {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  async findAllWithDetails(query: AdminMembersQuery): Promise<AdminMembersResponse> {
    const { page = 1, limit = 20, status, q, userIds, dateFrom, dateTo, dateCriteria = 'createdAt' } = query;
    const offset = (page - 1) * limit;

    const baseConditions: SQL[] = [];

    if (q) {
      baseConditions.push(ilike(schema.subscriptionContracts.userId, `%${q}%`));
    }

    if (userIds?.length) {
      baseConditions.push(inArray(schema.subscriptionContracts.userId, userIds));
    }

    const dateField =
      dateCriteria === 'cancelledAt'
        ? schema.subscriptionContracts.cancelledAt
        : schema.subscriptionContracts.createdAt;

    if (dateFrom) {
      baseConditions.push(gte(dateField, new Date(dateFrom)));
    }

    if (dateTo) {
      baseConditions.push(lte(dateField, endOfDay(new Date(dateTo))));
    }

    // PAUSED/ACTIVE는 entitlement.pausedAt 컬럼으로 SQL에서 직접 구분
    if (status === 'ACTIVE') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
      baseConditions.push(isNull(schema.subscriptionEntitlement.pausedAt));
    } else if (status === 'PAUSED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
      baseConditions.push(isNotNull(schema.subscriptionEntitlement.pausedAt));
    } else if (status === 'CANCELLED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'CANCELLED'));
    } else if (status === 'EXPIRED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'EXPIRED'));
    }

    const whereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const latestPerUser = this.dbService.db
      .selectDistinctOn([schema.subscriptionContracts.userId], {
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        billingDate: schema.subscriptionContracts.billingDate,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        createdAt: schema.subscriptionContracts.createdAt,
        cancelledAt: schema.subscriptionContracts.cancelledAt,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        tierPriority: schema.tiers.priorityLevel,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(whereClause)
      .orderBy(schema.subscriptionContracts.userId, desc(schema.subscriptionContracts.createdAt))
      .as('lc');

    const [[{ total }], rows] = await Promise.all([
      this.dbService.db.select({ total: count() }).from(latestPerUser),
      this.dbService.db.select().from(latestPerUser).orderBy(desc(latestPerUser.createdAt)).limit(limit).offset(offset),
    ]);

    const data: AdminMemberListItem[] = rows.map((r) => {
      let computedStatus = r.contractStatus;
      if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
        computedStatus = 'PAUSED';
      }

      return {
        contractId: r.contractId,
        userId: r.userId,
        status: computedStatus,
        tierCode: r.tierCode,
        tierPriority: r.tierPriority,
        planDurationDays: r.planDurationDays,
        billingDate: r.billingDate,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        isPaused: r.pausedAt !== null,
        pausedAt: r.pausedAt ? r.pausedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      };
    });

    return { data, total, page, limit };
  }

  async findDetailByUserId(userId: string): Promise<AdminMemberDetail | null> {
    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const rows = await this.dbService.db
      .select({
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        billingDate: schema.subscriptionContracts.billingDate,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        createdAt: schema.subscriptionContracts.createdAt,
        cancelledAt: schema.subscriptionContracts.cancelledAt,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        planId: schema.subscriptionContracts.planId,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        tierPriority: schema.tiers.priorityLevel,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.subscriptionContracts.createdAt))
      .limit(1);

    if (!rows.length) return null;

    const r = rows[0];

    const pauseCountResult = await this.dbService.db
      .select({ count: count() })
      .from(pauseEvents)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- same as above
      .where(and(eq(pauseEvents.userId, userId), eq(pauseEvents.eventType, 'START')));
    const pauseCount = Number(pauseCountResult[0]?.count ?? 0);

    const firstContractResult = await this.dbService.db
      .select({ createdAt: schema.subscriptionContracts.createdAt })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(asc(schema.subscriptionContracts.createdAt))
      .limit(1);
    const firstContractCreatedAt = firstContractResult[0]?.createdAt?.toISOString() ?? r.createdAt.toISOString();

    let computedStatus = r.contractStatus;
    if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
      computedStatus = 'PAUSED';
    }

    return {
      contractId: r.contractId,
      userId: r.userId,
      status: computedStatus,
      tierCode: r.tierCode,
      tierPriority: r.tierPriority,
      planId: r.planId,
      planDurationDays: r.planDurationDays,
      billingDate: r.billingDate,
      nextBillingDate: r.nextBillingDate,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      isPaused: r.pausedAt !== null,
      pausedAt: r.pausedAt ? r.pausedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      autoRenewal: r.autoRenewal,
      pauseCount,
      firstContractCreatedAt,
    };
  }

  async findBillingEventsByUserId(userId: string): Promise<BillingEventItem[]> {
    const rows = await this.dbService.db
      .select(this.billingEventColumns())
      .from(schema.billingEvents)
      .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(500);
    return rows.map((r) => this.toBillingEventItem(r));
  }

  async findContractEventsByUserId(userId: string): Promise<ContractEventItem[]> {
    const rows = await this.dbService.db
      .select(this.contractEventColumns())
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.userId, userId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt))
      .limit(500);
    return rows.map((r) => this.toContractEventItem(r));
  }

  async findBillingEventsByContractId(contractId: string): Promise<BillingEventItem[]> {
    const rows = await this.dbService.db
      .select(this.billingEventColumns())
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.contractId, contractId))
      .orderBy(desc(schema.billingEvents.createdAt));
    return rows.map((r) => this.toBillingEventItem(r));
  }

  async findContractEventsByContractId(contractId: string): Promise<ContractEventItem[]> {
    const rows = await this.dbService.db
      .select(this.contractEventColumns())
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.contractId, contractId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));
    return rows.map((r) => this.toContractEventItem(r));
  }

  private billingEventColumns() {
    return {
      id: schema.billingEvents.id,
      contractId: schema.billingEvents.contractId,
      eventType: schema.billingEvents.eventType,
      attemptNo: schema.billingEvents.attemptNo,
      amount: schema.billingEvents.amount,
      errorCode: schema.billingEvents.errorCode,
      errorMessage: schema.billingEvents.errorMessage,
      createdAt: schema.billingEvents.createdAt,
    };
  }

  private contractEventColumns() {
    return {
      id: schema.subscriptionContractEvents.id,
      contractId: schema.subscriptionContractEvents.contractId,
      eventType: schema.subscriptionContractEvents.eventType,
      userId: schema.subscriptionContractEvents.userId,
      causedBy: schema.subscriptionContractEvents.causedBy,
      causedByUserId: schema.subscriptionContractEvents.causedByUserId,
      createdAt: schema.subscriptionContractEvents.createdAt,
    };
  }

  private toBillingEventItem(r: {
    id: string;
    contractId: string;
    eventType: string;
    attemptNo: number | null;
    amount: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
  }): BillingEventItem {
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  private toContractEventItem(r: {
    id: number;
    contractId: string;
    eventType: string;
    userId: string;
    causedBy: string;
    causedByUserId: string | null;
    createdAt: Date;
  }): ContractEventItem {
    return { ...r, createdAt: r.createdAt.toISOString() };
  }

  async findContractPaymentRef(contractId: string): Promise<{ lastPaymentIntentId: string | null } | null> {
    const [row] = await this.dbService.db
      .select({ lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, contractId))
      .limit(1);
    return row ?? null;
  }

  async findAllBillingHistory(query: AdminBillingHistoryQuery): Promise<AdminBillingHistoryResponse> {
    const { page = 1, limit = 20, dateFrom, dateTo, contractId, userId, eventType } = query;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (contractId) conditions.push(eq(schema.billingEvents.contractId, contractId));
    if (userId) conditions.push(eq(schema.subscriptionContracts.userId, userId));
    if (eventType) conditions.push(eq(schema.billingEvents.eventType, eventType));
    if (dateFrom) conditions.push(gte(schema.billingEvents.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(schema.billingEvents.createdAt, endOfDay(new Date(dateTo))));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [[{ total }], paged] = await Promise.all([
      this.dbService.db
        .select({ total: count() })
        .from(schema.billingEvents)
        .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
        .where(where),
      this.dbService.db
        .select({
          id: schema.billingEvents.id,
          contractId: schema.billingEvents.contractId,
          userId: schema.subscriptionContracts.userId,
          eventType: schema.billingEvents.eventType,
          attemptNo: schema.billingEvents.attemptNo,
          amount: schema.billingEvents.amount,
          errorCode: schema.billingEvents.errorCode,
          errorMessage: schema.billingEvents.errorMessage,
          createdAt: schema.billingEvents.createdAt,
        })
        .from(schema.billingEvents)
        .innerJoin(schema.subscriptionContracts, eq(schema.billingEvents.contractId, schema.subscriptionContracts.id))
        .where(where)
        .orderBy(desc(schema.billingEvents.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: paged.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        userId: r.userId,
        eventType: r.eventType,
        attemptNo: r.attemptNo,
        amount: r.amount,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async findRecurringContractsByIds(contractIds: string[]): Promise<AdminRecurringContractSummary[]> {
    if (!contractIds.length) return [];

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const rows = await this.dbService.db
      .select({
        contractId: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        contractStatus: schema.subscriptionContracts.status,
        planId: schema.subscriptionContracts.planId,
        autoRenewal: schema.subscriptionContracts.autoRenewal,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
        planDurationDays: schema.plan.durationDays,
        tierCode: schema.tiers.code,
        startsAt: schema.subscriptionEntitlement.startsAt,
        endsAt: schema.subscriptionEntitlement.endsAt,
        pausedAt: schema.subscriptionEntitlement.pausedAt,
      })
      .from(schema.subscriptionContracts)
      .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
      .where(inArray(schema.subscriptionContracts.id, contractIds));

    return rows.map((r) => {
      let computedStatus = r.contractStatus;
      if (r.contractStatus === 'ACTIVE' && r.pausedAt !== null) {
        computedStatus = 'PAUSED';
      }

      return {
        contractId: r.contractId,
        userId: r.userId,
        status: computedStatus,
        planId: r.planId,
        tierCode: r.tierCode,
        planDurationDays: r.planDurationDays,
        autoRenewal: r.autoRenewal,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        lastPaymentIntentId: r.lastPaymentIntentId,
      };
    });
  }

  async updateAutoRenewal(contractId: string, autoRenewal: boolean, adminId: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(schema.eventBatches)
        .values({ type: 'AUTO_RENEWAL_CHANGED', effectiveDate: new Date().toISOString().split('T')[0] })
        .returning();

      // 자동갱신 재활성 시 nextBillingDate가 비어 있으면(해지로 null이 된 경우) 현재 주기 종료일로 복구해 결제 재개를 보장
      const updates: { autoRenewal: boolean; updatedAt: Date; nextBillingDate?: string } = {
        autoRenewal,
        updatedAt: new Date(),
      };
      if (autoRenewal) {
        const [contract] = await tx
          .select({
            userId: schema.subscriptionContracts.userId,
            nextBillingDate: schema.subscriptionContracts.nextBillingDate,
          })
          .from(schema.subscriptionContracts)
          .where(eq(schema.subscriptionContracts.id, contractId))
          .limit(1);
        if (contract && !contract.nextBillingDate) {
          const [ent] = await tx
            .select({ endsAt: schema.subscriptionEntitlement.endsAt })
            .from(schema.subscriptionEntitlement)
            .where(
              and(
                eq(schema.subscriptionEntitlement.userId, contract.userId),
                eq(schema.subscriptionEntitlement.isCurrent, true),
              ),
            )
            .limit(1);
          if (ent?.endsAt) updates.nextBillingDate = ent.endsAt;
        }
      }

      await tx
        .update(schema.subscriptionContracts)
        .set(updates)
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'AUTO_RENEWAL_CHANGED',
        { autoRenewal },
        'ADMIN',
        adminId,
        batch.id,
        adminId,
      );
    });
  }
  async findRecurringContracts(query: AdminRecurringContractsQuery): Promise<AdminRecurringContractsResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [eq(schema.subscriptionContracts.autoRenewal, true)];
    if (query.userId) conditions.push(eq(schema.subscriptionContracts.userId, query.userId));
    if (query.contractId) conditions.push(eq(schema.subscriptionContracts.id, query.contractId));
    if (query.status) conditions.push(eq(schema.subscriptionContracts.status, query.status));
    const dateField =
      query.dateType === 'createdAt'
        ? schema.subscriptionContracts.createdAt
        : query.dateType === 'nextBillingDate'
          ? schema.subscriptionContracts.nextBillingDate
          : schema.subscriptionContracts.updatedAt;
    if (query.dateFrom) {
      conditions.push(
        query.dateType === 'nextBillingDate'
          ? gte(schema.subscriptionContracts.nextBillingDate, query.dateFrom)
          : gte(dateField as typeof schema.subscriptionContracts.updatedAt, new Date(query.dateFrom)),
      );
    }
    if (query.dateTo) {
      conditions.push(
        query.dateType === 'nextBillingDate'
          ? lte(schema.subscriptionContracts.nextBillingDate, query.dateTo)
          : lte(dateField as typeof schema.subscriptionContracts.updatedAt, endOfDay(new Date(query.dateTo))),
      );
    }

    const whereClause = and(...conditions);

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    const [[{ total }], rows] = await Promise.all([
      this.dbService.db.select({ total: count() }).from(schema.subscriptionContracts).where(whereClause),
      this.dbService.db
        .select({
          contractId: schema.subscriptionContracts.id,
          userId: schema.subscriptionContracts.userId,
          status: schema.subscriptionContracts.status,
          autoRenewal: schema.subscriptionContracts.autoRenewal,
          nextBillingDate: schema.subscriptionContracts.nextBillingDate,
          lastPaymentIntentId: schema.subscriptionContracts.lastPaymentIntentId,
          billingInProgress: schema.subscriptionContracts.billingInProgress,
          billingStartedAt: schema.subscriptionContracts.billingStartedAt,
          createdAt: schema.subscriptionContracts.createdAt,
          updatedAt: schema.subscriptionContracts.updatedAt,
          tierCode: schema.tiers.code,
          planDurationDays: schema.plan.durationDays,
          startsAt: schema.subscriptionEntitlement.startsAt,
          endsAt: schema.subscriptionEntitlement.endsAt,
        })
        .from(schema.subscriptionContracts)
        .innerJoin(schema.plan, eq(schema.subscriptionContracts.planId, schema.plan.id))
        .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
        .leftJoin(schema.subscriptionEntitlement, entitlementConditions)
        .where(whereClause)
        .orderBy(desc(schema.subscriptionContracts.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: rows.map((r) => ({
        contractId: r.contractId,
        userId: r.userId,
        status: r.status,
        tierCode: r.tierCode,
        planDurationDays: r.planDurationDays,
        autoRenewal: r.autoRenewal,
        nextBillingDate: r.nextBillingDate,
        startsAt: r.startsAt ?? null,
        endsAt: r.endsAt ?? null,
        lastPaymentIntentId: r.lastPaymentIntentId,
        billingInProgress: r.billingInProgress,
        billingStartedAt: r.billingStartedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * billingInProgress=true 상태가 thresholdHours 이상 지속 중인 계약 조회.
   * CMS는 결과가 다음 영업일에 오므로 기본 48시간. 이 이상이면 관리자 확인 필요.
   * billingStartedAt이 있으면 그 값을, 없으면 updatedAt을 fallback으로 사용.
   */
  async findStuckBillingContracts(thresholdHours = 48): Promise<StuckBillingContractsResponse> {
    const thresholdAt = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const rows = await this.dbService.db
      .select({
        id: schema.subscriptionContracts.id,
        userId: schema.subscriptionContracts.userId,
        planId: schema.subscriptionContracts.planId,
        nextBillingDate: schema.subscriptionContracts.nextBillingDate,
        billingStartedAt: schema.subscriptionContracts.billingStartedAt,
        updatedAt: schema.subscriptionContracts.updatedAt,
      })
      .from(schema.subscriptionContracts)
      .where(
        and(
          eq(schema.subscriptionContracts.billingInProgress, true),
          notInArray(schema.subscriptionContracts.status, ['CANCELLED', 'EXPIRED']),
          sql`COALESCE(${schema.subscriptionContracts.billingStartedAt}, ${schema.subscriptionContracts.updatedAt}) <= ${thresholdAt}`,
        ),
      )
      .orderBy(asc(schema.subscriptionContracts.billingStartedAt));

    const now = Date.now();

    return {
      data: rows.map((r) => {
        const since = r.billingStartedAt ?? r.updatedAt;
        return {
          contractId: r.id,
          userId: r.userId,
          planId: r.planId,
          nextBillingDate: r.nextBillingDate ?? null,
          billingInProgressSince: since.toISOString(),
          hoursElapsed: Math.floor((now - since.getTime()) / (1000 * 60 * 60)),
        };
      }),
      total: rows.length,
    };
  }

  /**
   * 관리자 수동 조작: billingInProgress 플래그 해제.
   * wallet 결과 이벤트가 영구적으로 오지 않는 경우 관리자가 직접 해제하여 다음 주기 결제가 가능하게 함.
   * 감사 이벤트(BILLING_PROGRESS_RESET_BY_ADMIN)를 트랜잭션 안에 기록하여 조작 이력을 남긴다.
   * 서버 측에서도 48h 경과 조건을 강제한다 — UI 제한만으로는 API 직접 호출을 막을 수 없다.
   */
  async resetBillingInProgress(
    contractId: string,
    adminId: string,
    reason: string,
  ): Promise<{ contractId: string; reset: boolean }> {
    const THRESHOLD_HOURS = 48;
    const thresholdAt = new Date(Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000);

    const reset = await this.dbService.db.transaction(async (tx) => {
      const [contract] = await tx
        .select({
          userId: schema.subscriptionContracts.userId,
          billingStartedAt: schema.subscriptionContracts.billingStartedAt,
          updatedAt: schema.subscriptionContracts.updatedAt,
        })
        .from(schema.subscriptionContracts)
        .where(
          and(
            eq(schema.subscriptionContracts.id, contractId),
            eq(schema.subscriptionContracts.billingInProgress, true),
          ),
        )
        .limit(1);

      if (!contract) return false;

      const since = contract.billingStartedAt ?? contract.updatedAt;
      const elapsedHours = Math.floor((Date.now() - since.getTime()) / (1000 * 60 * 60));
      if (since > thresholdAt) {
        throw new Error(
          `잘못된 요청: billingInProgress 경과 시간(${elapsedHours}h)이 기준(${THRESHOLD_HOURS}h) 미만입니다. 정상 결제 처리 중일 수 있습니다.`,
        );
      }

      await tx
        .update(schema.subscriptionContracts)
        .set({ billingInProgress: false, billingStartedAt: null, updatedAt: new Date() })
        .where(eq(schema.subscriptionContracts.id, contractId));

      await this.contractEventManager.addEvent(
        tx,
        contractId,
        'BILLING_PROGRESS_RESET_BY_ADMIN',
        { reason },
        'ADMIN',
        contract.userId,
        undefined,
        adminId,
      );

      return true;
    });

    return { contractId, reset };
  }
}
