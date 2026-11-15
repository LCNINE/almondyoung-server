import { Injectable } from '@nestjs/common';
import { DbTx, InboundShipment } from '../../schema/inventory.schema';
import {
  InboundShipmentDraftManager,
  CreateDraftInput,
  LinePatch,
  BoxPatch,
  HeaderPatch,
} from './inbound-shipment-draft.manager';
import { InboundShipmentReader } from './inbound-shipment.reader';
import { InboundShipmentReceivingManager } from './inbound-shipment-receiving.manager';
import { ReceiveBoxDto } from '../dto/receive.dto';

/** 선적 입고 포트 — 위임만 한다. */
@Injectable()
export class InboundShipmentService {
  constructor(
    private readonly drafts: InboundShipmentDraftManager,
    private readonly reader: InboundShipmentReader,
    private readonly receiving: InboundShipmentReceivingManager,
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

  editLine(
    id: string,
    lineId: string,
    patch: LinePatch,
    extra: { expectedQty?: number; boxLabels?: string[] },
    actorId: string,
    tx?: DbTx,
  ) {
    return this.drafts.editLine(id, lineId, patch, extra, actorId, tx);
  }

  editBox(id: string, boxId: string, patch: BoxPatch, actorId: string, tx?: DbTx) {
    return this.drafts.editBox(id, boxId, patch, actorId, tx);
  }

  setAiCandidates(id: string, lineId: string, candidates: { skuId: string; reason: string }[], tx?: DbTx) {
    return this.drafts.setAiCandidates(id, lineId, candidates, tx);
  }

  confirm(id: string, actorId: string, tx?: DbTx) {
    return this.drafts.confirm(id, actorId, tx);
  }

  cancel(id: string, actorId: string, tx?: DbTx) {
    return this.drafts.cancel(id, actorId, tx);
  }

  updateHeader(id: string, patch: HeaderPatch, tx?: DbTx) {
    return this.drafts.updateHeader(id, patch, tx);
  }

  findBoxes(warehouseId: string, label: string, tx?: DbTx) {
    return this.reader.findBoxes(warehouseId, label, tx);
  }

  openBox(id: string, boxId: string, tx?: DbTx) {
    return this.reader.openBox(id, boxId, tx);
  }

  receiveBox(id: string, boxId: string, dto: ReceiveBoxDto, actorId: string, tx?: DbTx) {
    return this.receiving.receiveBox(id, boxId, dto, actorId, tx);
  }

  addBox(id: string, label: string, actorId: string, tx?: DbTx) {
    return this.receiving.addBox(id, label, actorId, tx);
  }
}
