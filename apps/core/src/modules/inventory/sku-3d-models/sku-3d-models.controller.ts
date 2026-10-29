import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { Sku3dModelsManager } from './sku-3d-models.manager';
import { BatchReviewSku3dModelsDto, RegisterSku3dModelDto, ReviewSku3dModelDto } from './sku-3d-models.dto';

@ApiTags('Inventory')
@Controller('inventory/sku-3d-models')
export class Sku3dModelsController {
  constructor(private readonly manager: Sku3dModelsManager) {}

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
    @User() user: { id: string },
  ) {
    return this.manager.register(skuId, dto, user.id);
  }

  @Put('batch-review')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 일괄 검수' })
  reviewBatch(@Body() dto: BatchReviewSku3dModelsDto, @User() user: { id: string }) {
    return this.manager.reviewBatch(dto.ids, dto, user.id);
  }

  @Put(':id/review')
  @RequirePermission('inventory.master.write')
  @ApiOperation({ summary: 'SKU 3D 모델 검수 상태 변경' })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewSku3dModelDto, @User() user: { id: string }) {
    return this.manager.review(id, dto, user.id);
  }
}
