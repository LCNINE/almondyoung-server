import {
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { RecurringBillingAdminService } from './recurring-billing-admin.service';
import { AdminRecurringBillingListQueryDto } from './dto/admin-recurring-billing.dto';

@ApiTags('Admin - Recurring Billing')
@WalletAdminAuth()
@Controller('v1/admin/recurring-billing')
export class RecurringBillingAdminController {
  constructor(private readonly service: RecurringBillingAdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get recurring billing overview counts (admin)' })
  async getOverview() {
    return this.service.getOverview();
  }

  @Get('items')
  @ApiOperation({
    summary: 'List recurring billing items by view (needs-action | members | withdrawals | contracts)',
  })
  async listItems(@Query() query: AdminRecurringBillingListQueryDto) {
    return this.service.listItems(query);
  }

  @Post('providers/cms/members/:id/poll')
  @HttpCode(200)
  @ApiOperation({ summary: 'Poll CMS member registration status from provider (admin)' })
  async pollMember(@Param('id') id: string) {
    try {
      return await this.service.pollMember(id);
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(err instanceof Error ? err.message : msg);
      throw new InternalServerErrorException(err instanceof Error ? err.message : msg);
    }
  }

  @Post('providers/cms/withdrawals/:id/poll')
  @HttpCode(200)
  @ApiOperation({ summary: 'Poll CMS withdrawal settlement status from provider (admin)' })
  async pollWithdrawal(@Param('id') id: string) {
    try {
      return await this.service.pollWithdrawal(id);
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(err instanceof Error ? err.message : msg);
      throw new InternalServerErrorException(err instanceof Error ? err.message : msg);
    }
  }

  @Get('agreement-state-by-refs')
  @ApiOperation({ summary: '계약 ID 목록으로 결제 계약 상태 일괄 조회' })
  async getAgreementStateByRefs(@Query('refs') refs: string | string[] | undefined) {
    const subscriberRefs = refs ? (Array.isArray(refs) ? refs : [refs]) : [];
    return this.service.getAgreementStateByRefs(subscriberRefs);
  }
}
