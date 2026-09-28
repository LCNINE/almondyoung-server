import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillLabelManager, type WaybillLabel } from './waybill-label.manager';

@Injectable()
export class WaybillLabelService {
  constructor(private readonly labels: WaybillLabelManager) {}

  renderLabel(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    return this.labels.render(shipmentId, tx);
  }
}
