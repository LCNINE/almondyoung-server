import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { pointEventDetails, pointEvents, pointHolds, WalletSchema } from '../schema';
import { DbTx } from '../types';

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
  createdAt: Date;
}

@Injectable()
export class PointsAdminService {
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
        createdAt: pointEvents.createdAt,
      })
      .from(pointEvents)
      .where(eq(pointEvents.userId, userId))
      .orderBy(desc(pointEvents.createdAt))
      .limit(limit);

    return rows;
  }

  async getEventsPaginated(userId: string, page: number, limit: number): Promise<PaginatedResponseDto<PointsEventRow>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;

    const [countResult] = await db.select({ value: count() }).from(pointEvents).where(eq(pointEvents.userId, userId));

    const total = countResult?.value ?? 0;

    const rows = await db
      .select({
        id: pointEvents.id,
        userId: pointEvents.userId,
        eventType: pointEvents.eventType,
        amount: pointEvents.amount,
        originalEventId: pointEvents.originalEventId,
        reasonCode: pointEvents.reasonCode,
        createdAt: pointEvents.createdAt,
      })
      .from(pointEvents)
      .where(eq(pointEvents.userId, userId))
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

    const cancelAmount = amount ?? originalEvent.amount;
    if (cancelAmount <= 0) {
      throw new BadRequestException('cancel amount must be greater than 0');
    }
    if (cancelAmount > originalEvent.amount) {
      throw new BadRequestException(
        `Cancel amount ${cancelAmount} exceeds original EARN amount ${originalEvent.amount}`,
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
}
