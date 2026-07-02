import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { RefundRequestsService } from '../refunds/refund-requests.service';
import { AdminPaymentIntentListQueryDto } from './dto';
import { RefundRequestActionDto } from '../refunds/dto';

@ApiTags('Admin - Refund Requests')
@WalletAdminAuth()
@Controller('v1/admin/refund-requests')
export class RefundRequestsAdminController {
  constructor(private readonly service: RefundRequestsService) {}

  @Get()
  @ApiOperation({ summary: '대기 중인 환불 요청 목록 (admin)' })
  async list(@Query() query: AdminPaymentIntentListQueryDto) {
    try {
      return await this.service.listPending(query.page, query.limit);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '환불 요청 승인 — 저장된 계좌로 자동 환불 실행 (admin)' })
  async approve(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RefundRequestActionDto) {
    try {
      return await this.service.approve(id, req.jwtUserId ?? 'admin', dto.adminNote);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|exceed|status|not_bank|not_refundable/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '환불 요청 거절 (admin)' })
  async reject(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() dto: RefundRequestActionDto) {
    try {
      return await this.service.reject(id, req.jwtUserId ?? 'admin', dto.adminNote);
    } catch (e: any) {
      if ((e?.message ?? '').toLowerCase().includes('not found')) throw new NotFoundException(e.message);
      if (e instanceof ConflictException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }
}
