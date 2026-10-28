import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { purchaseSatisfactions, type UgcServiceSchema, type UgcTx } from '../db/schema';
import type { UpsertPurchaseSatisfactionDto } from './dto/upsert-purchase-satisfaction.dto';
import type { PurchaseSatisfactionReason, PurchaseSatisfactionRow } from './types';

const MAX_REASON_RATING = 3;

const sameReasons = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

@Injectable()
export class PurchaseSatisfactionManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async upsert(orderId: string, dto: UpsertPurchaseSatisfactionDto, tx?: UgcTx): Promise<PurchaseSatisfactionRow> {
    return this.db.run(async (trx) => {
      const memo = dto.memo?.trim() ? dto.memo.trim() : null;
      const reasons: PurchaseSatisfactionReason[] = dto.reasons ?? [];
      if (dto.rating > MAX_REASON_RATING && (reasons.length > 0 || memo !== null)) {
        throw new BadRequestError('Reasons and memo are only accepted for ratings of 3 or below');
      }

      const [created] = await trx
        .insert(purchaseSatisfactions)
        .values({
          orderId,
          orderDisplayId: dto.orderDisplayId,
          userId: dto.userId,
          rating: dto.rating,
          reasons,
          memo,
        })
        .onConflictDoNothing({ target: purchaseSatisfactions.orderId })
        .returning();
      if (created) return created;

      const [existing] = await trx
        .select()
        .from(purchaseSatisfactions)
        .where(eq(purchaseSatisfactions.orderId, orderId))
        .limit(1)
        .for('update');

      const changed =
        existing.rating !== dto.rating || existing.memo !== memo || !sameReasons(existing.reasons, reasons);

      const [updated] = await trx
        .update(purchaseSatisfactions)
        .set({
          orderDisplayId: dto.orderDisplayId,
          userId: dto.userId,
          rating: dto.rating,
          reasons,
          memo,
          ...(changed ? { checkedAt: null, checkedBy: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(purchaseSatisfactions.id, existing.id))
        .returning();
      return updated;
    }, tx);
  }

  async setChecked(id: string, checked: boolean, adminId: string, tx?: UgcTx): Promise<PurchaseSatisfactionRow> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .update(purchaseSatisfactions)
        .set(checked ? { checkedAt: new Date(), checkedBy: adminId } : { checkedAt: null, checkedBy: null })
        .where(eq(purchaseSatisfactions.id, id))
        .returning();
      if (!row) throw new NotFoundError(`Purchase satisfaction not found: ${id}`);
      return row;
    }, tx);
  }
}
