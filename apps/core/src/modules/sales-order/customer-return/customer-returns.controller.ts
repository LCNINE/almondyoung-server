import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PiiResponse, RequirePermission, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../platform/auth/inventory-scopes';
import {
  WarehouseActor,
  authenticatedWarehouseActor,
} from '../../inventory/core/services/warehouse-operation-contract';
import { ListCustomerReturnsQueryDto } from './dto/list-customer-returns.dto';
import { CustomerReturnService } from './customer-return.service';
import { RecordCustomerReturnArrivalDto, RecordCustomerReturnInspectionDto } from './dto/customer-return-receiving.dto';
import {
  CloseCustomerReturnMissingDto,
  RequestCustomerReturnPrepayDto,
  RetryCustomerReturnSettlementDto,
  SettleHeldCustomerReturnDto,
} from './dto/customer-return-cs.dto';

/**
 * 고객 반품 기록(K8 PR6) — 조회와 창고의 도착·검수, CS 의 미도착 닫기·보류 정산·선환불과
 * 정산·선환불의 다시 시도·계좌 송금(PR6b).
 * 고객 개인정보는 목록의 고객명뿐이고 `@PiiResponse` 가 가린다. 상세·쓰기 응답엔 없다(수량·상태·CS 메모뿐).
 */
@ApiTags('Admin - Customer Returns')
@Controller('admin/customer-returns')
export class CustomerReturnsController {
  constructor(private readonly service: CustomerReturnService) {}

