import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

export interface BatchControlledStockAvailability {
  onHandQty: number;
  stockVersion: number | null;
  batchControlledQty: number;
  generallyAvailableQty: number;
}

/**
 * Database-backed capability for the only intentional controlled-stock removal:
 * a pending shipment dispatch source linked to an active custody session.
 * The repository validates both identifiers and atomically consumes the source
 * by linking its stock event; callers cannot opt out with a boolean flag.
 */
export interface BatchSessionDispatchAuthorization {
  sessionId: string;
  dispatchAttemptSourceId: string;
}

/**
 * Protects physical source buckets handed to a Batch Inventory Session.
 *
 * Custody never changes the economic stock ledger. This guard therefore overlays
 * active session balances on ON_HAND and is shared by every general removal path.
 * SETTLED balances are excluded because dispatch owns their economic removal in
 * the same transaction; returned quantities have no remaining balance.
 */
@Injectable()
export class BatchControlledStockGuard {
  async getAvailability(
    input: { skuId: string; warehouseId: string; sourceLocationId: string },
    tx: DbTx,
    options: { lock?: boolean; excludingSessionId?: string } = {},
  ): Promise<BatchControlledStockAvailability> {
    const ledgerQuery = tx
      .select({ qty: wmsTables.stockLedgers.qty, version: wmsTables.stockLedgers.version })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, input.skuId),
          eq(wmsTables.stockLedgers.warehouseId, input.warehouseId),
          eq(wmsTables.stockLedgers.locationId, input.sourceLocationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    const ledgerRows = options.lock ? await ledgerQuery.for('update') : await ledgerQuery;

    const sessionPredicates = [
      eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
      eq(wmsTables.batchInventorySessionBalances.sourceLocationId, input.sourceLocationId),
      ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
      inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
    ];
    if (options.excludingSessionId) {
      sessionPredicates.push(ne(wmsTables.batchInventorySessions.id, options.excludingSessionId));
    }

    const [controlled] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.batchInventorySessions,
        eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
      )
      .where(and(...sessionPredicates));

    const onHandQty = ledgerRows[0]?.qty ?? 0;
    const batchControlledQty = Number(controlled?.qty ?? 0);
    return {
      onHandQty,
      stockVersion: ledgerRows[0]?.version ?? null,
      batchControlledQty,
      generallyAvailableQty: Math.max(0, onHandQty - batchControlledQty),
    };
  }

  async assertRemovalAllowed(
    input: { skuId: string; warehouseId: string; sourceLocationId: string; quantity: number },
    tx: DbTx,
  ): Promise<BatchControlledStockAvailability> {
    const availability = await this.getAvailability(input, tx, { lock: true });
    if (input.quantity > availability.generallyAvailableQty) {
      throw new ConflictException({
        code: 'BATCH_CONTROLLED_STOCK',
        message: `Source stock is controlled by an active batch session`,
        skuId: input.skuId,
        warehouseId: input.warehouseId,
        sourceLocationId: input.sourceLocationId,
        requestedQty: input.quantity,
        ...availability,
      });
    }
    return availability;
  }
}
