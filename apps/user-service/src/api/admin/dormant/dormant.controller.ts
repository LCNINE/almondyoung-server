import { RequirePermission } from '@app/authorization';
import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DormantService } from './dormant.service';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

@ApiTags('Admin/Dormant')
@ApiBearerAuth('access-token')
@ServedTenantData()
@Controller('admin/dormant')
export class DormantController {
  constructor(private readonly dormantService: DormantService) {}

  @ApiOperation({ summary: '휴면 계정 수동 처리' })
  @ApiResponse({ status: 200, description: '휴면 계정 처리 성공' })
  @RequirePermission('customer.dormant.execute')
  @Post('process')
  async processDormantAccounts() {
    return await this.dormantService.processDormantAccountsManually();
  }
}
