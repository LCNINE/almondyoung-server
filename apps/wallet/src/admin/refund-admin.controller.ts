import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentIntentAdminService } from './payment-intent-admin.service';
import { AdminRefundListQueryDto } from './dto';
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
}
