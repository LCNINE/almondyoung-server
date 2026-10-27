import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';
import { toReturnEligibilityLines, type ReturnEligibilityResponse } from './return-eligibility';

/** Medusa 주문 하나의 줄별 배송 사실을 한 트랜잭션에서 읽는다. 없는 주문은 `found: false`. */
export async function readReturnEligibility(trx: DbTx, externalOrderId: string): Promise<ReturnEligibilityResponse> {
  const [order] = await trx
    .select({ id: wmsTables.salesOrders.id })
    .from(wmsTables.salesOrders)
    .where(
      and(eq(wmsTables.salesOrders.salesChannel, 'medusa'), eq(wmsTables.salesOrders.channelOrderId, externalOrderId)),
    )
    .limit(1);
  if (!order) return { found: false, lines: [], customerReturns: [] };

  const lineRows = await trx
    .select({ id: wmsTables.salesOrderLines.id, channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.salesOrderId, order.id))
    .orderBy(asc(wmsTables.salesOrderLines.id));
  const quantities = await readLineQuantities(trx, order.id);
  const parcels = await readParcelClaimEligibility(trx, order.id);
  const lines = lineRows.flatMap((row) => {
    const lineQuantities = quantities.get(row.id);
    return lineQuantities ? [{ channelOrderItemId: row.channelOrderItemId, quantities: lineQuantities }] : [];
  });
  const customerReturns = await trx
    .select({
      channelReturnId: wmsTables.customerReturns.channelReturnId,
      status: wmsTables.customerReturns.status,
    })
    .from(wmsTables.customerReturns)
    .where(eq(wmsTables.customerReturns.salesOrderId, order.id))
    .orderBy(asc(wmsTables.customerReturns.requestedAt), asc(wmsTables.customerReturns.id));
  return { found: true, lines: toReturnEligibilityLines(lines, parcels), customerReturns };
}

@Injectable()
export class ReturnEligibilityReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  read(externalOrderId: string, tx?: DbTx): Promise<ReturnEligibilityResponse> {
    return this.dbService.run((trx) => readReturnEligibility(trx, externalOrderId), tx);
  }
}
