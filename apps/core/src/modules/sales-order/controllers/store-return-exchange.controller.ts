import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { StoreReturnExchangeService } from '../services/store-return-exchange.service';
import { StoreCreateReturnRequestDto, StoreReturnRequestResponseDto, StoreOrderLinesResponseDto } from '../dto/store-return-request.dto';
import { StoreCreateExchangeRequestDto, StoreExchangeRequestResponseDto } from '../dto/store-exchange-request.dto';

interface AuthenticatedCustomer {
  userId: string;
}

@ApiTags('Store - Return/Exchange')
@Controller('store/orders')
export class StoreSalesOrderReturnExchangeController {
  constructor(private readonly service: StoreReturnExchangeService) {}

  @Post(':orderId/return-requests')
  @HttpCode(201)
  @ApiOperation({ summary: '반품 신청' })
  @ApiParam({ name: 'orderId', description: 'Core 판매주문 ID' })
  createReturnRequest(
    @Param('orderId') orderId: string,
    @User() customer: AuthenticatedCustomer,
    @Body() dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    return this.service.createReturnRequest(orderId, customer.userId, dto);
  }

  @Post(':orderId/exchange-requests')
  @HttpCode(201)
  @ApiOperation({ summary: '교환 신청' })
  @ApiParam({ name: 'orderId', description: 'Core 판매주문 ID' })
  createExchangeRequest(
    @Param('orderId') orderId: string,
    @User() customer: AuthenticatedCustomer,
    @Body() dto: StoreCreateExchangeRequestDto,
  ): Promise<StoreExchangeRequestResponseDto> {
    return this.service.createExchangeRequest(orderId, customer.userId, dto);
  }

  @Get(':orderId/return-requests/:returnRequestId')
  @ApiOperation({ summary: '반품 신청 조회' })
  @ApiParam({ name: 'orderId', description: 'Core 판매주문 ID' })
  getReturnRequest(
    @Param('orderId') orderId: string,
    @Param('returnRequestId') returnRequestId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreReturnRequestResponseDto> {
    return this.service.getReturnRequest(returnRequestId, customer.userId);
  }

  @Get(':orderId/exchange-requests/:exchangeRequestId')
  @ApiOperation({ summary: '교환 신청 조회' })
  @ApiParam({ name: 'orderId', description: 'Core 판매주문 ID' })
  getExchangeRequest(
    @Param('orderId') orderId: string,
    @Param('exchangeRequestId') exchangeRequestId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreExchangeRequestResponseDto> {
    return this.service.getExchangeRequest(exchangeRequestId, customer.userId);
  }

  // ── by-channel-order variants (Medusa order ID) ───────────────────────────

  @Get('by-channel-order/:channelOrderId/lines')
  @ApiOperation({ summary: '주문 라인 목록 조회 (Medusa order ID 기반)' })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  getOrderLinesByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreOrderLinesResponseDto> {
    return this.service.getOrderLinesByChannelOrder(channelOrderId, customer.userId);
  }

  @Post('by-channel-order/:channelOrderId/return-requests')
  @HttpCode(201)
  @ApiOperation({ summary: '반품 신청 (Medusa order ID 기반)' })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  createReturnRequestByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @User() customer: AuthenticatedCustomer,
    @Body() dto: StoreCreateReturnRequestDto,
  ): Promise<StoreReturnRequestResponseDto> {
    return this.service.createReturnRequestByChannelOrder(channelOrderId, customer.userId, dto);
  }

  @Post('by-channel-order/:channelOrderId/exchange-requests')
  @HttpCode(201)
  @ApiOperation({ summary: '교환 신청 (Medusa order ID 기반)' })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  createExchangeRequestByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @User() customer: AuthenticatedCustomer,
    @Body() dto: StoreCreateExchangeRequestDto,
  ): Promise<StoreExchangeRequestResponseDto> {
    return this.service.createExchangeRequestByChannelOrder(channelOrderId, customer.userId, dto);
  }

  @Get('by-channel-order/:channelOrderId/return-requests/:returnRequestId')
  @ApiOperation({ summary: '반품 신청 조회 (Medusa order ID 기반)' })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  getReturnRequestByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @Param('returnRequestId') returnRequestId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreReturnRequestResponseDto> {
    return this.service.getReturnRequestByChannelOrder(channelOrderId, returnRequestId, customer.userId);
  }

  @Get('by-channel-order/:channelOrderId/exchange-requests/:exchangeRequestId')
  @ApiOperation({ summary: '교환 신청 조회 (Medusa order ID 기반)' })
  @ApiParam({ name: 'channelOrderId', description: 'Medusa 주문 ID' })
  getExchangeRequestByChannelOrder(
    @Param('channelOrderId') channelOrderId: string,
    @Param('exchangeRequestId') exchangeRequestId: string,
    @User() customer: AuthenticatedCustomer,
  ): Promise<StoreExchangeRequestResponseDto> {
    return this.service.getExchangeRequestByChannelOrder(channelOrderId, exchangeRequestId, customer.userId);
  }
}
