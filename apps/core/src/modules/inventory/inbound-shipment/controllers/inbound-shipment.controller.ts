import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import { BadRequestError } from '@app/shared';
import { WarehouseActor, authenticatedWarehouseActor } from '../../core/services/warehouse-operation-contract';
import { InboundShipmentService } from '../services/inbound-shipment.service';
import { UploadInboundShipmentDto } from '../dto/upload.dto';
import {
  INBOUND_SHIPMENT_STATUSES,
  InboundShipmentDetailViewDto,
  InboundShipmentStatusValue,
  InboundShipmentSummaryDto,
} from '../dto/inbound-shipment-view.dto';

@ApiTags('Inbound Shipments')
@Controller('inventory/inbound-shipments')
export class InboundShipmentController {
  constructor(private readonly service: InboundShipmentService) {}

  @RequirePermission('inventory.inbound_shipment.write')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '입고리스트를 올려 선적 초안 만들기' })
  @ApiResponse({ status: 201, description: '{ shipmentId }' })
  upload(@Body() dto: UploadInboundShipmentDto, @User() user: WarehouseActor): Promise<{ shipmentId: string }> {
    const actorId = authenticatedWarehouseActor(user);
    return this.service.createDraft(
      {
        warehouseId: dto.warehouseId,
        name: dto.name,
        expectedArrival: dto.expectedArrival ?? null,
        sourceFileId: dto.sourceFileId ?? null,
        sourceFileName: dto.sourceFileName,
        list: { header: dto.header, rows: dto.rows },
      },
      actorId,
    );
  }

  @RequirePermission('inventory.stock.read')
  @Get()
  @ApiOperation({ summary: '선적 목록' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'status', required: false, description: '쉼표로 여러 개' })
  @ApiResponse({ status: 200, type: [InboundShipmentSummaryDto] })
  list(
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ): Promise<InboundShipmentSummaryDto[]> {
    const statuses = status ? status.split(',').filter(Boolean) : undefined;
    const valid = new Set<string>(INBOUND_SHIPMENT_STATUSES);
    if (statuses?.some((s) => !valid.has(s))) throw new BadRequestError('status 값이 올바르지 않습니다.');
    return this.service.list({ warehouseId, status: statuses as InboundShipmentStatusValue[] | undefined });
  }

  @RequirePermission('inventory.stock.read')
  @Get(':id')
  @ApiOperation({ summary: '선적 상세' })
  @ApiResponse({ status: 200, type: InboundShipmentDetailViewDto })
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<InboundShipmentDetailViewDto> {
    return this.service.detail(id);
  }
}
