import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { PlannedShipmentDto } from '../dto/consolidation.dto';
import { loadShipmentLines, OptionLine, uniqueInOrder } from './consolidation-shipment-reads';

export const PLANNED_SHIPMENTS_LIMIT = 200;

export function assemblePlannedShipments(
  shipmentIds: readonly string[],
  lines: readonly OptionLine[],
): PlannedShipmentDto[] {
  const linesByShipment = new Map<string, OptionLine[]>();

  for (const line of lines) {
    linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
  }

  return shipmentIds.map((shipmentId) => {
    const shipmentLines = linesByShipment.get(shipmentId) ?? [];

    return {
      shipmentId,
      orderNos: uniqueInOrder(
        shipmentLines.flatMap((line) => {
          const orderNo = line.displayOrderNo ?? line.channelOrderId;

          return orderNo ? [orderNo] : [];
        }),
      ),
      totalQty: shipmentLines.reduce((total, line) => total + line.qty, 0),
    };
  });
}

@Injectable()
export class PlannedShipmentsReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async findPlanned(warehouseId: string, tx?: DbTx): Promise<PlannedShipmentDto[]> {
    return this.dbService.run(async (trx) => {
      const shipments = await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(
          and(
            eq(wmsTables.shipments.warehouseId, warehouseId),
            eq(wmsTables.shipments.status, 'planned'),
            isNull(wmsTables.shipments.supplierId),
          ),
        )
        .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id))
        .limit(PLANNED_SHIPMENTS_LIMIT);
      const ids = shipments.map((shipment) => shipment.id);
      const lines = await loadShipmentLines(trx, ids);

      return assemblePlannedShipments(ids, lines);
    }, tx);
  }
}
