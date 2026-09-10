import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';

@Injectable()
export class PoliciesService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
  ) {}

  async getVariantPolicy(variantId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const policy = await db.query.salesVariantPolicies.findFirst({
      where: (p, { eq }) => eq(p.variantId, variantId),
    });
    if (!policy) {
      return {
        variantId,
        inventoryManagement: true,
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        effectiveFrom: null,
        effectiveTo: null,
        updatedBy: null,
        updatedAt: new Date(),
      } as any;
    }
    // #744 — `effectiveFrom`/`effectiveTo` 는 `timestamptz` 에서 온 «진짜 순간»이므로
    // 기준도 진짜 순간이어야 한다. 서울 벽시계와 견주면 창이 9시간 어긋난다.
    const now = new Date();
    if (policy.effectiveFrom && policy.effectiveFrom > now) return policy;
    if (policy.effectiveTo && policy.effectiveTo < now) return policy;
    return policy;
  }
}
