import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillLabelManager, type WaybillLabel } from './waybill-label.manager';
import { WaybillLabelPrintManager, type LabelPrintConfirmation } from './waybill-label-print.manager';

@Injectable()
export class WaybillLabelService {
  constructor(
    private readonly labels: WaybillLabelManager,
    private readonly printManager: WaybillLabelPrintManager,
  ) {}

  renderLabel(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    return this.labels.render(shipmentId, tx);
  }

  confirmPrint(
    shipmentId: string,
    fingerprint: string,
    actor: { id: string },
    tx?: DbTx,
  ): Promise<LabelPrintConfirmation> {
    return this.printManager.confirm(shipmentId, fingerprint, actor, tx);
  }
}
