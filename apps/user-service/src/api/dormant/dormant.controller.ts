import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DormantService } from './dormant.service';

@ApiTags('휴면계정')
@Controller('dormant')
export class DormantController {
  constructor(private readonly dormantService: DormantService) {}

  @ApiOperation({ summary: '휴면 계정 수동 처리' })
  @ApiResponse({ status: 200, description: '휴면 계정 처리 성공' })
  @Post('process')
  async processDormantAccounts() {
    return await this.dormantService.processDormantAccountsManually();
  }
}
