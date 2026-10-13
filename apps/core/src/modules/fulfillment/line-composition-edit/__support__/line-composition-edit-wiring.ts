import { DbService } from '@app/db';
import { wmsSchema } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { SalesOrderAmendmentsService } from '../../../sales-order/services/sales-order-amendments.service';
import { DraftBoxAmender } from '../../draft-box/draft-box-amender';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { Wired } from '../../services/__support__';
import { LineCompositionEditManager } from '../line-composition-edit.manager';
import { LineCompositionEditReader } from '../line-composition-edit.reader';
import { LineCompositionEditService } from '../line-composition-edit.service';

export function wireLineCompositionEdit(dbService: DbService<typeof wmsSchema>, logistics: Wired) {
  const invariant = new FulfillmentInvariantService();
  const amender = new DraftBoxAmender(
    dbService,
    logistics.shipmentReservations,
    invariant,
    new AuditService(dbService),
  );
  const reader = new LineCompositionEditReader(dbService, logistics.productSkuMapping);
  const manager = new LineCompositionEditManager(
    dbService,
    reader,
    logistics.lineCompositionManager,
    amender,
    logistics.backlog,
    new SalesOrderAmendmentsService(dbService),
    invariant,
  );
  const service = new LineCompositionEditService(reader, manager);
  return { amender, reader, manager, service };
}
