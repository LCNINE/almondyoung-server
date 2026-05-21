import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { nowSeoul } from '../../inventory/shared/services/time.util';

@Injectable()
export class PoliciesService {
  constructor(private readonly db: DbService<typeof wmsSchema>) {}

  async getVariantPolicy(variantId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const policy = await db.query.salesVariantPolicies.findFirst({
      where: (p, { eq }) => eq(p.variantId, variantId),
    });
    if (!policy) {
      return {
        variantId,
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        effectiveFrom: null,
        effectiveTo: null,
        updatedBy: null,
        updatedAt: nowSeoul(),
      } as any;
    }
    const now = nowSeoul();
    if (policy.effectiveFrom && policy.effectiveFrom > now) return policy;
    if (policy.effectiveTo && policy.effectiveTo < now) return policy;
    return policy;
  }

  evaluateAcceptance(
    policy: {
      inventoryManagement: boolean;
      preStockSellable: boolean;
      alwaysSellableZeroStock: boolean;
    },
    onHandQty: number,
    requestedQty: number,
  ): boolean {
    if (!policy.inventoryManagement) return true;
    if (policy.preStockSellable) return true;
    if (policy.alwaysSellableZeroStock) return true;
    return onHandQty >= requestedQty;
  }

  evaluateFulfillability(
    policy: {
      inventoryManagement: boolean;
      preStockSellable: boolean;
      alwaysSellableZeroStock: boolean;
    },
    onHandQty: number,
    requestedQty: number,
  ): boolean {
    if (!policy.inventoryManagement) return true;
    return onHandQty >= requestedQty;
  }
}
