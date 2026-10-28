import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { purchaseSatisfactions, type UgcServiceSchema, type UgcTx } from '../db/schema';
import type { PurchaseSatisfactionRow } from './types';

@Injectable()
export class PurchaseSatisfactionReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async findByOrderId(orderId: string, tx?: UgcTx): Promise<PurchaseSatisfactionRow> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(purchaseSatisfactions)
        .where(eq(purchaseSatisfactions.orderId, orderId))
        .limit(1);
      if (!row) throw new NotFoundError(`Purchase satisfaction not found: ${orderId}`);
      return row;
    }, tx);
  }
}
