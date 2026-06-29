import { Controller, Get, Post, Put, Body, Param, UsePipes } from '@nestjs/common';
import { User } from '@app/authorization';
import { InvoiceService } from '../services/invoice.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

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
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async issueInvoice(
    @Body(new ZodValidationPipe(IssueInvoiceSchema)) dto: z.infer<typeof IssueInvoiceSchema>,
    @User() user: AuthenticatedUser,
  ) {
    // 송장/라벨 발급 = 박스를 여는 행위 → 발급 작업자를 shipment.openedBy 로 캡처
    // (출고 종결 시 SHIP journal.actorId 로 귀속). @Body 스코프 파이프 — @User 는 검증 대상 아님.
    const invoiceId = await this.invoiceService.issueInvoice(dto, this.getUserId(user));
    return { invoiceId };
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }

  @Get(':id')
  async getInvoiceDetail(@Param('id') invoiceId: string) {
    return this.invoiceService.getInvoiceDetail(invoiceId);
  }

  @Post('print')
  @UsePipes(new ZodValidationPipe(PrintInvoicesSchema))
  async printInvoices(@Body() dto: z.infer<typeof PrintInvoicesSchema>) {
    return this.invoiceService.printInvoices(dto.invoiceIds);
  }

  @Put(':id/ship')
  async markAsShipped(@Param('id') invoiceId: string) {
    await this.invoiceService.markAsShipped(invoiceId);
    return { message: 'Invoice marked as shipped successfully' };
  }

  @Put(':id/cancel')
  async cancelInvoice(@Param('id') invoiceId: string) {
    await this.invoiceService.cancelInvoice(invoiceId);
    return { message: 'Invoice canceled successfully' };
  }

  @Get(':id/track')
  async trackInvoice(@Param('id') invoiceId: string) {
    return this.invoiceService.trackInvoice(invoiceId);
  }
}
