import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { WalletSchema, charges, paymentMethods, ChargeOperation, ChargeStatus } from '../schema';
import { Charge, DbTx, NewCharge } from '../types';

@Injectable()
export class ChargesService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async create(data: NewCharge, tx?: DbTx): Promise<Charge> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db).insert(charges).values(data).returning();
    const charge = rows[0];
    if (!charge) throw new Error('CHARGE_INSERT_FAILED');
    return charge;
  }

  async findById(id: string, tx?: DbTx): Promise<Charge | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db).select().from(charges).where(eq(charges.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findActiveByIntentAndOperation(
    intentId: string,
    operation: ChargeOperation,
    tx?: DbTx,
  ): Promise<Charge | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.intentId, intentId),
          eq(charges.operation, operation),
          inArray(charges.status, ['CREATED', 'PENDING', 'REQUIRES_ACTION']),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findSucceededAuthorizeByIntent(intentId: string, tx?: DbTx): Promise<Charge | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select()
      .from(charges)
      .where(and(eq(charges.intentId, intentId), eq(charges.operation, 'AUTHORIZE'), eq(charges.status, 'SUCCEEDED')))
      .orderBy(desc(charges.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllSucceededAuthorizeByIntent(intentId: string, tx?: DbTx): Promise<Charge[]> {
    const db = tx ?? this.dbService.db;
    return (db as typeof this.dbService.db)
      .select()
      .from(charges)
      .where(and(eq(charges.intentId, intentId), eq(charges.operation, 'AUTHORIZE'), eq(charges.status, 'SUCCEEDED')))
      .orderBy(asc(charges.createdAt));
  }

  async findSucceededPointsAuthorizeByIntent(intentId: string, tx?: DbTx): Promise<Charge | null> {
    const db = tx ?? this.dbService.db;
    const rows = await (db as typeof this.dbService.db)
      .select({ charge: charges })
      .from(charges)
      .innerJoin(paymentMethods, eq(paymentMethods.id, charges.paymentMethodId))
      .where(
        and(
          eq(charges.intentId, intentId),
          eq(charges.operation, 'AUTHORIZE'),
          eq(charges.status, 'SUCCEEDED'),
          eq(paymentMethods.type, 'POINTS'),
        ),
      )
      .limit(1);
    return rows[0]?.charge ?? null;
  }

  async findRefundableByIntent(intentId: string, tx?: DbTx): Promise<Charge[]> {
    const db = tx ?? this.dbService.db;

    // 1순위: CAPTURE. A captured leg is the refund source of truth.
    // If capture rows exist but none are still SUCCEEDED, the payment has already
    // been refunded or is no longer provider-refundable. Do not fall back to the
    // original AUTHORIZE leg, otherwise providers like Toss receive a duplicate
    // cancel request for an already-canceled payment.
    const captured = await (db as typeof this.dbService.db)
      .select()
      .from(charges)
      .where(and(eq(charges.intentId, intentId), eq(charges.operation, 'CAPTURE')))
      .orderBy(asc(charges.createdAt));

    const refundableCaptures = captured.filter((charge) => charge.status === 'SUCCEEDED');
    if (refundableCaptures.length > 0) return refundableCaptures;
    if (captured.length > 0) return [];

    // 2순위: AUTHORIZE + SUCCEEDED (포인트 전액결제 등 capture 없는 케이스)
    return (db as typeof this.dbService.db)
      .select()
      .from(charges)
      .where(and(eq(charges.intentId, intentId), eq(charges.operation, 'AUTHORIZE'), eq(charges.status, 'SUCCEEDED')))
      .orderBy(asc(charges.createdAt));
  }

  async updateStatus(
    id: string,
    status: ChargeStatus,
    extra?: {
      providerTransactionId?: string;
      errorCode?: string;
      errorMessage?: string;
      responsePayload?: Record<string, unknown>;
    },
    tx?: DbTx,
  ): Promise<void> {
    const db = tx ?? this.dbService.db;
    await (db as typeof this.dbService.db)
      .update(charges)
      .set({
        status,
        updatedAt: new Date(),
        ...(extra?.providerTransactionId !== undefined ? { providerTransactionId: extra.providerTransactionId } : {}),
        ...(extra?.errorCode !== undefined ? { errorCode: extra.errorCode } : {}),
        ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
        ...(extra?.responsePayload !== undefined ? { responsePayload: extra.responsePayload } : {}),
      })
      .where(eq(charges.id, id));
  }

  /** Generate a provider idempotency key for a charge operation */
  generateIdempotencyKey(chargeId: string, operation: ChargeOperation): string {
    return `wallet:${operation.toLowerCase()}:${chargeId}`;
  }
}
