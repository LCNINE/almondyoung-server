import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentIntentAdminService } from './payment-intent-admin.service';
import { BankTransferAdminService } from './bank-transfer-admin.service';
import {
  AdminPaymentIntentListQueryDto,
  PendingBankTransferListQueryDto,
} from './dto';

class BankTransferConfirmDto {
  @ApiPropertyOptional({
    description: 'Depositor name or note for identification',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  depositorNote?: string;
}

@ApiTags('Admin - Payment Intents')
@Controller('v1/admin/payment-intents')
export class PaymentIntentAdminController {
  constructor(
    private readonly service: PaymentIntentAdminService,
    private readonly bankTransferService: BankTransferAdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List payment intents (admin, paginated)' })
  async list(@Query() query: AdminPaymentIntentListQueryDto) {
    try {
      return await this.service.listPaymentIntents(query);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('pending-bank-transfers')
  @ApiOperation({
    summary: 'List payment intents awaiting bank transfer deposit confirmation',
  })
  async getPendingTransfers(@Query() query: PendingBankTransferListQueryDto) {
    try {
      return await this.bankTransferService.getPendingTransfers(
        query.page,
        query.limit,
      );
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment intent detail (admin)' })
  async getDetail(@Param('id') id: string) {
    try {
      return await this.service.getPaymentIntentDetail(id);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get(':id/state-transitions')
  @ApiOperation({
    summary: 'Get state transition history for a payment intent',
  })
  async getStateTransitions(@Param('id') id: string) {
    try {
      return await this.service.getStateTransitions(id);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/bank-transfer-confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm bank transfer deposit (admin)' })
  async confirmDeposit(
    @Param('id') id: string,
    @Body() dto: BankTransferConfirmDto,
  ) {
    try {
      await this.bankTransferService.confirmDeposit(id, dto.depositorNote);
      return { status: 'SUCCEEDED' };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/))
        throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
