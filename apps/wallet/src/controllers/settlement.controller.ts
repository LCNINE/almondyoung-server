import { Controller, Post, Get, Param, Logger, Body } from '@nestjs/common';
import { SettlementService } from '../services/settlement.service';
import { ApiOperation, ApiTags, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('정산 관리')
@Controller('settlement')
export class SettlementController {
  private readonly logger = new Logger(SettlementController.name);

  constructor(private readonly service: SettlementService) {}

  @Post('run-monthly')
  @ApiOperation({
    summary: '월별 정산 실행 (KST 기준)',
    description:
      'AUTHORIZED 상태의 PaymentEvent를 BatchCMS 출금하여 CAPTURED로 변경',
  })
  async runMonthlySettlement() {
    this.logger.log('월별 정산 배치 실행 요청');
    return await this.service.runMonthlySettlement();
  }

  @Get('batches/:batchId/status')
  @ApiOperation({ summary: '정산 배치 상태 조회' })
  @ApiParam({ name: 'batchId', description: '배치 ID' })
  async getBatchStatus(@Param('batchId') batchId: string) {
    this.logger.log(`정산 배치 상태 조회: ${batchId}`);
    return await this.service.getBatchStatus(batchId);
  }

  @Post('batches/:batchId/retry')
  @ApiOperation({
    summary: '실패한 정산 배치 재시도 (수동 검토 대상 분류)',
    description:
      '최대 3회까지 재시도, 초과 시 수동 검토 대상으로 분류 (PaymentSession은 AUTHORIZED 유지)',
  })
  @ApiParam({ name: 'batchId', description: '재시도할 배치 ID' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        maxRetries: {
          type: 'number',
          description: '최대 재시도 횟수 (기본: 3)',
        },
      },
    },
  })
  async retryFailedBatch(
    @Param('batchId') batchId: string,
    @Body() body?: { maxRetries?: number },
  ) {
    this.logger.log(`정산 배치 재시도 요청: ${batchId}`);
    return await this.service.retryFailedSettlement(batchId, body?.maxRetries);
  }

  @Post('retry-all-failed')
  @ApiOperation({
    summary: '모든 실패한 배치 일괄 재시도',
    description: '수동 검토 대상 분류를 위한 대량 재시도',
  })
  async retryAllFailedBatches() {
    this.logger.log('모든 실패한 배치 일괄 재시도 요청');
    return await this.service.retryAllFailedBatches();
  }
}
