import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StockEventService } from '../services/stock-event.service';
import { SafetyStockService } from '../services/safety-stock.service';
import { InventoryCommandService } from '../services/inventory-command.service';
import { AdjustStockDto } from '../dto/inventory/adjust-stock.dto';
import { CreateStockEntryBySkuIdDto } from '../../inbound/dto/create-stock-entry-by-skuid.dto';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly stockEventService: StockEventService,
    private readonly safetyStockService: SafetyStockService,
    private readonly commandService: InventoryCommandService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 재고 변경 API (mutation)
  // ═══════════════════════════════════════════════════════════════

  @Post('/stocks/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '재고 수량 조정 (관리자 수동 조정)' })
  @ApiResponse({ status: 200, description: '재고 수량이 성공적으로 조정되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '활성 재고 항목을 찾을 수 없음.' })
  async adjustStockQuantity(@Body() adjustDto: AdjustStockDto) {
    if (adjustDto.delta > 0) {
      return this.commandService.adjustUp({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
      });
    } else if (adjustDto.delta < 0) {
      return this.commandService.adjustDown({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
      });
    } else {
      throw new BadRequestException('delta cannot be zero');
    }
  }

  @Post('/stocks/entry-safe')
  @ApiOperation({
    summary: '안전한 재고 입고 (SKU ID 기반)',
    description: '기존 SKU ID로만 재고를 입고합니다. 자동 SKU 생성을 하지 않아 데이터 무결성을 보장합니다.',
  })
  @ApiResponse({ status: 201, description: '재고 입고가 성공적으로 처리되었습니다.' })
  @ApiResponse({ status: 400, description: 'SKU를 찾을 수 없거나 잘못된 요청입니다.' })
  async createStockEntryBySkuId(@Body() dto: CreateStockEntryBySkuIdDto) {
    return this.stockEventService.createStockEntryBySkuId(dto);
  }

  // ═══════════════════════════════════════════════════════════════
  // 안전 재고 관리 API
  // ═══════════════════════════════════════════════════════════════

  @Get('/safety-stock-warnings')
  @ApiOperation({ summary: '안전 재고 미만 상품 조회 (Get items below safety stock)' })
  @ApiQuery({ name: 'warehouseId', required: false, description: '창고 ID로 필터링' })
  @ApiResponse({
    status: 200,
    description: 'List of SKUs below safety stock',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skuId: { type: 'string', description: 'SKU ID' },
          skuName: { type: 'string', description: 'SKU 이름' },
          skuCode: { type: 'string', description: 'SKU 코드' },
          currentStock: { type: 'number', description: '현재 재고' },
          safetyStock: { type: 'number', description: '안전 재고' },
          shortfall: { type: 'number', description: '부족량' },
          warehouseId: { type: 'string', description: '창고 ID' },
        },
      },
    },
  })
  async getSafetyStockWarnings(@Query('warehouseId') warehouseId?: string) {
    return this.safetyStockService.getBelowSafetyStock(warehouseId);
  }

  @Get('/safety-stock-status/:skuId')
  @ApiOperation({ summary: 'SKU의 안전 재고 상태 조회 (전체 창고)' })
  @ApiParam({ name: 'skuId', description: 'SKU ID' })
  @ApiResponse({
    status: 200,
    description: 'Safety stock status for SKU across all warehouses',
  })
  @ApiResponse({ status: 404, description: 'SKU not found' })
  async getSafetyStockStatus(@Param('skuId') skuId: string) {
    const status = await this.safetyStockService.getSafetyStockStatus(skuId);
    if (!status) {
      throw new Error(`SKU with ID ${skuId} not found`);
    }
    return status;
  }
}
