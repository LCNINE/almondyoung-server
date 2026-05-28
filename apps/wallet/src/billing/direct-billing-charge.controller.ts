import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectBillingChargeService, DirectChargeResult } from './direct-billing-charge.service';
import { DirectBillingChargeDto } from './dto';

@ApiTags('Direct Billing Charges')
@Controller('v1/direct-billing-charges')
export class DirectBillingChargeController {
  constructor(private readonly service: DirectBillingChargeService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Charge with existing billing method immediately (server-to-server, API key auth)' })
  async charge(@Body() dto: DirectBillingChargeDto): Promise<DirectChargeResult> {
    try {
      return await this.service.charge({
        userId: dto.userId,
        billingMethodId: dto.billingMethodId,
        amount: dto.amount,
        currency: dto.currency ?? 'KRW',
        purpose: dto.purpose ?? 'SUBSCRIPTION',
        metadata: dto.metadata ?? {},
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
      });
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found') || msg.includes('inactive')) throw new NotFoundException(e.message);
      if (msg.includes('does not belong')) throw new ForbiddenException(e.message);
      if (msg.includes('처리 중')) throw new ConflictException(e.message);
      if (msg.match(/invalid|failed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
