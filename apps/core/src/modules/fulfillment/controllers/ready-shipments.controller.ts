import { BadRequestException, Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { RequirePermission } from '@app/authorization';
import { ReadyShipmentsDto } from '../dto/ready-shipments.dto';
import { ReadyShipmentsReader } from '../reader/ready-shipments.reader';

@ApiTags('Outbound')
@Controller()
export class ReadyShipmentsController {
  constructor(private readonly readyShipments: ReadyShipmentsReader) {}

  @RequirePermission('fulfillment.shipment.read')
  @Get('ready-shipments')
  @ApiOperation({ summary: '이번 입고로 다 갖춰진 상자 — 바로 출력 가능한지, 적치가 먼저인지' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({ name: 'receiptLineIds', required: true, description: '입고 줄 UUID 목록 (쉼표 구분, 최대 100개)' })
  @ApiOkResponse({ type: ReadyShipmentsDto })
  async list(
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('receiptLineIds') receiptLineIds?: string,
  ): Promise<ReadyShipmentsDto> {
    const ids = typeof receiptLineIds === 'string' ? receiptLineIds.split(',') : [];
    if (ids.length < 1 || ids.length > 100 || ids.some((id) => !isUUID(id))) {
      throw new BadRequestException('receiptLineIds must contain between 1 and 100 UUIDs');
    }
    return this.readyShipments.forReceiptLines(
      warehouseId,
      ids.map((id) => id.toLowerCase()),
    );
  }
}
