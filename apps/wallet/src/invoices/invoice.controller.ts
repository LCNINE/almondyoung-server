import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceQueryService, InvoiceStatusView } from './invoice-query.service';

/**
 * 인보이스 조회 API (server-to-server, API key auth — 데코레이터 없음이 기본 API key 가드).
 * membership 이 결과 이벤트 유실 시 자기 소유 멱등키로 권위 상태를 되물어 정합화하는 경로.
 */
@ApiTags('Invoices')
@Controller('v1/invoices')
export class InvoiceController {
  constructor(private readonly invoiceQueryService: InvoiceQueryService) {}

  @Get('by-idempotency-key')
  @ApiOperation({ summary: 'Get authoritative invoice status by idempotency key (server-to-server, API key auth)' })
  async getByIdempotencyKey(@Query('key') key: string): Promise<InvoiceStatusView> {
    if (!key) throw new BadRequestException('key is required');
    const view = await this.invoiceQueryService.findByIdempotencyKey(key);
    if (!view) throw new NotFoundException(`Invoice not found for idempotencyKey: ${key}`);
    return view;
  }
}
