import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { hasOrderLine } from './supplier-shipment-queue.reader';

export type SupplierHandoffSummary = {
  handoffId: string;
  createdAt: Date;
  createdBy: string;
  /** 그 묶음을 가리키는 열린 상자(draft·recovery_required) */
  openShipments: number;
  shippedShipments: number;
  /** 열린 상자에서 입점사가 «못 보냄»으로 알린 라인 */
  unfulfillableLines: number;
};

const RECENT_LIMIT = 50;

/**
 * 입점사의 넘김 묶음 목록 — 최근 50개 (K3 PR7, N5). 개인정보 없음.
 * 합포장 상자는 가장 이른 묶음에 있으므로 묶음별 수는 근사다(PR 5 N7). canceled·superseded 상자는 세지 않는다.
 */
@Injectable()
export class SupplierHandoffListReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async recent(supplierId: string, tx?: DbTx): Promise<SupplierHandoffSummary[]> {
    return this.dbService.run(async (trx) => {
      const { supplierHandoffs, shipments } = wmsTables;
      const open = sql`${shipments.status} IN ('draft', 'recovery_required')`;
      return trx
        .select({
          handoffId: supplierHandoffs.id,
          createdAt: supplierHandoffs.createdAt,
          createdBy: supplierHandoffs.createdBy,
          openShipments:
            sql<number>`count(DISTINCT ${shipments.id}) FILTER (WHERE ${open} AND ${hasOrderLine(shipments.id)})`.mapWith(
              Number,
            ),
          shippedShipments:
            sql<number>`count(DISTINCT ${shipments.id}) FILTER (WHERE ${shipments.status} = 'shipped')`.mapWith(Number),
          unfulfillableLines: sql<number>`(
            SELECT count(*) FROM shipment_lines ul
              JOIN shipments us ON us.id = ul.shipment_id
              WHERE us.supplier_handoff_id = ${supplierHandoffs.id}
                AND us.status IN ('draft', 'recovery_required')
                AND ul.unfulfillable_reason IS NOT NULL
          )`.mapWith(Number),
        })
        .from(supplierHandoffs)
        .leftJoin(shipments, eq(shipments.supplierHandoffId, supplierHandoffs.id))
        .where(eq(supplierHandoffs.supplierId, supplierId))
        .groupBy(supplierHandoffs.id, supplierHandoffs.createdAt, supplierHandoffs.createdBy)
        .orderBy(desc(supplierHandoffs.createdAt), desc(supplierHandoffs.id))
        .limit(RECENT_LIMIT);
    }, tx);
  }
}
