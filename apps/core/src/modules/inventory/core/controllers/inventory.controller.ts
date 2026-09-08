import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { StockEventService } from '../services/stock-event.service';
import { InventoryCommandService } from '../services/inventory-command.service';
import { AdjustStockDto } from '../dto/inventory/adjust-stock.dto';
import { CreateStockEntryBySkuIdDto } from '../../inbound/dto/create-stock-entry-by-skuid.dto';

@ApiTags('Inventory')
@Controller('inventory')
@UseGuards(ScopeGuard)
export class InventoryController {
  constructor(
    private readonly stockEventService: StockEventService,
    private readonly commandService: InventoryCommandService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // 재고 변경 API (mutation)
  // ═══════════════════════════════════════════════════════════════

  @Post('/stocks/adjust')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({ summary: '재고 수량 조정 (관리자 수동 조정)' })
  @ApiResponse({ status: 200, description: '재고 수량이 성공적으로 조정되었습니다.' })
  @ApiResponse({ status: 400, description: '잘못된 요청 또는 유효성 검사 실패.' })
  @ApiResponse({ status: 404, description: '활성 재고 항목을 찾을 수 없음.' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async adjustStockQuantity(@Body() adjustDto: AdjustStockDto) {
    if (adjustDto.delta > 0) {
      return this.commandService.adjustUp({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
        idempotencyKey: adjustDto.idempotencyKey,
      });
    } else if (adjustDto.delta < 0) {
      return this.commandService.adjustDown({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
        idempotencyKey: adjustDto.idempotencyKey,
      });
    } else {
      throw new BadRequestException('delta cannot be zero');
    }
  }

  @Post('/stocks/entry-safe')
  @RequireScopes(INVENTORY_SCOPE.ADJUST)
  @ApiOperation({
    summary: '안전한 재고 입고 (SKU ID 기반)',
    description: '기존 SKU ID로만 재고를 입고합니다. 자동 SKU 생성을 하지 않아 데이터 무결성을 보장합니다.',
  })
  @ApiResponse({ status: 201, description: '재고 입고가 성공적으로 처리되었습니다.' })
  @ApiResponse({ status: 400, description: 'SKU를 찾을 수 없거나 잘못된 요청입니다.' })
  @ApiResponse({ status: 403, description: '재고 원장 조정 권한이 없습니다.' })
  async createStockEntryBySkuId(@Body() dto: CreateStockEntryBySkuIdDto) {
    return this.stockEventService.createStockEntryBySkuId(dto);
  }
}
