import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { RefundsService } from '../services/refunds.service';
import { CreateRefundDto } from '../shared/dtos/refunds/create-refund.dto';
import { ApiOperation } from '@nestjs/swagger';
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @ApiOperation({ summary: '환불 생성' })
  @Post()
  @HttpCode(201)
  async createRefund(
    @Body() dto: CreateRefundDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    return this.refundsService.createRefund(dto, idemKey);
  }
}
