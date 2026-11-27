import { Injectable } from '@nestjs/common';
import type { Sku3dDimensionBasis } from '../schema/inventory.schema';
import { Sku3dWorkshopManager } from './sku-3d-workshop.manager';
import { Sku3dWorkshopPublisher } from './sku-3d-workshop.publisher';
import { Sku3dWorkshopReader } from './sku-3d-workshop.reader';
import type { WorkshopActor } from './workshop-access';

@Injectable()
export class Sku3dWorkshopService {
  constructor(
    private readonly reader: Sku3dWorkshopReader,
    private readonly manager: Sku3dWorkshopManager,
    private readonly publisher: Sku3dWorkshopPublisher,
  ) {}

  open(skuId: string, actor: WorkshopActor) {
    return this.manager.open(skuId, actor);
  }

  mine(actor: WorkshopActor) {
    return this.reader.mine(actor);
  }

  detail(workshopId: string, actor: WorkshopActor) {
    return this.reader.detail(workshopId, actor);
  }

  events(workshopId: string, actor: WorkshopActor, afterSeq: number) {
    return this.reader.events(workshopId, actor, afterSeq);
  }

  confirmDimensions(workshopId: string, actor: WorkshopActor, basis: Sku3dDimensionBasis) {
    return this.manager.confirmDimensions(workshopId, actor, basis);
  }

  postMessage(workshopId: string, actor: WorkshopActor, body: string) {
    return this.manager.postMessage(workshopId, actor, body);
  }

  revisionFile(workshopId: string, revisionId: string, kind: string, actor: WorkshopActor) {
    return this.reader.revisionFile(workshopId, revisionId, kind, actor);
  }

  approve(workshopId: string, revisionId: string, glbSha256: string, actor: WorkshopActor) {
    return this.publisher.approve(workshopId, revisionId, glbSha256, actor);
  }
}
