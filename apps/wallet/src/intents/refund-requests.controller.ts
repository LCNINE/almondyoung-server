import { Controller, Get, Param } from '@nestjs/common';
import { IntentsService } from './intents.service';

@Controller('v1/refund-requests')
export class RefundRequestsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Get(':refundId')
  async getRefundRequest(@Param('refundId') refundId: string) {
    const data = await this.intentsService.getRefundRequest(refundId);
    return {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }
}
