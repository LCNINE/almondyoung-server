import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillLabelManager, type WaybillLabel } from './waybill-label.manager';
import { WaybillLabelStateReader } from './waybill-label-state.reader';
import { WaybillLabelPrintManager, type LabelPrintConfirmation } from './waybill-label-print.manager';

@Injectable()
export class WaybillLabelService {
  constructor(
    private readonly labels: WaybillLabelManager,
    private readonly printManager: WaybillLabelPrintManager,
    private readonly states: WaybillLabelStateReader,
  ) {}

  renderLabel(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    return this.labels.render(shipmentId, tx);
  }

  statesForBatch(batchId: string, tx?: DbTx) {
    return this.states.forBatch(batchId, tx);
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
