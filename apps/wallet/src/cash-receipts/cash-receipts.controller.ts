import { Body, Controller, Get, HttpCode, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { CashReceiptsService } from './cash-receipts.service';
import { CashReceiptResponseDto, IssueCashReceiptDto } from './dto';
import { CashReceipt } from '../types';

@ApiTags('CashReceipts')
@Controller('v1/cash-receipts')
export class CashReceiptsController {
  constructor(private readonly service: CashReceiptsService) {}

  @Post()
  @HttpCode(201)
  @WalletJwtAuth()
  @ApiOperation({ summary: '현금영수증 발급 (고객 셀프, JWT 쿠키 인증)' })
  async issue(@Req() req: AuthenticatedRequest, @Body() dto: IssueCashReceiptDto): Promise<CashReceiptResponseDto> {
    if (!req.jwtUserId) throw new UnauthorizedException('JWT authentication required');
    const receipt = await this.service.issue(dto, req.jwtUserId);
    return this.toResponse(receipt);
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: '주문의 현금영수증 조회' })
  async findByIntent(
    @Req() req: AuthenticatedRequest,
    @Query('intentId') intentId: string,
  ): Promise<CashReceiptResponseDto[]> {
    if (!req.jwtUserId) throw new UnauthorizedException('JWT authentication required');
    const receipts = await this.service.findByIntent(intentId, req.jwtUserId);
    return receipts.map((r) => this.toResponse(r));
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
