import {
  ConflictException,
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
import { AdminInvoiceListQueryDto, AdminRecurringBillingListQueryDto } from './dto/admin-recurring-billing.dto';
import { InvoiceExecutorService } from '../invoices/invoice-executor.service';

@ApiTags('Admin - Recurring Billing')
@WalletAdminAuth()
@Controller('v1/admin/recurring-billing')
export class RecurringBillingAdminController {
  constructor(
    private readonly service: RecurringBillingAdminService,
    private readonly invoiceExecutorService: InvoiceExecutorService,
  ) {}

  // 인보이스(미수금) 뷰 — 청구의 권위 상태 목록(ADR-0027 §8-2).
  @Get('invoices')
  @ApiOperation({ summary: 'List invoices (admin, ADR-0027)' })
  async listInvoices(@Query() query: AdminInvoiceListQueryDto) {
    return this.service.listInvoices(query);
  }

  // 인보이스 집행 수동 트리거 — due 스캔은 크론과 동일 경로, 단건은 관리자 수동 재시도.
  @Post('invoices/run-due')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run due-invoice executor scan now (admin)' })
  async runDueInvoices() {
    await this.invoiceExecutorService.run();
    return { message: 'invoice executor run completed' };
  }

  @Post('invoices/:id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute a single schedulable invoice now (admin)' })
  async executeInvoice(@Param('id') id: string) {
    try {
      await this.invoiceExecutorService.executeInvoiceById(id);
      return { message: 'invoice executed' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('not found')) throw new NotFoundException(msg);
      // 집행 가능 상태가 아님(이미 PAID/터미널/진행중 등) = 비즈니스 충돌이지 서버 오류가 아니다.
      if (msg.includes('not schedulable')) throw new ConflictException(msg);
      throw new InternalServerErrorException(msg);
    }
  }

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
