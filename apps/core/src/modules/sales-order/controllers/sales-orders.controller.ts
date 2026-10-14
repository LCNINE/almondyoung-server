import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@app/authorization';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ChannelCancelRequestService } from '../channel-cancel-request/channel-cancel-request.service';
import { SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { SalesOrderResponseDto } from '../dto/sales-order-response.dto';
import { DailyStatsQueryDto } from '../dto/daily-stats-query.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { CreateBusinessLinkDto } from '../dto/create-business-link.dto';
import {
  CancelSalesOrderDto,
  CancelByIntentDto,
  PrintGateByIntentDto,
  RetryCancelSettlementDto,
} from '../dto/cancel-sales-order.dto';

@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly service: SalesOrdersService,
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly storeSalesOrders: StoreSalesOrdersService,
    private readonly cancelRequests: ChannelCancelRequestService,
  ) {}

  @Post()
  @ApiOperation({ summary: '판매 주문 생성' })
  @ApiResponse({ status: 201, description: '판매 주문 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  create(@Body() dto: CreateSalesOrderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '판매 주문 수정' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '판매 주문 수정 성공' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: '판매 주문 확정' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '판매 주문 취소 (관리자 경로 — 채널 주문은 취소 요청, core 주문은 Wallet 환불 포함)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '취소 성공. { status, refundStatus } 반환' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelSalesOrderDto = {},
    @Headers('idempotency-key') idempotencyKey?: string,
    @User() user?: { userId?: string; id?: string; sub?: string; roles?: string[] },
  ) {
    const actorId = user?.userId ?? user?.id ?? user?.sub;
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!actorId) {
      throw new UnauthorizedException('Authenticated actor is required');
    }
    return this.storeSalesOrders.adminCancelRequest(id, {
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
      lines: dto.lines,
      alreadyRefundedAmount: dto.alreadyRefundedAmount,
      fulfillmentCommandContext: {
        idempotencyKey: idempotencyKey.trim(),
        actorId,
        actorRoles: Array.isArray(user?.roles) ? user.roles : [],
      },
    });
  }

  @Post('cancel-by-intent')
  @ApiOperation({ summary: '환불 완료된 결제의 주문 취소 (재환불 없음) — Wallet 환불 승인 후 호출' })
  @ApiResponse({ status: 201, description: '{ status, skipped? } 반환' })
  cancelByIntent(@Body() dto: CancelByIntentDto) {
    return this.storeSalesOrders.cancelByWalletIntentAfterRefund(dto.intentId, {
      reasonCode: dto.reasonCode,
      amount: dto.amount,
    });
  }

  @Post('print-gate-by-intent')
  @HttpCode(200)
  @ApiOperation({ summary: '무통장 환불 승인 전 확인 — 살아 있는 인쇄 줄이 있으면 409 PRINT_NEEDS_PARTIAL_CANCEL' })
  @ApiResponse({ status: 200, description: '{ ok: true } — 인쇄 줄이 없거나 모두 취소됨' })
  @ApiResponse({
    status: 409,
    description: '인쇄 상품이 있는 주문(PRINT_NEEDS_PARTIAL_CANCEL) 또는 Medusa 결제인데 주문 수집 전(PRINT_ORDER_NOT_COLLECTED)',
  })
  printGateByIntent(@Body() dto: PrintGateByIntentDto) {
    return this.storeSalesOrders.printGateByWalletIntent(dto.walletIntentId, { expectSalesOrder: dto.expectSalesOrder });
  }

  @Get('print-status-by-intent/:walletIntentId')
  @ApiOperation({
    summary: '결제의 주문에 와우프레스로 제작이 접수됐을 수 있는 인쇄 줄이 있는가 — 결제 상세 환불 제한 판단',
  })
  @ApiResponse({ status: 200, description: '{ hasActivePrint } — 주문·인쇄 줄이 없으면 false' })
  printStatusByIntent(@Param('walletIntentId') walletIntentId: string) {
    return this.storeSalesOrders.printStatusByWalletIntent(walletIntentId);
  }

  @Post(':id/cancel-request/:requestId/retry')
  @ApiOperation({
    summary: '채널 취소 정산 다시 시도 — 환불 지연·거절인 요청에 같은 requestId 로 명령을 다시 낸다(#1016 36번 재설계)',
  })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiParam({ name: 'requestId', description: '취소 요청 ID' })
  retryCancelSettlement(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: RetryCancelSettlementDto = {},
  ) {
    return this.cancelRequests.retrySettlement(id, requestId, { alreadyRefundedAmount: dto.alreadyRefundedAmount });
  }

  @Post(':id/cancel-request/:requestId/manual-refund')
  @ApiOperation({
    summary: '채널 취소를 계좌 송금으로 환불 — wallet 에 송금 대기 행을 만든다. 송금 뒤 결제 상세에서 완료 처리',
  })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiParam({ name: 'requestId', description: '취소 요청 ID' })
  manualRefundCancelSettlement(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.cancelRequests.switchToManualRefund(id, requestId);
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: '판매 주문 업무 연결 생성' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 201, description: '업무 연결 생성 성공' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  @Get(':id/amendments')
  @ApiOperation({ summary: '판매 주문 정정 목록 조회' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  listAmendments(@Param('id') id: string) {
    return this.amendments.listForSalesOrder(id);
  }

  @Get('stats/daily')
  @ApiOperation({
    summary: '일별 주문처리 현황',
    description: '주문일(KST) 기준 일별 상태별 건수와 교환·반품 접수 건수',
  })
  getDailyStatusStats(@Query() query: DailyStatsQueryDto) {
    return this.service.getDailyStatusStats(query.from, query.to);
  }

  @Get('stats')
  @ApiOperation({ summary: '주문 현황 통계', description: '최근 14일 주문 현황 통계를 조회합니다.' })
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: '판매 주문 단건 조회' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiResponse({ status: 200, description: '조회 성공', type: SalesOrderResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get()
  @ApiOperation({ summary: '판매 주문 목록 조회' })
  @ApiResponse({ status: 200, description: '목록 조회 성공', type: [SalesOrderResponseDto] })
  list(@Query() query: SalesOrderFilterDto) {
    return this.service.list(query);
  }
}
