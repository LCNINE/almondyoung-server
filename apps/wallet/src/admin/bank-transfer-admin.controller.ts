import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BankTransferAdminService } from './bank-transfer-admin.service';

class BankTransferConfirmDto {
  @ApiPropertyOptional({ description: 'Depositor name or note for identification', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  depositorNote?: string;
}

@ApiTags('Admin - Bank Transfer')
@Controller('v1/admin/payment-intents')
export class BankTransferAdminController {
  constructor(private readonly service: BankTransferAdminService) {}

  @Get('pending-bank-transfers')
  @ApiOperation({ summary: 'List payment intents awaiting bank transfer deposit confirmation' })
  async getPendingTransfers() {
    return this.service.getPendingTransfers();
  }

  @Post(':id/bank-transfer-confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm bank transfer deposit (admin)' })
  async confirmDeposit(
    @Param('id') id: string,
    @Body() dto: BankTransferConfirmDto,
  ) {
    await this.service.confirmDeposit(id, dto.depositorNote);
    return { status: 'SUCCEEDED' };
  }
}
