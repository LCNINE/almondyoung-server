import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { User } from '@app/authorization';
import { StoreReturnExchangeService } from '../services/store-return-exchange.service';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';

interface AuthenticatedAdmin {
  userId: string;
}

export class AdminDecideRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
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

  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '관리자 주문 취소 + Wallet 자동 환불 연동' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminCancelOrder(@Param('id') id: string, @Body() dto: AdminCancelOrderDto) {
    return this.storeSalesOrdersService.adminCancelRequest(id, dto);
  }

  @Post('sales-orders/:id/retry-refund')
  @HttpCode(200)
  @ApiOperation({ summary: '취소 주문 환불 재시도 (failed/manual_pending 상태에서만 의미 있음)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminRetryRefund(@Param('id') id: string) {
    return this.storeSalesOrdersService.retryWalletRefund(id);
  }

  // ── Return Requests ───────────────────────────────────────────────────────

  @Get('return-requests')
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
  ) {
    return this.service.adminListReturnRequests({
      salesOrderId,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('return-requests/:id')
  @ApiOperation({ summary: '반품 요청 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  getReturnRequest(@Param('id') id: string) {
    return this.service.adminGetReturnRequest(id);
  }

  @Post('return-requests/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 요청 승인 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  approveReturnRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: AdminDecideRequestDto,
  ) {
    return this.service.approveReturnRequest(id, admin.userId, dto.adminNote);
  }

  @Post('return-requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 요청 거절 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  rejectReturnRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: AdminDecideRequestDto,
  ) {
    return this.service.rejectReturnRequest(id, admin.userId, dto.adminNote);
  }

  @Post('return-requests/:id/collection-pending')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수거 대기 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnCollectionPending(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.markCollectionPending(id, admin.userId);
  }

  @Post('return-requests/:id/collected')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수거 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnCollected(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.markCollected(id, admin.userId);
  }

  @Post('return-requests/:id/inspected')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 검수 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  markReturnInspected(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.markInspected(id, admin.userId);
  }

  @Post('return-requests/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 처리 완료 (관리자)' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  completeReturnRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.completeReturnRequest(id, admin.userId);
  }

  @Post('return-requests/:id/retry-refund')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 환불 재시도 (관리자) — refund_pending 상태에서만 가능' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  retryReturnRefund(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.retryReturnRefund(id, admin.userId);
  }

  @Post('return-requests/:id/manual-complete')
  @HttpCode(200)
  @ApiOperation({ summary: '반품 수동 환불 완료 (관리자) — refund_pending 상태에서만 가능' })
  @ApiParam({ name: 'id', description: '반품 요청 ID' })
  manualCompleteReturn(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
    @Body() dto: AdminDecideRequestDto,
  ) {
    return this.service.manualCompleteReturn(id, admin.userId, dto.adminNote);
  }

  // ── Exchange Requests ─────────────────────────────────────────────────────

  @Get('exchange-requests')
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
  ) {
    return this.service.adminListExchangeRequests({
      salesOrderId,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('exchange-requests/:id')
  @ApiOperation({ summary: '교환 요청 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  getExchangeRequest(@Param('id') id: string) {
    return this.service.adminGetExchangeRequest(id);
  }

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

  @Post('exchange-requests/:id/collection-pending')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 수거 대기 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeCollectionPending(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markExchangeCollectionPending(id, admin.userId);
  }

  @Post('exchange-requests/:id/collected')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 수거 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeCollected(@Param('id') id: string, @User() admin: AuthenticatedAdmin) {
    return this.service.markExchangeCollected(id, admin.userId);
  }

  @Post('exchange-requests/:id/inspected')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 검수 완료 처리 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  markExchangeInspected(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.markExchangeInspected(id, admin.userId);
  }

  @Post('exchange-requests/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '교환 처리 완료 (관리자)' })
  @ApiParam({ name: 'id', description: '교환 요청 ID' })
  completeExchangeRequest(
    @Param('id') id: string,
    @User() admin: AuthenticatedAdmin,
  ) {
    return this.service.completeExchangeRequest(id, admin.userId);
  }
}
