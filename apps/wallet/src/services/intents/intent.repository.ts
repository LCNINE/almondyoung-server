import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import type {
  PaymentIntent,
  NewPaymentIntent,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * IntentRepository (Data Access Layer)
 *
 * 책임: Intent 데이터 접근 (순수 DB 접근만)
 */
@Injectable()
export class IntentRepository {
  private readonly logger = new Logger(IntentRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  async findById(intentId: string): Promise<PaymentIntent | null> {
    const intent = await this.db.db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, intentId),
    });
    return intent ?? null;
  }

  async create(
    data: NewPaymentIntent,
    tx?: WalletExecutor,
  ): Promise<PaymentIntent> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.paymentIntents)
      .values(data)
      .returning();

    this.logger.log(`Intent created: ${created.id}`);
    return created;
  }

  async updateStatus(
    intentId: string,
    status: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.paymentIntents)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intentId));
  }

  async updateDiscounts(
    intentId: string,
    discounts: any[],
    discountsTotal: number,
    finalAmount: number,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.paymentIntents)
      .set({
        discounts: discounts as any,
        discountsTotal,
        finalAmount,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));
  }

  async markAsCaptured(intentId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.paymentIntents)
      .set({
        status: 'CAPTURED',
        capturedAt: new Date(),
        authorizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));
  }

  async markAsUnknown(intentId: string): Promise<void> {
    await this.db.db
      .update(schema.paymentIntents)
      .set({ status: 'UNKNOWN' as any, updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intentId));
  }
}
