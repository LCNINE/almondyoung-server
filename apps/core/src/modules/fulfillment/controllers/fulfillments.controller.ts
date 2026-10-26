import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, RequirePermission, PiiResponse, OPEN_WITH_RECIPIENT } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { FulfillmentsService } from '../services/fulfillments.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import {
  FulfillmentOrderListResponseDto,
  FulfillmentOrderResponseDto,
  FulfillmentOrderV2ResponseDto,
} from '../dto/fulfillment-order-response.dto';
import { ShipmentSummaryResponseDto } from '../dto/shipment-planning.dto';

@ApiTags('Fulfillments')
@ApiExtraModels(FulfillmentOrderResponseDto, FulfillmentOrderV2ResponseDto)
@Controller('fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly shipmentPlanning: ShipmentPlanningService,
  ) {}

  @PiiResponse({
    fields: {
      'shippingAddress.recipientName': 'name',
      'shippingAddress.phone': 'phone',
      'shippingAddress.postalCode': 'postal',
      'shippingAddress.roadAddress': 'address',
      'shippingAddress.detailAddress': 'text',
      'shippingAddress.deliveryNote': 'text',
      'shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'id', type: 'fulfillment_order' },
    ],
    rawWithByField: {
      'shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      'shippingAddress.phone': OPEN_WITH_RECIPIENT,
      'shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      'shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      'shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      'shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      'shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.write')
  @Post()
  @ApiOperation({ summary: '주문처리 생성' })
  @ApiResponse({ status: 201, description: '주문처리 생성 성공' })
  create(@Body() dto: CreateFulfillmentOrderDto) {
    return this.service.create(dto);
  }

  @RequirePermission('fulfillment.order.read')
  @Get(':id/outbox-events')
  @ApiOperation({ summary: '주문처리 outbox 이벤트 조회' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  getOutboxEvents(@Param('id') id: string) {
    return this.service.getOutboxEvents(id);
  }

  @PiiResponse({
    fields: {
      'shippingAddress.recipientName': 'name',
      'shippingAddress.phone': 'phone',
      'shippingAddress.postalCode': 'postal',
      'shippingAddress.roadAddress': 'address',
      'shippingAddress.detailAddress': 'text',
      'shippingAddress.deliveryNote': 'text',
      'shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'id', type: 'fulfillment_order' },
    ],
    reveal: true,
    rawWithByField: {
      'shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      'shippingAddress.phone': OPEN_WITH_RECIPIENT,
      'shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      'shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      'shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      'shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      'shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get(':id')
  @ApiOperation({
    summary: '주문처리 상세 조회 (progress, shipments, items, reservations 포함)',
  })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, type: FulfillmentOrderV2ResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get(':id/shipments')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: 'V2 shipment 목록과 라인 진행 수량 조회' })
  @ApiResponse({ status: 200, type: [ShipmentSummaryResponseDto] })
  shipments(@Param('id') id: string): Promise<ShipmentSummaryResponseDto[]> {
    return this.shipmentPlanning.getFulfillmentShipments(id);
  }

  @PiiResponse({
    fields: {
      'data[].shippingAddress.recipientName': 'name',
      'data[].shippingAddress.phone': 'phone',
      'data[].shippingAddress.postalCode': 'postal',
      'data[].shippingAddress.roadAddress': 'address',
      'data[].shippingAddress.detailAddress': 'text',
      'data[].shippingAddress.deliveryNote': 'text',
      'data[].shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'data[].id', type: 'fulfillment_order' },
    ],
    rawWithByField: {
      'data[].shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.phone': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      'data[].shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get()
  @ApiOperation({ summary: '주문처리 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: String })
  @ApiQuery({ name: 'offset', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'FO 상태 필터 (단일)' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @ApiQuery({ name: 'fulfillmentMode', required: false, enum: ['in_house', '3pl'] })
  @ApiQuery({ name: 'salesOrderId', required: false, type: String })
  @ApiQuery({ name: 'priority', required: false, enum: ['normal', 'high', 'urgent'] })
  @ApiResponse({ status: 200, type: FulfillmentOrderListResponseDto })
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('fulfillmentMode') fulfillmentMode?: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('priority') priority?: string,
  ) {
    return this.service.list({
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
      status: status || undefined,
      warehouseId: warehouseId || undefined,
      fulfillmentMode: fulfillmentMode || undefined,
      salesOrderId: salesOrderId || undefined,
      priority: priority || undefined,
    });
  }

}
