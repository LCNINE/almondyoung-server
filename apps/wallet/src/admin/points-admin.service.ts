import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, sql, SQL, sum } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { pointEventDetails, pointEvents, pointHolds, PointEventType, WalletSchema } from '../schema';
import { DbTx } from '../types';

export interface PointsStats {
  totalEarned: number;
  totalRedeemed: number;
  totalCancelled: number;
  currentCirculating: number;
}

export interface BatchEarnResult {
  succeeded: string[];
  failed: Array<{ userId: string; reason: string }>;
}

export interface PointsBalance {
  confirmed: number;
  reserved: number;
  available: number;
}

export interface PointsEventRow {
  id: string;
  userId: string;
  eventType: string;
  amount: number;
  originalEventId: string | null;
  reasonCode: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface TopPointUser {
  userId: string;
  balance: number;
}

@Injectable()
export class PointsAdminService {
  private readonly logger = new Logger(PointsAdminService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async getBalance(userId: string): Promise<PointsBalance> {
    const db = this.dbService.db;

    const confirmedRows = await db
      .select({ amount: sql<number>`coalesce(sum(${pointEvents.amount}), 0)` })
      .from(pointEvents)
      .where(eq(pointEvents.userId, userId));

    const reservedRows = await db
      .select({ amount: sql<number>`coalesce(sum(${pointHolds.amount}), 0)` })
      .from(pointHolds)
      .where(and(eq(pointHolds.userId, userId), eq(pointHolds.status, 'AUTHORIZED')));

    const confirmed = Number(confirmedRows[0]?.amount ?? 0);
    const reserved = Number(reservedRows[0]?.amount ?? 0);

    return { confirmed, reserved, available: confirmed - reserved };
  }

  async getRecentEvents(userId: string, limit = 20): Promise<PointsEventRow[]> {
    const db = this.dbService.db;

    const rows = await db
      .select({
        id: pointEvents.id,
        userId: pointEvents.userId,
        eventType: pointEvents.eventType,
        amount: pointEvents.amount,
        originalEventId: pointEvents.originalEventId,
        reasonCode: pointEvents.reasonCode,
        expiresAt: pointEvents.expiresAt,
        createdAt: pointEvents.createdAt,
      })
      .from(pointEvents)
      .where(eq(pointEvents.userId, userId))
      .orderBy(desc(pointEvents.createdAt))
      .limit(limit);

    return rows;
  }

  async getEventsPaginated(
    userId: string,
    page: number,
    limit: number,
    filters?: { dateFrom?: string; dateTo?: string },
  ): Promise<PaginatedResponseDto<PointsEventRow>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [eq(pointEvents.userId, userId)];
    if (filters?.dateFrom) {
      conditions.push(gte(pointEvents.createdAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(pointEvents.createdAt, new Date(filters.dateTo)));
    }
    const whereCondition = and(...conditions);

    const [countResult] = await db.select({ value: count() }).from(pointEvents).where(whereCondition);

    const total = countResult?.value ?? 0;

    const rows = await db
      .select({
        id: pointEvents.id,
        userId: pointEvents.userId,
        eventType: pointEvents.eventType,
        amount: pointEvents.amount,
        originalEventId: pointEvents.originalEventId,
        reasonCode: pointEvents.reasonCode,
        expiresAt: pointEvents.expiresAt,
        createdAt: pointEvents.createdAt,
      })
      .from(pointEvents)
      .where(whereCondition)
      .orderBy(desc(pointEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return { data: rows, total, page, limit };
  }

  async earn(
    userId: string,
    amount: number,
    reasonCode?: string,
    idempotencyKey?: string,
    expiresAt?: Date,
  ): Promise<{ eventId: string }> {
    if (amount <= 0) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const eventId = randomUUID();
    const detailId = randomUUID();

    await this.dbService.db.transaction(async (tx: DbTx) => {
      await tx.insert(pointEvents).values({
        id: eventId,
        userId,
        eventType: 'EARN',
        amount,
        providerIdempotencyKey: idempotencyKey ?? `admin:earn:${eventId}`,
        reasonCode: reasonCode ?? null,
        expiresAt: expiresAt ?? null,
      });

      await tx.insert(pointEventDetails).values({
        id: detailId,
        pointEventId: eventId,
        userId,
        eventType: 'EARN',
        amount,
        earnedEventDetailId: detailId, // EARN detail은 자기 자신이 원본 lot
      });
    });

    return { eventId };
  }

  async deduct(
    userId: string,
    amount: number,
    reasonCode?: string,
  ): Promise<{ eventId: string }> {
    if (amount <= 0) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const eventId = randomUUID();

    await this.dbService.db.transaction(async (tx: DbTx) => {
      const balance = await this.getBalance(userId);
      if (balance.available < amount) {
        throw new BadRequestException(
          `잔액 부족. 사용 가능: ${balance.available}, 요청: ${amount}`,
        );
      }

      await tx.insert(pointEvents).values({
        id: eventId,
        userId,
        eventType: 'REDEEM',
        amount: -amount,
        providerIdempotencyKey: `admin:deduct:${eventId}`,
        reasonCode: reasonCode ?? null,
      });
    });

    return { eventId };
  }

  async earnCancel(
    userId: string,
    earnEventId: string,
    amount?: number,
    reasonCode?: string,
  ): Promise<{ eventId: string }> {
    const db = this.dbService.db;

    const originalRows = await db
      .select({
        id: pointEvents.id,
        eventType: pointEvents.eventType,
        amount: pointEvents.amount,
        userId: pointEvents.userId,
      })
      .from(pointEvents)
      .where(eq(pointEvents.id, earnEventId))
      .limit(1);

    const originalEvent = originalRows[0];
    if (!originalEvent) {
      throw new NotFoundException(`Point event ${earnEventId} not found`);
    }
    if (originalEvent.eventType !== 'EARN') {
      throw new BadRequestException(`Event ${earnEventId} is not an EARN event (got ${originalEvent.eventType})`);
    }
    if (originalEvent.userId !== userId) {
      throw new BadRequestException(`Event ${earnEventId} does not belong to user ${userId}`);
    }

    const [existingCancelRow] = await db
      .select({ total: sql<number>`coalesce(sum(abs(${pointEvents.amount})), 0)` })
      .from(pointEvents)
      .where(and(eq(pointEvents.eventType, 'EARN_CANCEL'), eq(pointEvents.originalEventId, earnEventId)));
    const alreadyCancelled = Number(existingCancelRow?.total ?? 0);
    const maxCancellable = originalEvent.amount - alreadyCancelled;

    if (maxCancellable <= 0) {
      throw new BadRequestException(`Event ${earnEventId} has already been fully cancelled`);
    }

    const cancelAmount = amount ?? maxCancellable;
    if (cancelAmount <= 0) {
      throw new BadRequestException('cancel amount must be greater than 0');
    }
    if (cancelAmount > maxCancellable) {
      throw new BadRequestException(
        `Cancel amount ${cancelAmount} exceeds remaining cancellable amount ${maxCancellable} (original: ${originalEvent.amount}, already cancelled: ${alreadyCancelled})`,
      );
    }

    const earnDetailRows = await db
      .select({ id: pointEventDetails.id })
      .from(pointEventDetails)
      .where(eq(pointEventDetails.pointEventId, earnEventId))
      .limit(1);

    const earnDetail = earnDetailRows[0];
    const cancelEventId = randomUUID();

    await db.transaction(async (tx: DbTx) => {
      await tx.insert(pointEvents).values({
        id: cancelEventId,
        userId,
        eventType: 'EARN_CANCEL',
        amount: -cancelAmount,
        originalEventId: earnEventId,
        providerIdempotencyKey: `admin:earn-cancel:${cancelEventId}`,
        reasonCode: reasonCode ?? null,
      });

      await tx.insert(pointEventDetails).values({
        id: randomUUID(),
        pointEventId: cancelEventId,
        userId,
        eventType: 'EARN_CANCEL',
        amount: -cancelAmount,
        originalEventDetailId: earnDetail?.id ?? null,
      });
    });

    return { eventId: cancelEventId };
  }

  async getStats(filters?: { dateFrom?: string; dateTo?: string }): Promise<PointsStats> {
    const db = this.dbService.db;

    const conditions: SQL[] = [];
    if (filters?.dateFrom) conditions.push(gte(pointEvents.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) conditions.push(lte(pointEvents.createdAt, new Date(filters.dateTo)));
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await db
      .select({
        eventType: pointEvents.eventType,
        total: sql<number>`coalesce(sum(abs(${pointEvents.amount})), 0)`,
      })
      .from(pointEvents)
      .where(where)
      .groupBy(pointEvents.eventType);

    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.eventType] = Number(r.total);

    const totalEarned = byType['EARN'] ?? 0;
    const totalRedeemed = byType['REDEEM'] ?? 0;
    const earnCancelled = byType['EARN_CANCEL'] ?? 0;
    const redeemCancelled = byType['REDEEM_CANCEL'] ?? 0;

    return {
      totalEarned,
      totalRedeemed,
      totalCancelled: earnCancelled,
      currentCirculating: totalEarned - earnCancelled - totalRedeemed + redeemCancelled,
    };
  }

  async getAllEventsPaginated(
    page: number,
    limit: number,
    filters?: { userId?: string; eventType?: string; dateFrom?: string; dateTo?: string },
  ): Promise<PaginatedResponseDto<PointsEventRow>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (filters?.userId) conditions.push(eq(pointEvents.userId, filters.userId));
    if (filters?.eventType) conditions.push(eq(pointEvents.eventType, filters.eventType as PointEventType));
    if (filters?.dateFrom) conditions.push(gte(pointEvents.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) conditions.push(lte(pointEvents.createdAt, new Date(filters.dateTo)));
    const where = conditions.length ? and(...conditions) : undefined;

    const [[countResult], rows] = await Promise.all([
      db.select({ value: count() }).from(pointEvents).where(where),
      db
        .select({
          id: pointEvents.id,
          userId: pointEvents.userId,
          eventType: pointEvents.eventType,
          amount: pointEvents.amount,
          originalEventId: pointEvents.originalEventId,
          reasonCode: pointEvents.reasonCode,
          expiresAt: pointEvents.expiresAt,
          createdAt: pointEvents.createdAt,
        })
        .from(pointEvents)
        .where(where)
        .orderBy(desc(pointEvents.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return { data: rows, total: countResult?.value ?? 0, page, limit };
  }

  async batchEarn(
    userIds: string[],
    amount: number,
    reasonCode?: string,
    expiresAt?: Date,
  ): Promise<BatchEarnResult> {
    if (amount <= 0) throw new BadRequestException('amount must be greater than 0');
    if (!userIds.length) throw new BadRequestException('userIds must not be empty');
    if (userIds.length > 1000) throw new BadRequestException('최대 1000명까지 일괄 지급 가능합니다');

    const succeeded: string[] = [];
    const failed: BatchEarnResult['failed'] = [];

    const chunkSize = 100;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);

      try {
        await this.dbService.db.transaction(async (tx: DbTx) => {
          const rows = chunk.map((userId) => ({
            id: randomUUID(),
            detailId: randomUUID(),
            userId,
          }));

          await tx.insert(pointEvents).values(
            rows.map((r) => ({
              id: r.id,
              userId: r.userId,
              eventType: 'EARN' as const,
              amount,
              providerIdempotencyKey: `admin:batch-earn:${r.id}`,
              reasonCode: reasonCode ?? null,
              expiresAt: expiresAt ?? null,
            })),
          );

          await tx.insert(pointEventDetails).values(
            rows.map((r) => ({
              id: r.detailId,
              pointEventId: r.id,
              userId: r.userId,
              eventType: 'EARN' as const,
              amount,
              earnedEventDetailId: r.detailId,
            })),
          );
        });

        for (const userId of chunk) succeeded.push(userId);
      } catch (err) {
        for (const userId of chunk) {
          failed.push({ userId, reason: err instanceof Error ? err.message : 'unknown' });
        }
      }
    }

    return { succeeded, failed };
  }

  async processExpiredPoints(): Promise<{ processed: number; cancelled: number }> {
    const db = this.dbService.db;
    const now = new Date();

    const expiredEarns = await db
      .select({
        id: pointEvents.id,
        userId: pointEvents.userId,
        amount: pointEvents.amount,
      })
      .from(pointEvents)
      .where(
        and(
          eq(pointEvents.eventType, 'EARN'),
          isNotNull(pointEvents.expiresAt),
          lt(pointEvents.expiresAt, now),
        ),
      );

    if (expiredEarns.length === 0) return { processed: 0, cancelled: 0 };

    const earnIds = expiredEarns.map((e) => e.id);
    const uniqueUserIds = [...new Set(expiredEarns.map((e) => e.userId))];

    const [cancelledRows, balanceRows] = await Promise.all([
      db
        .select({
          originalEventId: pointEvents.originalEventId,
          total: sql<number>`coalesce(sum(abs(${pointEvents.amount})), 0)`,
        })
        .from(pointEvents)
        .where(and(eq(pointEvents.eventType, 'EARN_CANCEL'), inArray(pointEvents.originalEventId, earnIds)))
        .groupBy(pointEvents.originalEventId),
      db
        .select({
          userId: pointEvents.userId,
          balance: sql<number>`coalesce(sum(${pointEvents.amount}), 0)`,
        })
        .from(pointEvents)
        .where(inArray(pointEvents.userId, uniqueUserIds))
        .groupBy(pointEvents.userId),
    ]);

    const cancelledByEarnId = new Map(cancelledRows.map((r) => [r.originalEventId, Number(r.total)]));
    const balanceByUserId = new Map(balanceRows.map((r) => [r.userId, Number(r.balance)]));

    // 이번 실행에서 유저별 누적 취소액 (동일 유저의 여러 만료 건 과차감 방지)
    const cancelledThisRun = new Map<string, number>();
    // 일별 멱등성 키: 당일 재실행 시 중복 방지, 익일 잔여 처리 가능
    const today = new Date().toISOString().slice(0, 10);

    let processed = 0;
    let cancelled = 0;

    for (const earn of expiredEarns) {
      try {
        const alreadyCancelled = cancelledByEarnId.get(earn.id) ?? 0;
        const remaining = earn.amount - alreadyCancelled;
        if (remaining <= 0) continue;

        const userBalance = balanceByUserId.get(earn.userId) ?? 0;
        const cancelledSoFar = cancelledThisRun.get(earn.userId) ?? 0;
        const cancelAmount = Math.min(remaining, userBalance - cancelledSoFar);
        if (cancelAmount <= 0) continue;

        cancelledThisRun.set(earn.userId, cancelledSoFar + cancelAmount);

        const cancelEventId = randomUUID();
        await db.transaction(async (tx: DbTx) => {
          await tx.insert(pointEvents).values({
            id: cancelEventId,
            userId: earn.userId,
            eventType: 'EARN_CANCEL',
            amount: -cancelAmount,
            originalEventId: earn.id,
            providerIdempotencyKey: `expiry:${earn.id}:${today}`,
            reasonCode: 'POINT_EXPIRED',
          });

          await tx.insert(pointEventDetails).values({
            id: randomUUID(),
            pointEventId: cancelEventId,
            userId: earn.userId,
            eventType: 'EARN_CANCEL',
            amount: -cancelAmount,
            originalEventDetailId: null,
          });
        });

        cancelled++;
        processed++;
      } catch (err) {
        this.logger.warn(`Failed to expire EARN event ${earn.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { processed, cancelled };
  }

  async getTopUsersByBalance(limit: number): Promise<TopPointUser[]> {
    const balanceExpr = sql<number>`coalesce(sum(${pointEvents.amount}), 0)`;
    const rows = await this.dbService.db
      .select({ userId: pointEvents.userId, balance: balanceExpr })
      .from(pointEvents)
      .groupBy(pointEvents.userId)
      .having(sql`${balanceExpr} > 0`)
      .orderBy(desc(balanceExpr))
      .limit(limit);

    return rows.map((r) => ({ userId: r.userId, balance: Number(r.balance) }));
  }
}
