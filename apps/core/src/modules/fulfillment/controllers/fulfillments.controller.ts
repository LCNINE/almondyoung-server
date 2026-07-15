import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  Headers,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { FulfillmentsService } from '../services/fulfillments.service';
import { FulfillmentReservationsFacade } from '../services/fulfillment-reservations.facade';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { TransferReservationDto } from '../dto/transfer-reservation.dto';
import {
  FulfillmentOrderListResponseDto,
  FulfillmentOrderResponseDto,
  FulfillmentOrderV2ResponseDto,
} from '../dto/fulfillment-order-response.dto';
import { ShipmentSummaryResponseDto } from '../dto/shipment-planning.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Fulfillments')
@ApiExtraModels(FulfillmentOrderResponseDto, FulfillmentOrderV2ResponseDto)
@Controller('fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly reservations: FulfillmentReservationsFacade,
    private readonly shipmentPlanning: ShipmentPlanningService,
  ) {}

  @Post()
  @ApiOperation({ summary: '주문처리 생성' })
  @ApiResponse({ status: 201, description: '주문처리 생성 성공' })
  create(@Body() dto: CreateFulfillmentOrderDto) {
    return this.service.create(dto);
  }

  @Post(':id/deliver')
  @ApiOperation({ summary: '배송 완료 처리 (고객 수령 확인, FulfillmentDelivered 이벤트 발행)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  deliver(@Param('id') id: string) {
    return this.service.markDelivered(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '주문처리 취소' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id/outbox-events')
  @ApiOperation({ summary: '주문처리 outbox 이벤트 조회' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  getOutboxEvents(@Param('id') id: string) {
    return this.service.getOutboxEvents(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: '주문처리 상세 조회 (progress, shipments, items, reservations, adminAvailableActions 포함)',
  })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, type: FulfillmentOrderV2ResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get(':id/shipments')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: 'V2 shipment 목록과 라인 진행 수량 조회' })
  @ApiResponse({ status: 200, type: [ShipmentSummaryResponseDto] })
  shipments(@Param('id') id: string): Promise<ShipmentSummaryResponseDto[]> {
    return this.shipmentPlanning.getFulfillmentShipments(id);
  }

  @Get()
  @ApiOperation({ summary: '주문처리 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: String })
  @ApiQuery({ name: 'offset', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'FO 상태 필터 (단일)' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @ApiQuery({ name: 'fulfillmentMode', required: false, enum: ['in_house', '3pl', 'drop_ship'] })
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

  @Post(':id/transfer-reservation')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.RESERVATION_TRANSFER)
  @ApiOperation({ summary: '예약 이전 (같은 창고·같은 SKU FOI 간, cross-FO 허용, 작업 전 상태만)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: TransferReservationDto })
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferReservationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    const performedBy = this.getUserId(user);
    if (!performedBy) throw new UnauthorizedException('Authenticated actor is required');
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key is required for reservation transfer',
      });
    }
    return this.reservations.transferReservationCommand(id, { ...dto, performedBy }, idempotencyKey);
  }

  @Get(':id/transfer-candidates')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.RESERVATION_TRANSFER)
  @ApiOperation({ summary: '예약 이전 대상 후보 조회 (같은 창고·같은 SKU, 작업 전 상태, 미예약 부족분 있는 FOI)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiQuery({ name: 'fromFulfillmentOrderItemId', required: true, type: String })
  getTransferCandidates(
    @Param('id') id: string,
    @Query('fromFulfillmentOrderItemId') fromFulfillmentOrderItemId?: string,
  ) {
    if (!fromFulfillmentOrderItemId) {
      throw new BadRequestException('fromFulfillmentOrderItemId is required');
    }
    return this.reservations.getTransferCandidates(id, fromFulfillmentOrderItemId);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
