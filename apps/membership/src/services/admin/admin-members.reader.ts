import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, desc, asc, ilike, gte, lte, SQL, count } from 'drizzle-orm';

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  /** ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status?: string;
  /** userId partial search */
  q?: string;
  dateFrom?: string;
  dateTo?: string;
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

@Injectable()
export class AdminMembersReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  async findAllWithDetails(query: AdminMembersQuery): Promise<AdminMembersResponse> {
    const { page = 1, limit = 20, status, q, dateFrom, dateTo } = query;
    const offset = (page - 1) * limit;

    const baseConditions: SQL[] = [];

    if (q) {
      baseConditions.push(ilike(schema.subscriptionContracts.userId, `%${q}%`));
    }

    if (dateFrom) {
      baseConditions.push(gte(schema.subscriptionContracts.createdAt, new Date(dateFrom)));
    }

    if (dateTo) {
      baseConditions.push(lte(schema.subscriptionContracts.createdAt, new Date(dateTo)));
    }

    // Status-specific contract conditions
    if (status === 'ACTIVE') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
    } else if (status === 'PAUSED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'ACTIVE'));
    } else if (status === 'CANCELLED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'CANCELLED'));
    } else if (status === 'EXPIRED') {
      baseConditions.push(eq(schema.subscriptionContracts.status, 'EXPIRED'));
    }

    const whereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    // For ACTIVE vs PAUSED we need to filter on the joined entitlement column.
    // We fetch first and then optionally post-filter.
    // Since PAUSED is a subset of ACTIVE contracts (where pausedAt IS NOT NULL),
    // we add the entitlement condition after fetching with a subquery approach.
    // Drizzle doesn't support complex post-join WHERE on left-join columns easily,
    // so we build the where clause manually.

    const entitlementConditions = and(
      eq(schema.subscriptionEntitlement.userId, schema.subscriptionContracts.userId),
      eq(schema.subscriptionEntitlement.isCurrent, true),
    );

    let rows = await this.dbService.db
      .select({
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
      .orderBy(desc(schema.subscriptionContracts.createdAt));

    // Post-filter for PAUSED/ACTIVE (depends on joined entitlement.pausedAt)
    if (status === 'ACTIVE') {
      rows = rows.filter((r) => r.pausedAt === null);
    } else if (status === 'PAUSED') {
      rows = rows.filter((r) => r.pausedAt !== null);
    }

    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);

    const data: AdminMemberListItem[] = paged.map((r) => {
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
      .from(schema.pauseEvents)
      .where(
        and(
          eq(schema.pauseEvents.userId, userId),
          eq(schema.pauseEvents.eventType, 'START'),
        ),
      );
    const pauseCount = Number(pauseCountResult[0]?.count ?? 0);

    const firstContractResult = await this.dbService.db
      .select({ createdAt: schema.subscriptionContracts.createdAt })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.userId, userId))
      .orderBy(asc(schema.subscriptionContracts.createdAt))
      .limit(1);
    const firstContractCreatedAt =
      firstContractResult[0]?.createdAt?.toISOString() ?? r.createdAt.toISOString();

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

  async findBillingEventsByContractId(contractId: string): Promise<BillingEventItem[]> {
    const rows = await this.dbService.db
      .select({
        id: schema.billingEvents.id,
        contractId: schema.billingEvents.contractId,
        eventType: schema.billingEvents.eventType,
        attemptNo: schema.billingEvents.attemptNo,
        amount: schema.billingEvents.amount,
        errorCode: schema.billingEvents.errorCode,
        errorMessage: schema.billingEvents.errorMessage,
        createdAt: schema.billingEvents.createdAt,
      })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.contractId, contractId))
      .orderBy(desc(schema.billingEvents.createdAt));

    return rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      eventType: r.eventType,
      attemptNo: r.attemptNo,
      amount: r.amount,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async findContractEventsByContractId(contractId: string): Promise<ContractEventItem[]> {
    const rows = await this.dbService.db
      .select({
        id: schema.subscriptionContractEvents.id,
        contractId: schema.subscriptionContractEvents.contractId,
        eventType: schema.subscriptionContractEvents.eventType,
        userId: schema.subscriptionContractEvents.userId,
        causedBy: schema.subscriptionContractEvents.causedBy,
        causedByUserId: schema.subscriptionContractEvents.causedByUserId,
        createdAt: schema.subscriptionContractEvents.createdAt,
      })
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.contractId, contractId))
      .orderBy(desc(schema.subscriptionContractEvents.createdAt));

    return rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      eventType: r.eventType,
      userId: r.userId,
      causedBy: r.causedBy,
      causedByUserId: r.causedByUserId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async updateAutoRenewal(contractId: string, autoRenewal: boolean): Promise<void> {
    await this.dbService.db
      .update(schema.subscriptionContracts)
      .set({ autoRenewal })
      .where(eq(schema.subscriptionContracts.id, contractId));
  }
}
