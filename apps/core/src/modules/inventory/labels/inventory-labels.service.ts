import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { SvgRasterizer } from '../../../platform/label/svg-rasterizer';
import { buildLabelBatch, type LabelBatch, type LabelCandidate } from './inventory-labels.batch';
import type { LocationLabelsRequestDto, SkuLabelsRequestDto } from './inventory-labels.dto';
import { InventoryLabelsReader } from './inventory-labels.reader';
import { renderLocationLabel, renderSkuLabel } from './label-templates';

@Injectable()
export class InventoryLabelsService {
  constructor(
    private readonly reader: InventoryLabelsReader,
    private readonly rasterizer: SvgRasterizer,
  ) {}

  async locationLabels(dto: LocationLabelsRequestDto): Promise<LabelBatch> {
    const { rackId } = dto;
    const locationIds = dto.locationIds ? [...new Set(dto.locationIds)] : undefined;
    if (!rackId === !locationIds) {
      throw new BadRequestError('rackId 와 locationIds 중 하나만 보내야 합니다.');
    }
    const found = await this.reader.locationsForLabels(rackId ? { rackId } : { locationIds: locationIds ?? [] });
    const candidates: LabelCandidate[] = found.map((l) => ({
      ref: l.id,
      code: l.code,
      copies: 1,
      render: () => renderLocationLabel(l.code),
    }));
    if (locationIds) {
      const have = new Set(found.map((l) => l.id));
      for (const id of locationIds) {
        if (!have.has(id))
          candidates.push({ ref: id, code: null, copies: 1, render: () => ({ ok: false, reason: 'NOT_FOUND' }) });
      }
    }
    return buildLabelBatch(candidates, this.rasterizer);
  }

  async skuLabels(dto: SkuLabelsRequestDto): Promise<LabelBatch> {
    const found = await this.reader.skusForLabels([...new Set(dto.items.map((i) => i.skuId))]);
    const byId = new Map(found.map((s) => [s.id, s]));
    const candidates: LabelCandidate[] = dto.items.map(({ skuId, copies }) => {
      const sku = byId.get(skuId);
      if (!sku) return { ref: skuId, code: null, copies, render: () => ({ ok: false, reason: 'NOT_FOUND' }) };
      const { barcode } = sku;
      return {
        ref: skuId,
        code: sku.code,
        copies,
        render: () =>
          barcode === null
            ? { ok: false, reason: 'NO_BARCODE' }
            : renderSkuLabel(dto.size, { name: sku.name, barcode }),
      };
    });
    return buildLabelBatch(candidates, this.rasterizer);
  }
}
