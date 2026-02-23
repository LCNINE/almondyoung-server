import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IntentsService } from './intents.service';
import { ApiWalletOkResponse } from '../common/decorators/api-wallet-response.decorator';
import { WalletErrorResponseDto } from '../common/dto/api-envelope.dto';
import { RefundRequestDetailResponseDto } from './dto/intents-response.dto';

@ApiTags('Wallet Refund Requests')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  description: 'JWT authentication required',
  type: WalletErrorResponseDto,
})
@Controller('v1/refund-requests')
export class RefundRequestsController {
  constructor(private readonly intentsService: IntentsService) {}

  @Get(':refundId')
  @ApiOperation({
    summary: 'Get refund request',
    description: 'Returns refund request details including allocations.',
  })
  @ApiParam({
    name: 'refundId',
    description: 'Refund request identifier',
  })
  @ApiWalletOkResponse(RefundRequestDetailResponseDto, {
    description: 'Refund request fetched',
  })
  @ApiNotFoundResponse({
    description: 'Refund request not found',
    type: WalletErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error',
    type: WalletErrorResponseDto,
  })
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
