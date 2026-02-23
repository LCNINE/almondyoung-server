import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { WalletSchema, paymentCustomers } from '../schema';
import { DbTx, PaymentCustomer } from '../types';

@Injectable()
export class PaymentCustomersService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  /** Upsert a customer by external_user_id; returns the customer record. */
  async upsertByExternalUserId(
    externalUserId: string,
    metadata?: Record<string, unknown>,
    tx?: DbTx,
  ): Promise<PaymentCustomer> {
    const db = tx ?? this.dbService.db;

    const rows = await (db as typeof this.dbService.db)
      .insert(paymentCustomers)
      .values({
        externalUserId,
        metadata: metadata ?? {},
      })
      .onConflictDoUpdate({
        target: paymentCustomers.externalUserId,
        set: {
          updatedAt: sql`now()`,
          ...(metadata ? { metadata } : {}),
        },
      })
      .returning();

    const customer = rows[0];
    if (!customer) {
      throw new Error(`PAYMENT_CUSTOMER_UPSERT_FAILED: ${externalUserId}`);
    }
    return customer;
  }

  async findByExternalUserId(
    externalUserId: string,
    tx?: DbTx,
  ): Promise<PaymentCustomer | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select()
      .from(paymentCustomers)
      .where(eq(paymentCustomers.externalUserId, externalUserId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(customerId: string, tx?: DbTx): Promise<PaymentCustomer | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select()
      .from(paymentCustomers)
      .where(eq(paymentCustomers.id, customerId))
      .limit(1);
    return rows[0] ?? null;
  }
}
