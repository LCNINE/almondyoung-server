import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentIntentAdminService } from './payment-intent-admin.service';
import { AdminRefundListQueryDto, ChangeRefundKindDto } from './dto';
import type { AuthenticatedRequest } from '../wallet.module';
import { toRefundResponse } from '../refunds/refund-response';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { RefundsService } from '../refunds/refunds.service';
import { RequirePermission } from '@app/authorization';

@ApiTags('Admin - Refunds')
@WalletAdminAuth()
@Controller('v1/admin/refunds')
export class RefundAdminController {
  constructor(
    private readonly service: PaymentIntentAdminService,
    private readonly refundsService: RefundsService,
  ) {}

  @RequirePermission('payment.refund.read')
  @Get()
  @ApiOperation({ summary: 'List refunds (admin, paginated)' })
  async list(@Query() query: AdminRefundListQueryDto) {
    try {
      return await this.service.listRefunds(query);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @RequirePermission('payment.refund.execute')
  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: '환불 수동 완료 처리 — 무통장·수동 실행(MANUAL) 송금 대기 (PENDING → SUCCEEDED)' })
  async confirmManual(@Param('id') id: string) {
    try {
      return await this.refundsService.confirmManual(id);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|pending|status/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch(':id/kind')
  @ApiOperation({
    summary:
      '환불 종류 고치기 (admin) — null 은 «모름»으로 비우기. 변경 이력이 남는다. PG 로 다시 나갈 수 있는 행(AUTO PENDING·응답 끊긴 FAILED)은 409',
  })
  async changeKind(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: ChangeRefundKindDto) {
    const refund = await this.refundsService.changeKind(id, dto.kind, req.jwtUserId ?? 'admin');
    return toRefundResponse(refund);
  }
}
