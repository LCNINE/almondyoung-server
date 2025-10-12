import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  UnifiedMasterWorkflow,
  UnifiedMasterInput,
} from '../workflows/unified-master.workflow';

@ApiTags('Workflows')
@Controller('workflows')
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(private readonly unifiedMasterWorkflow: UnifiedMasterWorkflow) {}

  @Post('unified-master')
  @ApiOperation({ summary: '통합 마스터 생성 (PIM + WMS)' })
  async createUnifiedMaster(@Body() input: UnifiedMasterInput) {
    this.logger.log(`📦 Unified Master Workflow 시작: ${input.name}`);

    try {
      const result =
        await this.unifiedMasterWorkflow.createUnifiedMaster(input);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('❌ Workflow 실패:', error);
      throw error;
    }
  }
}
