import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { FulfillmentsService } from '../services/fulfillments.service';
import { FulfillmentReservationsFacade } from '../services/fulfillment-reservations.facade';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { CreateCompensationShipmentDto } from '../dto/create-compensation-shipment.dto';
import { SplitFulfillmentOrderDto } from '../dto/split-fulfillment-order.dto';
import { AssignShipmentDto } from '../dto/assign-shipment.dto';
import { ReserveDto } from '../dto/reserve.dto';
import { UnreserveDto } from '../dto/unreserve.dto';
import { TransferReservationDto } from '../dto/transfer-reservation.dto';
import {
  FulfillmentOrderResponseDto,
  FulfillmentOrderListResponseDto,
} from '../dto/fulfillment-order-response.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Fulfillments')
@Controller('fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly reservations: FulfillmentReservationsFacade,
  ) {}

  @Post()
  @ApiOperation({ summary: '주문처리 생성' })
  @ApiResponse({ status: 201, description: '주문처리 생성 성공' })
  create(@Body() dto: CreateFulfillmentOrderDto) {
    return this.service.create(dto);
  }

  @Post('compensation-shipments')
  @ApiOperation({ summary: 'Create or link a fulfillment-only CS compensation shipment' })
  createCompensationShipment(@Body() dto: CreateCompensationShipmentDto, @User() user: AuthenticatedUser) {
    return this.service.createCompensationShipment(dto, this.getUserId(user));
  }

  @Post(':id/split')
  @ApiOperation({ summary: '주문처리 분할' })
  @ApiParam({ name: 'id', description: '분할할 주문처리 ID' })
  split(@Param('id') id: string, @Body() dto: SplitFulfillmentOrderDto) {
    return this.service.split(id, dto);
  }

  @Post(':id/assign-shipment')
  @ApiOperation({ summary: '배송 할당' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  assignShipment(@Param('id') id: string, @Body() dto: AssignShipmentDto) {
    return this.service.assignShipment(id, dto);
  }

  @Post(':id/ship')
  @ApiOperation({ summary: '출고 완료 처리 (FulfillmentShipped 이벤트 발행)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  ship(@Param('id') id: string) {
    return this.service.ship(id);
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
  @ApiOperation({ summary: '주문처리 상세 조회 (items, reservations, batch, shipment, invoice, adminAvailableActions 포함)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, type: FulfillmentOrderResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
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

  @Post(':id/check-availability')
  @ApiOperation({ summary: '재고 가용성 확인' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  checkAvailability(@Param('id') id: string) {
    return this.service.checkAvailability(id);
  }

  @Post(':id/reserve')
  @ApiOperation({ summary: '재고 예약' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: ReserveDto })
  reserve(@Param('id') id: string, @Body() dto: ReserveDto) {
    return this.reservations.reserve(id, dto);
  }

  @Post(':id/unreserve')
  @ApiOperation({ summary: '재고 예약 해제' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: UnreserveDto })
  unreserve(@Param('id') id: string, @Body() dto: UnreserveDto) {
    return this.reservations.unreserve(id, dto);
  }

  @Post(':id/transfer-reservation')
  @ApiOperation({ summary: '예약 이전 (같은 창고·같은 SKU FOI 간, cross-FO 허용, 작업 전 상태만)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: TransferReservationDto })
  transfer(@Param('id') id: string, @Body() dto: TransferReservationDto, @User() user: AuthenticatedUser) {
    return this.reservations.transferReservation(id, { ...dto, performedBy: this.getUserId(user) });
  }

  @Get(':id/transfer-candidates')
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
