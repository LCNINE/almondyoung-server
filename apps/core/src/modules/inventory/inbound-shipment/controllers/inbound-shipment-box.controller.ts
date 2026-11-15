import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import { InboundShipmentService } from '../services/inbound-shipment.service';
import { BoxCandidateViewDto } from '../dto/receive.dto';

/** 앱이 상자 이름으로 상자를 찾는다 — 열린 선적 전부에서, 후보가 여럿일 수 있다 (spec §8.1). */
@ApiTags('Inbound Shipments')
@Controller('inventory/inbound-shipment-boxes')
export class InboundShipmentBoxController {
  constructor(private readonly service: InboundShipmentService) {}

  @RequirePermission('inventory.stock.read')
  @Get()
  @ApiOperation({ summary: '상자 찾기 — 그 창고의 도착 예정·입고 중 선적에서 이름이 같은 상자' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({ name: 'label', required: true, description: '상자 이름 하나(`L5`). 범위 표기는 400' })
  @ApiResponse({ status: 200, type: [BoxCandidateViewDto] })
  find(
    @Query('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Query('label') label?: string,
  ): Promise<BoxCandidateViewDto[]> {
    if (!label || !label.trim()) throw new BadRequestError('label is required');
    return this.service.findBoxes(warehouseId, label);
  }
}
