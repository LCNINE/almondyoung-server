import { Injectable } from '@nestjs/common';
import { SkuFieldCaptureManager } from './sku-field-capture.manager';
import { SkuFieldCaptureReader } from './sku-field-capture.reader';
import type { CompleteFieldCaptureInput } from './sku-field-capture.manager';
import type { FieldCaptureActor, FieldCaptureListFilter, FieldCapturePhotoFilter } from '../sku-field-capture.rules';
import type {
  BarcodeOwnerDto,
  FieldCaptureDetailDto,
  FieldCapturePhotosDto,
  FieldCaptureProgressDto,
  MyTodayDto,
  MyCaptureItemsDto,
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

  listPhotos(filter: FieldCapturePhotoFilter): Promise<FieldCapturePhotosDto> {
    return this.reader.listPhotos(filter);
  }

  async getMyToday(actor: FieldCaptureActor): Promise<MyTodayDto> {
    return { today: await this.reader.countWorkerToday(actor.workerId) };
  }

  async listItems(filter: FieldCaptureListFilter, actor: FieldCaptureActor): Promise<MyCaptureItemsDto> {
    return { items: await this.reader.listItems(filter, actor.workerId) };
  }

  cancel(skuId: string, actor: FieldCaptureActor): Promise<void> {
    return this.manager.cancel(skuId, actor);
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
