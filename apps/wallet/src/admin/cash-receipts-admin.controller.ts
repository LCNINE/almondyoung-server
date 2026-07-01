import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import { CashReceiptResponseDto, IssueCashReceiptDto } from '../cash-receipts/dto';
import { CashReceipt } from '../types';

/**
 * 관리자용 현금영수증 API. 고객 셀프 발급(v1/cash-receipts)과 달리 소유권 스코프가 없어
 * 임의 주문에 대해 조회/발급할 수 있다. 발급 검증(결제완료·무통장·이중발급 방지)은 동일하게 적용됨.
 */
@ApiTags('Admin CashReceipts')
@WalletAdminAuth()
@Controller('v1/admin/cash-receipts')
export class CashReceiptsAdminController {
  constructor(private readonly service: CashReceiptsService) {}

  @Get()
  @ApiOperation({ summary: '주문의 현금영수증 조회 (관리자)' })
  async list(@Query('intentId') intentId: string): Promise<CashReceiptResponseDto[]> {
    const receipts = await this.service.findByIntentForAdmin(intentId);
    return receipts.map((r) => this.toResponse(r));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '현금영수증 발급 (관리자)' })
  async issue(@Body() dto: IssueCashReceiptDto): Promise<CashReceiptResponseDto> {
    const receipt = await this.service.issueAsAdmin(dto);
    return this.toResponse(receipt);
  }

  private toResponse(r: CashReceipt): CashReceiptResponseDto {
    return {
      id: r.id,
      intentId: r.intentId,
      type: r.type,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      receiptUrl: r.receiptUrl,
      issueNumber: r.issueNumber,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    };
  }
}
