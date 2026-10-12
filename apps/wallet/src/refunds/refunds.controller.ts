import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RefundsService } from './refunds.service';
import { CreateRefundDto, RefundResponseDto } from './dto';
import { toRefundResponse } from './refund-response';

@ApiTags('Refunds')
@Controller('v1/refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Issue a refund' })
  async create(@Body() dto: CreateRefundDto): Promise<RefundResponseDto> {
    const refund = await this.service.create(dto);
    return toRefundResponse(refund);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a refund' })
  async findOne(@Param('id') id: string): Promise<RefundResponseDto> {
    const refund = await this.service.findByIdOrThrow(id);
    return toRefundResponse(refund);
  }
}
