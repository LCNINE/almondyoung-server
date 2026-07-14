import { Controller, Get, Post, Put, Body, Param, UseGuards, UsePipes } from '@nestjs/common';
import { RolesGuard } from '@app/authorization';
import { InvoiceService } from '../services/invoice.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';

const IssueInvoiceSchema = z.object({
  fulfillmentOrderId: z.string().uuid(),
  carrierCode: z.string(),
  recipientName: z.string(),
  recipientAddress: z.string(),
  recipientPhone: z.string(),
  senderName: z.string().optional(),
  senderPhone: z.string().optional(),
  deliveryMessage: z.string().optional(),
  // 미지정 시 서버가 결정: 한진 env 설정 전 goodsflow, 설정 후 hanjin (InvoiceService.defaultIssueMethod)
  issueMethod: z.enum(['goodsflow', 'hanjin', 'direct', 'self']).optional(),
  // direct(직접 입력) 발행 시 필수 — 택배사 발급 실제 운송장 번호
  invoiceNumber: z.string().min(1).optional(),
});

const PrintInvoicesSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1),
});

@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  @Post()
  async issueInvoice(@Body(new ZodValidationPipe(IssueInvoiceSchema)) dto: z.infer<typeof IssueInvoiceSchema>) {
    this.workflowGate.assertMutationAllowed('invoice.issue');
    // 선발급-only: 박스는 송장 스캔(openBoxByScan) 시점에 lazy 생성되므로 발급 작업자 캡처는 여기서 하지 않는다.
    const invoiceId = await this.invoiceService.issueInvoice(dto);
    return { invoiceId };
  }

  @Get(':id')
  async getInvoiceDetail(@Param('id') invoiceId: string) {
    return this.invoiceService.getInvoiceDetail(invoiceId);
  }

  @Post('print')
  @UsePipes(new ZodValidationPipe(PrintInvoicesSchema))
  async printInvoices(@Body() dto: z.infer<typeof PrintInvoicesSchema>) {
    this.workflowGate.assertMutationAllowed('invoice.print');
    return this.invoiceService.printInvoices(dto.invoiceIds);
  }

  @Put(':id/cancel')
  @UseGuards(RolesGuard('master', 'admin'))
  async cancelInvoice(@Param('id') invoiceId: string) {
    this.workflowGate.assertMutationAllowed('invoice.void');
    await this.invoiceService.cancelInvoice(invoiceId);
    return { message: 'Invoice canceled successfully' };
  }

  @Get(':id/track')
  async trackInvoice(@Param('id') invoiceId: string) {
    return this.invoiceService.trackInvoice(invoiceId);
  }
}
