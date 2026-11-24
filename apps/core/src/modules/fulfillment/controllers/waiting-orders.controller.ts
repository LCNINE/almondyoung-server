import { BadRequestException, Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { RequirePermission } from '@app/authorization';
import { WaitingOrdersDto } from '../dto/waiting-orders.dto';
import { WaitingOrdersReader } from '../reader/waiting-orders.reader';

@ApiTags('Outbound')
@Controller()
export class WaitingOrdersController {
  constructor(private readonly waitingOrders: WaitingOrdersReader) {}

  @RequirePermission('inventory.stock.read')
  @Get('waiting-orders')
  @ApiOperation({ summary: '상품별 기다리는 주문 — 지금 집을 수 있는 재고로 나가지 못하는 주문 수와 수량' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({ name: 'skuIds', required: true, description: 'SKU UUID 목록 (쉼표 구분, 최대 100개)' })
  @ApiOkResponse({ type: WaitingOrdersDto })
  async list(
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('skuIds') skuIds?: string,
  ): Promise<WaitingOrdersDto> {
    const ids = typeof skuIds === 'string' ? skuIds.split(',') : [];
    if (ids.length < 1 || ids.length > 100 || ids.some((id) => !isUUID(id))) {
      throw new BadRequestException('skuIds must contain between 1 and 100 UUIDs');
    }
    return {
      items: await this.waitingOrders.forSkus(
        warehouseId,
        ids.map((id) => id.toLowerCase()),
      ),
    };
  }
}
