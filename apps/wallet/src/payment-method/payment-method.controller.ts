import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { PaymentMethodService } from './services/payment-method.service';
import * as paymentMethodZod from '../shared/zod/payment-method.zod';
import { RegisterAgreementRequest } from 'hms-api-wrapper';
import { FileInterceptor } from '@nestjs/platform-express';
import { FastifyRequest } from 'fastify';
@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  /**
   * 결제수단 등록 (status=PENDING)
   */
  @Post()
  async create(@Body() dto: paymentMethodZod.Method['Create']) {
    return await this.paymentMethodService.create(dto);
  }

  /**
   * 결제수단 정보 수정 (methodName, isDefault 등)
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: paymentMethodZod.Method['Update'],
  ) {
    return await this.paymentMethodService.update(id, dto);
  }

  /**
   * 은행 인증 결과 콜백 (status ACTIVE | FAILED)
   */
  @Patch(':id/verify')
  async verify(
    @Param('id') id: string,
    @Body() dto: paymentMethodZod.Method['VerifyStatus'],
  ) {
    return await this.paymentMethodService.verifyStatus(id, dto.status);
  }

  @Post(':id/consent')
  async submitConsent(@Param('id') id: string, @Req() request: FastifyRequest) {
    const data = await request.file(); // fastify-multipart API

    // 파일 스트림(data.file), 파일명(data.filename) 사용 가능
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const buffer = Buffer.concat(chunks);

    return this.paymentMethodService.submitConsent({
      memberId: id,
      file: buffer,
      filename: data.filename,
    });
  }

  /**
   * 결제수단 비활성화 (소프트 삭제)
   */
  @Delete(':id')
  async deactivate(@Param('id') id: string) {
    return await this.paymentMethodService.deactivate(id);
  }
}
