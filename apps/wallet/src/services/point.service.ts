import { Injectable } from '@nestjs/common';

import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { WalletTx } from '../shared/database';

@Injectable()
export class PointService {
  constructor(private readonly db: DbService<typeof schema>) {}

  async getBalance(userId: string, tx?: WalletTx) {
    const database = tx || this.db.db;
    const [point] = await database
      .select()
      .from(schema.points)
      .where(eq(schema.points.userId, userId))
      .limit(1);

    if (!point) {
      throw new NotFoundException(`포인트 계정 없음: ${userId}`);
    }

    return point;
  }

  async redeem(userId: string, amount: number, reason: string, tx: WalletTx) {
    const point = await this.getBalance(userId, tx);

    if (point.balance < amount) {
      throw new BadRequestException(
        `포인트 부족. 요청:${amount}, 잔액:${point.balance}`,
      );
    }

    const newBalance = point.balance - amount;
    await tx
      .update(schema.points)
      .set({
        balance: newBalance,
        version: point.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.points.id, point.id));

    const [trx] = await tx
      .insert(schema.pointEvents)
      .values({
        pointId: point.id,
        type: 'REDEEM',
        amount: -amount,
        reason,
      })
      .returning();

    return { newBalance, transaction: trx };
  }

  async earn(userId: string, amount: number, reason: string, tx: WalletTx) {
    const point = await this.getBalance(userId, tx);
    const newBalance = point.balance + amount;

    await tx
      .update(schema.points)
      .set({
        balance: newBalance,
        version: point.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.points.id, point.id));

    const [trx] = await tx
      .insert(schema.pointEvents)
      .values({
        pointId: point.id,
        type: 'EARN',
        amount,
        reason,
      })
      .returning();

    return { newBalance, transaction: trx };
  }
}
