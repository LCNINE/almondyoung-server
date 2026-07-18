import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import {
  StoreBatchOrderActionsRequestDto,
  StoreCancelOrderDto,
  StoreOrderActionsResponseDto,
} from '../dto/store-order-actions.dto';
import { StoreOrderTrackingResponseDto } from '../dto/store-order-tracking.dto';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';

interface AuthenticatedCustomer {
  userId: string;
  roles?: string[];
}

@ApiTags('Store - Orders')
@Controller('store/orders')
export class StoreSalesOrdersController {
  constructor(private readonly service: StoreSalesOrdersService) {}

  @Get(':id/actions')
  @ApiOperation({ summary: '고객 주문 가능 액션 조회 (Core SO ID 기반)' })
  @ApiParam({ name: 'id', description: 'Core 판매주문 ID (UUID)' })
  getActions(@Param('id') id: string, @User() customer: AuthenticatedCustomer): Promise<StoreOrderActionsResponseDto> {
    return this.service.getActions(id, customer.userId);
  }

  @Post(':id/cancel-request')
  @HttpCode(200)
  @ApiOperation({ summary: '고객 주문 취소 요청 (Core SO ID 기반)' })
  @ApiParam({ name: 'id', description: 'Core 판매주문 ID (UUID)' })
  cancelRequest(
    @Param('id') id: string,
    @Body() dto: StoreCancelOrderDto,
    @User() customer: AuthenticatedCustomer,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StoreOrderActionsResponseDto> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.service.cancelRequest(id, customer.userId, dto, {
      idempotencyKey: idempotencyKey.trim(),
      actorId: customer.userId,
      actorRoles: customer.roles ?? [],
    });
  }

  /**
   * Medusa order ID (= Core channelOrderId)로 액션 조회.
   * 스토어프론트는 이 엔드포인트를 사용한다.
   */
  @Get('by-channel-order/:channelOrderId/actions')
  @ApiOperation({
    summary: '고객 주문 가능 액션 조회 (Medusa 주문 ID 기반)',
    description: '스토어프론트에서 Medusa order ID를 그대로 사용해 액션 목록을 조회합니다.',
  })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  getActionsByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreOrderActionsResponseDto> {
    return this.service.getActionsByChannelOrder(channelOrderId, customer.userId);
  }

  @Post('by-channel-order/actions/batch')
  @HttpCode(200)
  @ApiOperation({
    summary: '고객 주문 가능 액션 배치 조회 (Medusa 주문 ID 기반)',
    description:
      '주문목록 한 페이지 분량의 액션을 1콜로 조회합니다. 미수집·타인 주문은 응답에서 제외되며, 응답 항목은 channelOrderId 로 매핑합니다.',
  })
  getActionsByChannelOrderBatch(
    @Body() dto: StoreBatchOrderActionsRequestDto,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreOrderActionsResponseDto[]> {
    return this.service.getActionsByChannelOrderBatch(dto.channelOrderIds, customer.userId);
  }

  @Post('by-channel-order/:channelOrderId/cancel-request')
  @HttpCode(200)
  @ApiOperation({
    summary: '고객 주문 취소 요청 (Medusa 주문 ID 기반)',
    description: '출고 전 자사몰 주문만 취소 가능합니다.',
  })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  cancelRequestByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @Body() dto: StoreCancelOrderDto,
    @User() customer: AuthenticatedCustomer,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<StoreOrderActionsResponseDto> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.service.cancelRequestByChannelOrder(channelOrderId, customer.userId, dto, {
      idempotencyKey: idempotencyKey.trim(),
      actorId: customer.userId,
      actorRoles: customer.roles ?? [],
    });
  }

  @Get('by-channel-order/:channelOrderId/tracking')
  @ApiOperation({
    summary: '배송 조회 (Medusa 주문 ID 기반)',
    description: '송장번호, 택배사, 배송 이벤트 목록을 반환합니다.',
  })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  getTrackingByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreOrderTrackingResponseDto> {
    return this.service.getTrackingByChannelOrder(channelOrderId, customer.userId);
  }

  @Get(':id/tracking')
  @ApiOperation({ summary: '배송 조회 (Core SO ID 기반)' })
  @ApiParam({ name: 'id', description: 'Core 판매주문 ID' })
  getTracking(
    @Param('id') id: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreOrderTrackingResponseDto> {
    return this.service.getTracking(id, customer.userId);
  }
}
