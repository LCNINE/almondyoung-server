/**
 * SalesOrderQueryService
 *
 * Sales Order BC의 읽기 전용 서비스.
 * Fulfillment BC에서 SO 데이터를 조회할 때 이 서비스를 직접 호출한다.
 */
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class SalesOrderQueryService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
  ) {}

  /** SO + 라인 단건 조회 (Fulfillment이 FO 생성 시 사용) */
  async getSalesOrder(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const [order] = await db.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, id)).limit(1);
    if (!order) return null;
    const lines = await db
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));
    return { ...order, lines };
  }

  /** SO 라인만 조회 */
  async getSalesOrderLines(salesOrderId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    return db.select().from(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
  }
}
