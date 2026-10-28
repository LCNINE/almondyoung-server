import { BadRequestException, Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { User, RequirePermission } from '@app/authorization';
import { StoreSalesOrdersService } from '../services/store-sales-orders.service';

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


/**
 * 관리자 주문 취소·취소 환불 라우트 (K8 PR 10 N3). 옛 반품·교환 컨트롤러에 섞여 있던 넷을 경로·권한 그대로 옮겼다 —
 * admin-web `sales-orders.client.ts` 가 이 경로를 부른다.
 */
@ApiTags('Admin - Sales Order Cancellation')
@Controller('admin')
export class AdminSalesOrderCancellationController {
  constructor(private readonly storeSalesOrdersService: StoreSalesOrdersService) {}

  @RequirePermission('order.order.cancel')
  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '관리자 주문 취소 — 채널 주문은 취소 요청, core 정산 주문은 환불 결정 대기(Wallet 미호출)' })
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

  @RequirePermission('payment.refund.execute')
  @Post('sales-orders/:id/refund-waive')
  @HttpCode(200)
  @ApiOperation({ summary: '취소 주문 환불 안 함 결정 (환불 결정 대기 건에만)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  adminWaiveRefund(@Param('id') id: string, @Body() dto: AdminDecideRequestDto) {
    return this.storeSalesOrdersService.adminWaiveRefund(id, dto);
  }
}
