import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { FulfillmentsService } from '../services/fulfillments.service';
import { FulfillmentReservationsFacade } from '../../shared/services/fulfillment-reservations.facade';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { SplitFulfillmentOrderDto } from '../dto/split-fulfillment-order.dto';
import { AssignShipmentDto } from '../dto/assign-shipment.dto';
import { ReserveDto } from '../dto/reserve.dto';
import { UnreserveDto } from '../dto/unreserve.dto';
import { TransferReservationDto } from '../dto/transfer-reservation.dto';

@ApiTags('Fulfillments')
@Controller('fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly reservations: FulfillmentReservationsFacade,
  ) { }

  @Post()
  @ApiOperation({ summary: '주문처리 생성', description: '새로운 주문처리(Fulfillment)를 생성합니다.' })
  @ApiResponse({ status: 201, description: '주문처리 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  create(@Body() dto: CreateFulfillmentOrderDto) {
    return this.service.create(dto);
  }

  @Post(':id/split')
  @ApiOperation({ summary: '주문처리 분할', description: '기존 주문처리를 여러 개로 분할합니다.' })
  @ApiParam({ name: 'id', description: '분할할 주문처리 ID' })
  @ApiResponse({ status: 200, description: '주문처리 분할 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '분할할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  split(@Param('id') id: string, @Body() dto: SplitFulfillmentOrderDto) {
    return this.service.split(id, dto);
  }

  @Post(':id/assign-shipment')
  @ApiOperation({ summary: '배송 할당', description: '주문처리에 배송 정보를 할당합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '배송 할당 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  assignShipment(@Param('id') id: string, @Body() dto: AssignShipmentDto) {
    return this.service.assignShipment(id, dto);
  }

  @Post(':id/ship')
  @ApiOperation({ summary: '배송 처리', description: '주문처리를 배솥 상태로 변경합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '배솥 처리 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '배솥할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  ship(@Param('id') id: string) {
    return this.service.ship(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '주문처리 취소', description: '주문처리를 취소합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '주문처리 취소 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '취소할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id')
  @ApiOperation({ summary: '주문처리 상세 조회', description: '특정 주문처리의 상세 정보를 조회합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '주문처리 상세 조회 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  @ApiOperation({ summary: '주문처리 목록 조회', description: '주문처리 목록을 페이지네이션과 함께 조회합니다.' })
  @ApiQuery({ name: 'limit', required: false, type: String, description: '조회할 아이템 수 (기본값: 20)' })
  @ApiQuery({ name: 'offset', required: false, type: String, description: '건너뛸 아이템 수 (기본값: 0)' })
  @ApiResponse({ status: 200, description: '주문처리 목록 조회 성공' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.service.list({ limit: limit ? parseInt(limit, 10) : 20, offset: offset ? parseInt(offset, 10) : 0 });
  }

  @Post(':id/check-availability')
  @ApiOperation({ summary: '재고 가용성 확인', description: '주문처리에 대한 재고 가용성을 확인합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiResponse({ status: 200, description: '재고 가용성 확인 완료' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  checkAvailability(@Param('id') id: string) {
    return this.service.checkAvailability(id);
  }

  @Post(':id/reserve')
  @ApiOperation({ summary: '재고 예약', description: '주문처리 라인에 대한 재고를 예약합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: ReserveDto, description: '재고 예약 데이터' })
  @ApiResponse({ status: 200, description: '재고 예약 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  reserve(@Param('id') id: string, @Body() dto: ReserveDto) {
    return this.reservations.reserve(dto);
  }

  @Post(':id/unreserve')
  @ApiOperation({ summary: '재고 예약 해제', description: '주문처리 라인에 대한 재고 예약을 해제합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: UnreserveDto, description: '재고 예약 해제 데이터' })
  @ApiResponse({ status: 200, description: '재고 예약 해제 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  unreserve(@Param('id') id: string, @Body() dto: UnreserveDto) {
    return this.reservations.unreserve(dto);
  }

  @Post(':id/transfer-reservation')
  @ApiOperation({ summary: '예약 이전', description: '한 주문처리 라인에서 다른 라인으로 재고 예약을 이전합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({ type: TransferReservationDto, description: '예약 이전 데이터' })
  @ApiResponse({ status: 200, description: '예약 이전 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  transfer(@Param('id') id: string, @Body() dto: TransferReservationDto) {
    return this.reservations.transferReservation(dto);
  }
}