  @PiiResponse({
    fields: { 'items[].customerName': 'name' },
    subjects: [{ path: 'items[].salesOrderId', type: 'sales_order' }],
  })
  @RequirePermission('order.claim.read')
  @Get()
  @ApiOperation({ summary: '반품 목록 — 진행 중(open)·확인 필요(attention)·끝남(closed), 주문번호·고객명 검색' })
  list(@Query() query: ListCustomerReturnsQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission('order.claim.read')
  @Get(':id')
  @ApiOperation({ summary: '반품 기록 조회 — 줄·SKU 항목별 기대·도착·검수 수량과 정산 진행' })
  @ApiParam({ name: 'id', description: '반품 기록 id(customer_returns.id)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/arrivals')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '반품 도착 — 받은 수량을 원장 RETURNED 로. 소포마다 멱등키 필수' })
  @ApiResponse({ status: 200, description: '도착 반영 뒤의 반품 기록' })
  @ApiResponse({
    status: 400,
    description: '배송완료하지 않은 창고 · 첫 도착과 다른 창고 · 남의 항목 · 기대 수량 초과',
  })
  @ApiResponse({ status: 409, description: '도착을 받을 수 없는 상태 · 같은 키로 다른 수량' })
  @HttpCode(HttpStatus.OK)
  recordArrival(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordCustomerReturnArrivalDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.recordArrival({
      customerReturnId: id,
      warehouseId: dto.warehouseId,
      items: dto.items,
      idempotencyKey: dto.idempotencyKey,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('inventory.stock.operate')
  @Post(':id/inspection')
  @UseGuards(ScopeGuard)
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  @ApiOperation({ summary: '반품 검수 — 양품·불량·보류. 보류가 없으면 채널에 수령·환불 정산을 요청한다' })
  @ApiResponse({ status: 200, description: '검수 반영 뒤의 반품 기록' })
  @ApiResponse({ status: 400, description: '아직 도착하지 않은 수량 · 항목 누락·중복 · 합이 도착 수량과 다름' })
  @ApiResponse({ status: 409, description: '검수할 수 없는 상태 · 이미 다른 결과로 검수함' })
  @HttpCode(HttpStatus.OK)
  recordInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordCustomerReturnInspectionDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.recordInspection({
      customerReturnId: id,
      items: dto.items,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('order.claim.write')
  @Post(':id/missing-closure')
  @ApiOperation({
    summary: '반품 미도착 닫기 — 온전히 도착한 벌만 남기고 나머지를 닫는다. 이어서 도착한 만큼 검수한다',
  })
  @ApiResponse({ status: 200, description: '닫은 뒤의 반품 기록(줄마다 missingQty)' })
  @ApiResponse({ status: 400, description: '모두 도착함(검수하세요) · 온전히 도착한 벌이 없음(반품 취소로 닫으세요)' })
  @ApiResponse({ status: 409, description: '도착 전(반품 취소로 닫으세요) · 도착 상태가 아님 · 먼저 환불한 반품' })
  @HttpCode(HttpStatus.OK)
  closeMissing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCustomerReturnMissingDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.closeMissing({
      customerReturnId: id,
      memo: dto.memo,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/held-settlement')
  @ApiOperation({ summary: '보류 정산 — 보류 차감을 정해 채널에 수령·환불 정산을 요청한다. 0 이면 차감 없이' })
  @ApiResponse({ status: 200, description: '정산을 연 뒤의 반품 기록' })
  @ApiResponse({ status: 409, description: '보류 상태가 아님 · 이미 다른 차감으로 정산함' })
  @HttpCode(HttpStatus.OK)
  settleHeld(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleHeldCustomerReturnDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.settleHeld({
      customerReturnId: id,
      deduction: dto.deduction,
      memo: dto.memo,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/prepayment')
  @ApiOperation({ summary: '선환불 요청 — 수령 전에 환불을 먼저 낸다. 금액이 없으면 품목 값 − 택배비 예상' })
  @ApiResponse({ status: 200, description: '선환불을 요청한 뒤의 반품 기록(prepayment)' })
  @ApiResponse({
    status: 409,
    description:
      '수령 전이 아님 · 미도착으로 닫은 반품 · 이미 다른 금액·메모·환불 방식으로 요청함' +
      '(Medusa 가 기록 전에 거절한 선환불은 새 요청으로 갈아 끼운다)',
  })
  @HttpCode(HttpStatus.OK)
  requestPrepay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCustomerReturnPrepayDto,
    @User() user?: WarehouseActor,
  ) {
    return this.service.requestPrepay({
      customerReturnId: id,
      amount: dto.amount ?? null,
      refundMode: dto.refundMode ?? 'auto',
      memo: dto.memo,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/settlement/retry')
  @ApiOperation({
    summary:
      '반품 정산 다시 시도 — 거절·멈춘 정산을 같은 방식으로 다시 낸다. 외부 환불 거절이면 이미 환불한 금액을 적는다',
  })
  @ApiResponse({ status: 200, description: '다시 낸 뒤의 반품 기록(settlement)' })
  @ApiResponse({
    status: 400,
    description: '외부 환불 거절(external_refund_*)이 아닌데 이미 환불한 금액을 적거나 지움',
  })
  @ApiResponse({ status: 409, description: '정산 중이 아님 · 진행 중(결과를 기다리세요) · 이미 끝남' })
  @HttpCode(HttpStatus.OK)
  retrySettlement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryCustomerReturnSettlementDto = {},
    @User() user?: WarehouseActor,
  ) {
    return this.service.restart({
      customerReturnId: id,
      target: 'settlement',
      kind: 'retry',
      alreadyRefundedAmount: dto.alreadyRefundedAmount,
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/settlement/manual-refund')
  @ApiOperation({ summary: '반품 정산을 계좌 송금으로 — 거절·멈춘 정산을 refundMode manual 로 다시 낸다' })
  @ApiResponse({ status: 200, description: '다시 낸 뒤의 반품 기록(settlement)' })
  @ApiResponse({ status: 409, description: '정산 중이 아님 · 진행 중 · 이미 끝남 · 이미 계좌 송금' })
  @HttpCode(HttpStatus.OK)
  manualRefundSettlement(@Param('id', ParseUUIDPipe) id: string, @User() user?: WarehouseActor) {
    return this.service.restart({
      customerReturnId: id,
      target: 'settlement',
      kind: 'manual',
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/prepayment/retry')
  @ApiOperation({ summary: '선환불 다시 시도 — 거절·멈춘 선환불을 처음 요청의 금액·메모 그대로 다시 낸다' })
  @ApiResponse({ status: 200, description: '다시 낸 뒤의 반품 기록(prepayment)' })
  @ApiResponse({ status: 409, description: '선환불 없음 · 수령 전이 아님 · 진행 중 · 이미 끝남(성공·정산이 대신함)' })
  @HttpCode(HttpStatus.OK)
  retryPrepayment(@Param('id', ParseUUIDPipe) id: string, @User() user?: WarehouseActor) {
    return this.service.restart({
      customerReturnId: id,
      target: 'prepayment',
      kind: 'retry',
      actorId: authenticatedWarehouseActor(user),
    });
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/prepayment/manual-refund')
  @ApiOperation({
    summary: '선환불을 계좌 송금으로 — 거절·멈춘 선환불을 같은 금액·메모, refundMode manual 로 다시 낸다',
  })
  @ApiResponse({ status: 200, description: '다시 낸 뒤의 반품 기록(prepayment)' })
  @ApiResponse({ status: 409, description: '선환불 없음 · 수령 전이 아님 · 진행 중 · 이미 끝남 · 이미 계좌 송금' })
  @HttpCode(HttpStatus.OK)
  manualRefundPrepayment(@Param('id', ParseUUIDPipe) id: string, @User() user?: WarehouseActor) {
    return this.service.restart({
      customerReturnId: id,
      target: 'prepayment',
      kind: 'manual',
      actorId: authenticatedWarehouseActor(user),
    });
  }
}
