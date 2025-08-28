import { AuthorizationGuard, RequireScopes } from '@app/roles';
import { Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'apps/user-service/src/commons/guards/jwt-auth.guard';
import { DormantService } from './dormant.service';

@ApiTags('Admin/Dormant')
@ApiBearerAuth('access-token')
@Controller('admin/dormant')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class DormantController {
  constructor(private readonly dormantService: DormantService) {}

  @ApiOperation({ summary: '휴면 계정 수동 처리' })
  @ApiResponse({ status: 200, description: '휴면 계정 처리 성공' })
  @Post('process')
  @RequireScopes(['master'])
  async processDormantAccounts() {
    return await this.dormantService.processDormantAccountsManually();
  }
}
