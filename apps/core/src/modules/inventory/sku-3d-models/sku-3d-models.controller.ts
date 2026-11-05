import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { authenticatedWarehouseActor, WarehouseActor } from '../core/services/warehouse-operation-contract';
import { fieldCaptureActorOf } from '../sku-field-capture/sku-field-capture.rules';
import { Sku3dModelsManager } from './sku-3d-models.manager';
import { Sku3dModelsReader } from './sku-3d-models.reader';
import {
  BatchReviewSku3dModelsDto,
  ListSku3dModelUploadsQueryDto,
  RegisterSku3dModelDto,
  ReviewSku3dModelDto,
} from './sku-3d-models.dto';

@ApiTags('Inventory')
@Controller('inventory/sku-3d-models')
export class Sku3dModelsController {
  constructor(
    private readonly manager: Sku3dModelsManager,
    private readonly reader: Sku3dModelsReader,
  ) {}

  @Get()
  @RequirePermission('inventory.master.read')
  @ApiOperation({ summary: 'SKU 3D 모델 업로드 현황' })
  listUploads(@Query() query: ListSku3dModelUploadsQueryDto) {
    return this.reader.listUploads({
      q: query.q?.trim() || undefined,
      uploader: query.uploader?.trim() || undefined,
      visibility: query.visibility,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  @Get('skus/:skuId')
  @RequirePermission('inventory.master.read')
  @ApiOperation({ summary: 'SKU 3D 모델 버전 이력' })
  list(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.manager.list(skuId);
  }

  @Post('skus/:skuId')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 새 버전 등록' })
  register(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: RegisterSku3dModelDto,
    @User() user: NonNullable<WarehouseActor>,
  ) {
    const actor = fieldCaptureActorOf(user);

    return this.manager.register(skuId, dto, actor.workerId, actor.workerLabel);
  }

  @Put(':id/publish')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 공개 — 같은 SKU 의 다른 공개 버전은 비공개로' })
  publish(@Param('id', ParseUUIDPipe) id: string, @User() user: WarehouseActor) {
    return this.manager.publish(id, authenticatedWarehouseActor(user));
  }

  @Put('skus/:skuId/unpublish')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 전부 비공개' })
  unpublish(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.manager.unpublish(skuId);
  }

  @Put('batch-review')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 일괄 검수' })
  reviewBatch(@Body() dto: BatchReviewSku3dModelsDto, @User() user: WarehouseActor) {
    return this.manager.reviewBatch(dto.ids, dto, authenticatedWarehouseActor(user));
  }

  @Put(':id/review')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 검수 상태 변경' })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewSku3dModelDto, @User() user: WarehouseActor) {
    return this.manager.review(id, dto, authenticatedWarehouseActor(user));
  }
}
