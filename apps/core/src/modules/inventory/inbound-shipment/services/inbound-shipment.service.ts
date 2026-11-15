import { Injectable } from '@nestjs/common';
import { DbTx, InboundShipment } from '../../schema/inventory.schema';
import { InboundShipmentDraftManager, CreateDraftInput } from './inbound-shipment-draft.manager';
import { InboundShipmentReader } from './inbound-shipment.reader';

/** 선적 입고 포트 — 위임만 한다. */
@Injectable()
export class InboundShipmentService {
  constructor(
    private readonly drafts: InboundShipmentDraftManager,
    private readonly reader: InboundShipmentReader,
  ) {}

  createDraft(input: CreateDraftInput, actorId: string, tx?: DbTx) {
    return this.drafts.createDraft(input, actorId, tx);
  }

  list(q: { warehouseId?: string; status?: InboundShipment['status'][] }, tx?: DbTx) {
    return this.reader.list(q, tx);
  }

  detail(id: string, tx?: DbTx) {
    return this.reader.detail(id, tx);
  }
}
