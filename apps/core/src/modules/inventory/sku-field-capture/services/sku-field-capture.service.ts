import { Injectable } from '@nestjs/common';
import { SkuFieldCaptureManager } from './sku-field-capture.manager';
import { SkuFieldCaptureReader } from './sku-field-capture.reader';
import type { CompleteFieldCaptureInput } from './sku-field-capture.manager';
import type { FieldCaptureActor } from '../sku-field-capture.rules';
import type {
  BarcodeOwnerDto,
  FieldCaptureDetailDto,
  FieldCaptureProgressDto,
  ShelfPositionDto,
} from '../dto/sku-field-capture.dto';

@Injectable()
export class SkuFieldCaptureService {
  constructor(
    private readonly reader: SkuFieldCaptureReader,
    private readonly manager: SkuFieldCaptureManager,
  ) {}

  findByPosition(positionCode: string): Promise<ShelfPositionDto> {
    return this.reader.findByPosition(positionCode);
  }

  getDetail(skuId: string): Promise<FieldCaptureDetailDto> {
    return this.reader.getDetail(skuId);
  }

  async findBarcodeOwner(barcode: string): Promise<{ owner: BarcodeOwnerDto | null }> {
    return { owner: await this.reader.findBarcodeOwner(barcode) };
  }

  getProgress(): Promise<FieldCaptureProgressDto> {
    return this.reader.getProgress();
  }

  async attachPhoto(skuId: string, fileId: string, actor: FieldCaptureActor): Promise<FieldCaptureDetailDto> {
    await this.manager.attachPhoto(skuId, fileId, actor);
    return this.reader.getDetail(skuId);
  }

  async removePhoto(skuId: string, photoId: string): Promise<FieldCaptureDetailDto> {
    await this.manager.removePhoto(skuId, photoId);
    return this.reader.getDetail(skuId);
  }

  async complete(
    skuId: string,
    input: CompleteFieldCaptureInput,
    actor: FieldCaptureActor,
  ): Promise<FieldCaptureDetailDto> {
    await this.manager.complete(skuId, input, actor);
    return this.reader.getDetail(skuId);
  }
}
