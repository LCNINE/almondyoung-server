import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RefundsService } from './refunds.service';
import { CreateRefundDto, RefundResponseDto } from './dto';

@ApiTags('Refunds')
@Controller('v1/refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Issue a refund' })
  async create(@Body() dto: CreateRefundDto): Promise<RefundResponseDto> {
    const refund = await this.service.create(dto);
    return this.toResponse(refund);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a refund' })
  async findOne(@Param('id') id: string): Promise<RefundResponseDto> {
    const refund = await this.service.findByIdOrThrow(id);
    return this.toResponse(refund);
  }

  private toResponse(refund: {
    id: string;
    chargeId: string;
    intentId: string;
    status: string;
    amount: number;
    currency: string;
    reasonCode: string | null;
    reasonMessage: string | null;
    createdAt: Date;
  }): RefundResponseDto {
    return {
      id: refund.id,
      chargeId: refund.chargeId,
      intentId: refund.intentId,
      status: refund.status as any,
      amount: refund.amount,
      currency: refund.currency,
      reasonCode: refund.reasonCode,
      reasonMessage: refund.reasonMessage,
      createdAt: refund.createdAt,
      manualConfirmable: false,
    };
  }
}
