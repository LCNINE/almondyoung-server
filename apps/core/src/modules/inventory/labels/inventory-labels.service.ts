import { Injectable } from '@nestjs/common';
import type { LabelBatch } from './inventory-labels.batch';
import type { LocationLabelsRequestDto, SkuLabelsRequestDto } from './inventory-labels.dto';
import { InventoryLabelsManager } from './inventory-labels.manager';

@Injectable()
export class InventoryLabelsService {
  constructor(private readonly manager: InventoryLabelsManager) {}

  locationLabels(dto: LocationLabelsRequestDto): Promise<LabelBatch> {
    return this.manager.locationLabels(dto);
  }

  skuLabels(dto: SkuLabelsRequestDto): Promise<LabelBatch> {
    return this.manager.skuLabels(dto);
  }
}
