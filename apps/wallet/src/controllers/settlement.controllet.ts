import { Body, Controller, Post } from '@nestjs/common';
import { SettlementService } from '../services/settlement.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettlementRunDto } from '../shared/dtos/payments/settlement-run.dto.ts';
@ApiTags('Settlement')
@Controller('settlements')
export class SettlementController {
  constructor(private readonly service: SettlementService) {}

  @Post('run')
  @ApiOperation({ summary: '정산 배치 실행 (MVP stub)' })
  async runBatch(@Body() dto: SettlementRunDto) {
    return this.service.runMonthlySettlement(dto);
  }
}
