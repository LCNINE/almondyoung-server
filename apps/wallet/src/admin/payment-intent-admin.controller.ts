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
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentIntentAdminService } from './payment-intent-admin.service';
import { BankTransferAdminService } from './bank-transfer-admin.service';
import { AdminPaymentIntentListQueryDto, PendingBankTransferListQueryDto } from './dto';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { PaymentIntentsService } from '../payment-intents/payment-intents.service';
import { RefundsService } from '../refunds/refunds.service';

class AdminRefundDto {
  @IsString()
  @IsNotEmpty()
  chargeId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  reasonCode?: string;

  @IsOptional()
  @IsString()
  reasonMessage?: string;
}

class AdminResolveDto {
  @IsEnum(['CAPTURED', 'CANCELED'])
  action: 'CAPTURED' | 'CANCELED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

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
@WalletAdminAuth()
@Controller('v1/admin/payment-intents')
export class PaymentIntentAdminController {
  constructor(
    private readonly service: PaymentIntentAdminService,
    private readonly bankTransferService: BankTransferAdminService,
    private readonly paymentIntentsService: PaymentIntentsService,
    private readonly refundsService: RefundsService,
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
      return await this.bankTransferService.getPendingTransfers(query.page, query.limit);
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
  async confirmDeposit(@Param('id') id: string, @Body() dto: BankTransferConfirmDto) {
    try {
      await this.bankTransferService.confirmDeposit(id, dto.depositorNote);
      return { status: 'CAPTURED' };
    } catch (e: any) {
      // 서비스가 던진 Nest 예외(404 NotFound / 422 Unprocessable 등)는 상태 코드를 보존해 그대로 전달한다.
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed|not allowed|transition|mismatch/))
        throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Capture a payment intent (admin)' })
  async capture(@Param('id') id: string) {
    try {
      await this.paymentIntentsService.capture(id);
      return { status: 'SUCCEEDED' };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a payment intent (admin)' })
  async cancel(@Param('id') id: string) {
    try {
      await this.paymentIntentsService.cancel(id);
      return { status: 'SUCCEEDED' };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resolve a PARTIALLY_CAPTURED payment intent (admin)',
    description: 'Manually transition a PARTIALLY_CAPTURED intent to CAPTURED or CANCELED.',
  })
  async resolve(@Param('id') id: string, @Body() dto: AdminResolveDto) {
    try {
      await this.service.resolvePartiallyCapture(id, dto.action, dto.reason);
      return { status: dto.action };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund a payment intent (admin)' })
  async refund(@Param('id') id: string, @Body() dto: AdminRefundDto) {
    try {
      const refund = await this.refundsService.create({
        chargeId: dto.chargeId,
        amount: dto.amount,
        intentId: id,
        reasonCode: dto.reasonCode,
        reasonMessage: dto.reasonMessage,
        allowMembershipRefund: true, // admin 환불은 정책상 멤버십 차단을 우회하는 강제 환불
      });
      return refund;
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
