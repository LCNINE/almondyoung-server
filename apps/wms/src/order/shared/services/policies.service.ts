import { Injectable } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { nowSeoul } from '../../../shared/services/time.util';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class PoliciesService {
  constructor(private readonly db: DbService<typeof wmsTables>) {}

  async getVariantPolicy(variantId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const policy = await db.query.salesVariantPolicies.findFirst({
      where: (p, { eq }) => eq(p.variantId, variantId),
    });
    if (!policy) {
      // 기본 정책: 재고관리 false(무형), 선판매/제로판매 false
      return {
        variantId,
        inventoryManagement: false,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        fulfillmentMode: null,
        effectiveFrom: null,
        effectiveTo: null,
        updatedBy: null,
        updatedAt: nowSeoul(),
      } as any;
    }
    // 유효기간 체크(Asia/Seoul 기준)
    const now = nowSeoul();
    if (policy.effectiveFrom && policy.effectiveFrom > now) return policy; // 아직 비효
    if (policy.effectiveTo && policy.effectiveTo < now) return policy; // 만료 표시만, 상위에서 처리 가능
    return policy;
  }

  evaluateAcceptance(policy: {
    inventoryManagement: boolean;
    preStockSellable: boolean;
    alwaysSellableZeroStock: boolean;
  }, onHandQty: number, requestedQty: number): boolean {
    if (!policy.inventoryManagement) return true;
    if (policy.preStockSellable) return true;
    if (policy.alwaysSellableZeroStock) return true;
    return onHandQty >= requestedQty;
  }

  evaluateFulfillability(policy: {
    inventoryManagement: boolean;
    preStockSellable: boolean;
    alwaysSellableZeroStock: boolean;
  }, onHandQty: number, requestedQty: number): boolean {
    if (!policy.inventoryManagement) return true;
    return onHandQty >= requestedQty;
  }
}


