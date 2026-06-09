import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
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
import { FulfillmentOrderResponseDto } from '../dto/fulfillment-order-response.dto';
import { ListFulfillmentsQueryDto } from '../dto/list-fulfillments-query.dto';

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

  @Get(':id')
  @ApiOperation({ summary: '주문처리 상세 조회 (items, reservations, batch, shipment, invoice, adminAvailableActions 포함)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, type: FulfillmentOrderResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  @ApiOperation({ summary: '주문처리 목록 조회' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'fulfillmentMode', required: false, enum: ['in_house', '3pl', 'drop_ship'] })
  @ApiQuery({ name: 'salesOrderId', required: false })
  @ApiQuery({ name: 'priority', required: false, enum: ['normal', 'high', 'urgent'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, type: [FulfillmentOrderResponseDto] })
  list(@Query() query: ListFulfillmentsQueryDto) {
    return this.service.list({
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      status: query.status,
      warehouseId: query.warehouseId,
      fulfillmentMode: query.fulfillmentMode,
      salesOrderId: query.salesOrderId,
      priority: query.priority,
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
  @ApiOperation({ summary: '예약 이전 (같은 SKU FOI 간)' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: TransferReservationDto })
  transfer(@Param('id') id: string, @Body() dto: TransferReservationDto) {
    return this.reservations.transferReservation(id, dto);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
