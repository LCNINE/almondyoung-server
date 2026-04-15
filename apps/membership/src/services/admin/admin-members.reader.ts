import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, desc, ilike, gte, lte, SQL } from 'drizzle-orm';

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
}
