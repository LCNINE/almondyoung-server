import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RequireScopes, ScopeGuard, User, RequirePermission, PiiResponse } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { StoreReturnExchangeService } from '../services/store-return-exchange.service';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';
import { StoreCreateReturnRequestDto } from '../dto/store-return-request.dto';

interface AuthenticatedAdmin {
  userId: string;
  roles?: string[];
}

export class AdminDecideRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;

  /** 특정 partial cancellation의 환불 링크 ID를 지정하여 scoped 완료 처리 */
  @IsOptional()
  @IsString()
  refundLinkId?: string;
}

class AdminCancelLineDto {
  @IsString()
  salesOrderLineId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class AdminCancelOrderDto {
  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminCancelLineDto)
  lines?: AdminCancelLineDto[];
}

@ApiTags('Admin - Return/Exchange')
@Controller('admin')
export class AdminReturnExchangeController {
  constructor(
    private readonly service: StoreReturnExchangeService,
    private readonly storeSalesOrdersService: StoreSalesOrdersService,
  ) {}

  // ── Sales Order Admin Cancel ──────────────────────────────────────────────

  @RequirePermission('order.order.cancel')
  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '관리자 주문 취소 — 채널 주문은 취소 요청, core 주문은 Wallet 자동 환불 연동' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminCancelOrder(
    @Param('id') id: string,
    @Body() dto: AdminCancelOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() admin: AuthenticatedAdmin,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.storeSalesOrdersService.adminCancelRequest(id, {
      ...dto,
      fulfillmentCommandContext: {
        idempotencyKey: idempotencyKey.trim(),
        actorId: admin.userId,
        actorRoles: admin.roles ?? [],
      },
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post('sales-orders/:id/retry-refund')
  @HttpCode(200)
  @ApiOperation({ summary: '취소 주문 환불 재시도 (failed/manual_pending 상태에서만 의미 있음)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminRetryRefund(@Param('id') id: string) {
    return this.storeSalesOrdersService.retryWalletRefund(id);
  }

  @RequirePermission('payment.refund.execute')
  @Post('sales-orders/:id/manual-refund-complete')
  @HttpCode(200)
  @ApiOperation({
    summary: '취소 주문 수동 환불 완료 확인 (manual_pending/failed 상태에서만 의미 있음)',
    description:
      '외부(PG/은행)에서 이미 환불한 사실을 운영자가 확인하고 내부 상태를 완료로 기록한다. ' +
      'provider.refund()를 호출하지 않으므로 자동 환불 완료와 구분된다.',
  })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminManualRefundComplete(@Param('id') id: string, @Body() dto: AdminDecideRequestDto) {
    return this.storeSalesOrdersService.adminManualRefundComplete(id, dto);
  }

  // ── Return Requests ───────────────────────────────────────────────────────

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('fulfillment.warehouse.operate')
  @Post('sales-orders/:id/return-requests')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '배송 완료 attempt를 지정한 관리자 대리 반품 요청 생성' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  createReturnRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: StoreCreateReturnRequestDto,
  ) {
    return this.service.adminCreateReturnRequest(id, admin.userId, dto);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('sales-orders/:id/return-eligibility')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '배송 완료 attempt별 반품 가능 수량 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  getReturnEligibility(@Param('id') id: string) {
    return this.service.adminGetReturnEligibility(id);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('sales-orders/by-channel-order/:channelOrderId/return-eligibility')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '채널 주문의 배송 완료 attempt별 반품 가능 수량 조회 (관리자)' })
  @ApiParam({ name: 'channelOrderId', description: '채널 주문 ID' })
  getReturnEligibilityByChannelOrder(@Param('channelOrderId') channelOrderId: string) {
    return this.service.adminGetReturnEligibilityByChannelOrder(channelOrderId);
  }

  @PiiResponse({
    fields: {
      'items[].request.returnAddress': 'redact',
      'items[].request.reasonDetail': 'text',
      'items[].request.adminNote': 'text',
    },
    subjects: [
      { path: 'items[].request.id', type: 'return_request' },
      { path: 'items[].request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.read')
  @Get('return-requests')
  @ApiQuery({ name: 'createdFrom', required: false, description: '접수 시각 하한 (ISO 8601, 포함)' })
  @ApiQuery({ name: 'createdTo', required: false, description: '접수 시각 상한 (ISO 8601, 포함)' })
  @ApiOperation({ summary: '반품 요청 목록 조회 (관리자)' })
  @ApiQuery({ name: 'salesOrderId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listReturnRequests(
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
  ) {
    return this.service.adminListReturnRequests({
      salesOrderId,
      status,
      createdFrom: parseInstant(createdFrom, 'createdFrom'),
      createdTo: parseInstant(createdTo, 'createdTo'),
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
    reveal: true,
  })
  @RequirePermission('order.claim.read')
  @Get('return-requests/:id')
  @ApiOperation({ summary: '반품 요청 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  getReturnRequest(@Param('id') id: string) {
    return this.service.adminGetReturnRequest(id);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 요청 승인 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  approveReturnRequest(@Param('id') id: string, @User() admin: AuthenticatedAdmin, @Body() dto: AdminDecideRequestDto) {
    return this.service.approveReturnRequest(id, admin.userId, dto.adminNote);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 요청 거절 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  rejectReturnRequest(@Param('id') id: string, @User() admin: AuthenticatedAdmin, @Body() dto: AdminDecideRequestDto) {
    return this.service.rejectReturnRequest(id, admin.userId, dto.adminNote);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/collection-pending')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수거 대기 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnCollectionPending(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markCollectionPending(id, admin.userId);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/collected')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수거 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnCollected(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markCollected(id, admin.userId);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/inspected')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 검수 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnInspected(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markInspected(id, admin.userId);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 처리 완료 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  completeReturnRequest(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.completeReturnRequest(id, admin.userId);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('payment.refund.execute')
  @Post('return-requests/:id/retry-refund')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 환불 재시도 (관리자) — refund_pending 상태에서만 가능' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  retryReturnRefund(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.retryReturnRefund(id, admin.userId);
  }

  @PiiResponse({
    fields: {
      'request.returnAddress': 'redact',
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'return_request' },
      { path: 'request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.write')
  @Post('return-requests/:id/manual-complete')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수동 환불 완료 (관리자) — refund_pending 상태에서만 가능' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  manualCompleteReturn(@Param('id') id: string, @User() admin: AuthenticatedAdmin, @Body() dto: AdminDecideRequestDto) {
    return this.service.manualCompleteReturn(id, admin.userId, dto.adminNote);
  }

  // ── Exchange Requests ─────────────────────────────────────────────────────

  @PiiResponse({
    fields: {
      'items[].request.reasonDetail': 'text',
      'items[].request.adminNote': 'text',
    },
    subjects: [
      { path: 'items[].request.id', type: 'exchange_request' },
      { path: 'items[].request.customerId', type: 'user' },
    ],
  })
  @RequirePermission('order.claim.read')
  @Get('exchange-requests')
  @ApiQuery({ name: 'createdFrom', required: false, description: '접수 시각 하한 (ISO 8601, 포함)' })
  @ApiQuery({ name: 'createdTo', required: false, description: '접수 시각 상한 (ISO 8601, 포함)' })
  @ApiOperation({ summary: '교환 요청 목록 조회 (관리자)' })
  @ApiQuery({ name: 'salesOrderId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listExchangeRequests(
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
  ) {
    return this.service.adminListExchangeRequests({
      salesOrderId,
      status,
      createdFrom: parseInstant(createdFrom, 'createdFrom'),
      createdTo: parseInstant(createdTo, 'createdTo'),
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @PiiResponse({
    fields: {
      'request.reasonDetail': 'text',
      'request.adminNote': 'text',
    },
    subjects: [
      { path: 'request.id', type: 'exchange_request' },
      { path: 'request.customerId', type: 'user' },
    ],
    reveal: true,
  })
  @RequirePermission('order.claim.read')
  @Get('exchange-requests/:id')
  @ApiOperation({ summary: '교환 요청 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  getExchangeRequest(@Param('id') id: string) {
    return this.service.adminGetExchangeRequest(id);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 요청 승인 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  approveExchangeRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: AdminDecideRequestDto,
  ) {
    return this.service.approveExchangeRequest(id, admin.userId, dto.adminNote);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 요청 거절 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  rejectExchangeRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: AdminDecideRequestDto,
  ) {
    return this.service.rejectExchangeRequest(id, admin.userId, dto.adminNote);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/collection-pending')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 수거 대기 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeCollectionPending(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markExchangeCollectionPending(id, admin.userId);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/collected')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 수거 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeCollected(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markExchangeCollected(id, admin.userId);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/inspected')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 검수 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeInspected(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markExchangeInspected(id, admin.userId);
  }

  @RequirePermission('order.claim.write')
  @Post('exchange-requests/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 처리 완료 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  completeExchangeRequest(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.completeExchangeRequest(id, admin.userId);
  }
}

function parseInstant(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} 는 ISO 8601 시각이어야 합니다`);
  return date;
}
