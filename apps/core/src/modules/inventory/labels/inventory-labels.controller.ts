import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { LabelBatchDto, LocationLabelsRequestDto, SkuLabelsRequestDto } from './inventory-labels.dto';
import { InventoryLabelsService } from './inventory-labels.service';

@ApiTags('Inventory')
@Controller('inventory/labels')
export class InventoryLabelsController {
  constructor(private readonly service: InventoryLabelsService) {}

  @RequirePermission('inventory.stock.read')
  @Post('locations')
  @HttpCode(200)
  @ApiOperation({ summary: '로케이션 라벨 ZPL — 랙 전체 또는 고른 로케이션' })
  @ApiResponse({ status: 200, type: LabelBatchDto })
  locations(@Body() dto: LocationLabelsRequestDto): Promise<LabelBatchDto> {
    return this.service.locationLabels(dto);
  }

  @RequirePermission('inventory.stock.read')
  @Post('skus')
  @HttpCode(200)
  @ApiOperation({ summary: 'SKU 라벨 ZPL — 대표 바코드, 장수 지정' })
  @ApiResponse({ status: 200, type: LabelBatchDto })
  skus(@Body() dto: SkuLabelsRequestDto): Promise<LabelBatchDto> {
    return this.service.skuLabels(dto);
  }
}
