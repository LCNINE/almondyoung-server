import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  wmsTables,
  wmsSchema,
  DbTx,
} from '../../inventory/schema/inventory.schema';
import {
  digitalAssetOwnerships,
  productVariantDigitalAssetLinks,
} from '../schema/library.schema';

/**
 * Library 도메인의 사용권(ownership) 발급/회수 서비스.
 *
 * - grantOwnershipsForOrder: ADR-0006 단일 grant 경로. OrderConfirmed (결제 완료) 시
 *   같은 트랜잭션에서 호출되어, SO line 의 variant 매칭 asset 별로 ownership row 를 만든다.
 * - revokeOwnershipsForOrder: OrderCancelled 시 exercise 전인 ownership 만 회수. exercise
 *   된 것은 회수하지 않으며 환불 가부는 결제 측이 결정.
 *
 * 0 원 결제도 같은 OrderConfirmed 경로를 통과한다 (ADR-0008).
 */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * SO 의 모든 line 의 variant 에 매칭된 모든 asset 에 대해 ownership 을 발급.
   *
   * 멱등성: `(customerId, assetId, salesOrderId)` 의 unique index 를 통해 중복 insert
   * 는 ON CONFLICT DO NOTHING 으로 흡수. 같은 OrderConfirmed 이벤트가 재처리돼도 안전.
   *
   * @returns 새로 생성된 ownership 수.
   */
  async grantOwnershipsForOrder(salesOrderId: string, tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const [order] = await trx
        .select({
          id: wmsTables.salesOrders.id,
          customerId: wmsTables.salesOrders.customerId,
        })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, salesOrderId));

      if (!order) {
        this.logger.warn(`[grantOwnershipsForOrder] SO not found: ${salesOrderId}`);
        return 0;
      }
      if (!order.customerId) {
        // 디지털 트랙은 customerId 가 필수. 비-로그인 채널(Naver, Coupang)은 그냥 no-op.
        this.logger.log(
          `[grantOwnershipsForOrder] SO has no customerId, skipping digital grant: ${salesOrderId}`,
        );
        return 0;
      }

      const lines = await trx
        .select({ variantId: wmsTables.salesOrderLines.variantId })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));

      if (lines.length === 0) return 0;

      const variantIds = Array.from(new Set(lines.map((l) => l.variantId)));

      const linkRows = await trx
        .select({ assetId: productVariantDigitalAssetLinks.assetId })
        .from(productVariantDigitalAssetLinks)
        .where(inArray(productVariantDigitalAssetLinks.variantId, variantIds));

      if (linkRows.length === 0) return 0;

      const uniqueAssetIds = Array.from(new Set(linkRows.map((r) => r.assetId)));

      const inserted = await trx
        .insert(digitalAssetOwnerships)
        .values(
          uniqueAssetIds.map((assetId) => ({
            customerId: order.customerId!,
            assetId,
            salesOrderId,
          })),
        )
        .onConflictDoNothing({
          target: [
            digitalAssetOwnerships.customerId,
            digitalAssetOwnerships.assetId,
            digitalAssetOwnerships.salesOrderId,
          ],
        })
        .returning({ id: digitalAssetOwnerships.id });

      this.logger.log(
        `[grantOwnershipsForOrder] SO=${salesOrderId} customer=${order.customerId} ` +
          `granted ${inserted.length}/${uniqueAssetIds.length} (rest already existed)`,
      );
      return inserted.length;
    }, tx);
  }

  /**
   * OrderCancelled 시 호출. exercise 전 (exercisedAt IS NULL) ownership 만 회수한다.
   * exercise 된 것은 회수하지 않음 (ADR-0006).
   */
  async revokeOwnershipsForOrder(
    salesOrderId: string,
    reason: string | null,
    tx?: DbTx,
  ): Promise<number> {
    return this.inTx(async (trx) => {
      const updated = await trx
        .update(digitalAssetOwnerships)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(
          and(
            eq(digitalAssetOwnerships.salesOrderId, salesOrderId),
            isNull(digitalAssetOwnerships.exercisedAt),
            isNull(digitalAssetOwnerships.revokedAt),
          ),
        )
        .returning({ id: digitalAssetOwnerships.id });

      if (updated.length > 0) {
        this.logger.log(
          `[revokeOwnershipsForOrder] SO=${salesOrderId} revoked ${updated.length} ownership(s)`,
        );
      }
      return updated.length;
    }, tx);
  }
}
