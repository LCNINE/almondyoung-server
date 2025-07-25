import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceSessionService } from './invoice-session.service';

import * as invoiceZod from '../shared/zod/invoice.zod';
@Controller('invoices')
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceSessionService: InvoiceSessionService,
  ) {}

  @Post()
  create(@Body() createInvoiceDto: invoiceZod.Invoice['Create']) {
    return this.invoiceService.create(createInvoiceDto);
  }

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('status') status?: invoiceZod.Invoice['Select']['status'],
  ) {
    return this.invoiceService.findAll(userId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoiceService.findOne(id);
  }

  @Get(':id/events')
  getInvoiceEvents(@Param('id') id: string) {
    return this.invoiceService.getInvoiceEvents(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: string,
    @Body() updateInvoiceStatusDto: invoiceZod.Invoice['UpdateStatus'],
  ) {
    return this.invoiceService.updateStatus(id, updateInvoiceStatusDto);
  }

  /**
   * 청구서 세션 생성 엔드포인트
   * 동시성 제어를 통한 중복 결제 방지
   */
  @Post(':id/create-session')
  @HttpCode(HttpStatus.CREATED)
  async createInvoiceSession(
    @Param('id') invoiceId: string,
    @Body() body: { userId: string }, // 실제 구현에서는 JWT에서 추출
  ) {
    this.logger.log(
      `청구서 세션 생성 요청: Invoice ${invoiceId}, User ${body.userId}`,
    );

    try {
      const sessionResult =
        await this.invoiceSessionService.createInvoiceSession(
          invoiceId,
          body.userId,
        );

      this.logger.log(
        `청구서 세션 생성 성공: ${sessionResult.invoiceSessionId}`,
      );

      return {
        success: true,
        data: {
          invoiceId,
          invoiceSessionId: sessionResult.invoiceSessionId,
          expiresAt: sessionResult.expiresAt,
          message:
            '청구서 세션이 생성되었습니다. 15분 내에 결제를 완료해주세요.',
        },
      };
    } catch (error) {
      this.logger.error(`청구서 세션 생성 실패: ${error.message}`);
      throw error;
    }
  }
}
