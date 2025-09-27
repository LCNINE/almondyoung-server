import { Controller, Get, Post, Body, Param, Query, UsePipes } from '@nestjs/common';
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
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateFulfillmentSchema = z.object({
  salesOrderId: z.string().optional(),
  warehouseId: z.string().optional(),
  ownerId: z.string().optional(),
  shippingAddress: z.any().optional(),
  lines: z.array(z.object({ skuId: z.string(), quantity: z.number().int().positive() })).min(1),
});

const AssignShipmentSchema = z.object({ trackingNo: z.string(), eta: z.string().datetime().optional() });
const ReserveSchema = z.object({ fulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });
const UnreserveSchema = z.object({ fulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });
const TransferSchema = z.object({ fromFulfillmentOrderLineId: z.string(), toFulfillmentOrderLineId: z.string(), quantity: z.number().int().positive() });

@ApiTags('Fulfillments')
@Controller('wms/fulfillments')
export class FulfillmentsController {
  constructor(
    private readonly service: FulfillmentsService,
    private readonly reservations: FulfillmentReservationsFacade,
  ) {}

  @Post()
  @ApiOperation({ summary: '주문처리 생성', description: '새로운 주문처리(Fulfillment)를 생성합니다.' })
  @ApiBody({
    description: '주문처리 생성 데이터',
    schema: {
      type: 'object',
      properties: {
        salesOrderId: { type: 'string', description: '판매 주문 ID (선택사항)' },
        warehouseId: { type: 'string', description: '창고 ID (선택사항)' },
        ownerId: { type: 'string', description: '소유자 ID (선택사항)' },
        shippingAddress: { description: '배송 주소 (선택사항)' },
        lines: {
          type: 'array',
          description: '주문 라인 목록',
          items: {
            type: 'object',
            properties: {
              skuId: { type: 'string', description: 'SKU ID' },
              quantity: { type: 'number', description: '수량' }
            },
            required: ['skuId', 'quantity']
          },
          minItems: 1
        }
      },
      required: ['lines']
    }
  })
  @ApiResponse({ status: 201, description: '주문처리 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(CreateFulfillmentSchema))
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Post(':id/split')
  @ApiOperation({ summary: '주문처리 분할', description: '기존 주문처리를 여러 개로 분할합니다.' })
  @ApiParam({ name: 'id', description: '분할할 주문처리 ID' })
  @ApiBody({ description: '분할 설정 데이터' })
  @ApiResponse({ status: 200, description: '주문처리 분할 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '분할할 수 없는 상태' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  split(@Param('id') id: string, @Body() dto: any) {
    return this.service.split(id, dto);
  }

  @Post(':id/assign-shipment')
  @ApiOperation({ summary: '배송 할당', description: '주문처리에 배송 정보를 할당합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({
    description: '배송 할당 데이터',
    schema: {
      type: 'object',
      properties: {
        trackingNo: { type: 'string', description: '운송장 번호' },
        eta: { type: 'string', format: 'date-time', description: '예상 도착시간 (선택사항)' }
      },
      required: ['trackingNo']
    }
  })
  @ApiResponse({ status: 200, description: '배송 할당 성공' })
  @ApiResponse({ status: 404, description: '주문처리를 찾을 수 없음' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(AssignShipmentSchema))
  assignShipment(@Param('id') id: string, @Body() dto: any) {
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
  @ApiBody({
    description: '재고 예약 데이터',
    schema: {
      type: 'object',
      properties: {
        fulfillmentOrderLineId: { type: 'string', description: '주문처리 라인 ID' },
        quantity: { type: 'number', description: '예약할 수량' }
      },
      required: ['fulfillmentOrderLineId', 'quantity']
    }
  })
  @ApiResponse({ status: 200, description: '재고 예약 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(ReserveSchema))
  reserve(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.reserve(dto);
  }

  @Post(':id/unreserve')
  @ApiOperation({ summary: '재고 예약 해제', description: '주문처리 라인에 대한 재고 예약을 해제합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({
    description: '재고 예약 해제 데이터',
    schema: {
      type: 'object',
      properties: {
        fulfillmentOrderLineId: { type: 'string', description: '주문처리 라인 ID' },
        quantity: { type: 'number', description: '해제할 수량' }
      },
      required: ['fulfillmentOrderLineId', 'quantity']
    }
  })
  @ApiResponse({ status: 200, description: '재고 예약 해제 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(UnreserveSchema))
  unreserve(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.unreserve(dto);
  }

  @Post(':id/transfer-reservation')
  @ApiOperation({ summary: '예약 이전', description: '한 주문처리 라인에서 다른 라인으로 재고 예약을 이전합니다.' })
  @ApiParam({ name: 'id', description: '주문처리 ID' })
  @ApiBody({
    description: '예약 이전 데이터',
    schema: {
      type: 'object',
      properties: {
        fromFulfillmentOrderLineId: { type: 'string', description: '이전할 원본 라인 ID' },
        toFulfillmentOrderLineId: { type: 'string', description: '이전할 대상 라인 ID' },
        quantity: { type: 'number', description: '이전할 수량' }
      },
      required: ['fromFulfillmentOrderLineId', 'toFulfillmentOrderLineId', 'quantity']
    }
  })
  @ApiResponse({ status: 200, description: '예약 이전 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '주문처리 또는 라인을 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  @UsePipes(new ZodValidationPipe(TransferSchema))
  transfer(@Param('id') id: string, @Body() dto: any) {
    return this.reservations.transferReservation(dto);
  }
}


