import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import type { AuthenticatedRequest } from '../wallet.module';
import { InvoiceStatus } from '../schema';
import { InvoiceQueryService, MyInvoiceView } from './invoice-query.service';
import { InvoiceExecutorService } from './invoice-executor.service';

/**
 * 고객(구독자) 인보이스 조회/재시도 API (JWT auth). userId 는 invoices 에 없으므로
 * billing_agreements(userId↔subscriber) 브리지로 소유권 스코프를 강제한다(IDOR 방지).
 * API-key 전용 InvoiceController(server-to-server)와 인증 모드를 분리한다.
 */
@ApiTags('Invoices')
@Controller('v1/me/invoices')
@WalletJwtAuth()
export class MyInvoiceController {
  constructor(
    private readonly invoiceQueryService: InvoiceQueryService,
    private readonly invoiceExecutorService: InvoiceExecutorService,
  ) {}

  @Get()
  @ApiOperation({ summary: '내 인보이스 목록 (구독자 본인)' })
  async list(@Req() req: AuthenticatedRequest, @Query('status') status?: string): Promise<MyInvoiceView[]> {
    const userId = req.jwtUserId!;
    return this.invoiceQueryService.findMineByUserId(userId, status ? (status as InvoiceStatus) : undefined);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: '내 미납 인보이스 즉시 재시도 (PAST_DUE 만)' })
  async retry(
    @Req() req: AuthenticatedRequest,
    @Param('id') invoiceId: string,
  ): Promise<{ invoiceId: string; retried: boolean }> {
    const userId = req.jwtUserId!;
    const owned = await this.invoiceQueryService.findOwnedInvoice(userId, invoiceId);
    if (!owned) throw new NotFoundException('인보이스를 찾을 수 없습니다.');
    // 심사대기(MANDATE_PENDING)·진행중(ATTEMPTING) 등은 고객이 재시도해도 소용없다 — 진짜 실패만 허용.
    if (owned.status !== 'PAST_DUE') {
      throw new BadRequestException('지금 재시도할 수 있는 상태가 아닙니다.');
    }
    await this.invoiceExecutorService.executeInvoiceById(invoiceId);
    return { invoiceId, retried: true };
  }
}
