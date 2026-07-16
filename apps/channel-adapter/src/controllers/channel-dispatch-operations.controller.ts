import { Controller, Get, Headers, Logger, Param, ParseUUIDPipe, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ChannelDispatchOperationObservation,
  ShipmentDispatchInboxWorker,
} from '../services/shipment-dispatch-inbox.worker';

@ApiTags('internal-channel-dispatch-operations')
@ApiBearerAuth()
@Controller('internal/channel-dispatch-operations')
export class ChannelDispatchOperationsController {
  private readonly logger = new Logger(ChannelDispatchOperationsController.name);

  constructor(
    private readonly worker: ShipmentDispatchInboxWorker,
    private readonly configService: ConfigService,
  ) {}

  @Get('attempts/:dispatchAttemptId/orders/:salesOrderId')
  @ApiOperation({ summary: 'Inspect channel operations for one dispatch attempt and sales order' })
  @ApiParam({ name: 'dispatchAttemptId', description: 'Dispatch attempt UUID' })
  @ApiParam({ name: 'salesOrderId', description: 'Core sales order UUID' })
  @ApiOkResponse({ description: 'Pending, recovery, manual, and succeeded channel operation states' })
  async inspect(
    @Headers('authorization') authorization: string | undefined,
    @Param('dispatchAttemptId', new ParseUUIDPipe()) dispatchAttemptId: string,
    @Param('salesOrderId', new ParseUUIDPipe()) salesOrderId: string,
  ): Promise<{
    dispatchAttemptId: string;
    salesOrderId: string;
    operations: ChannelDispatchOperationObservation[];
  }> {
    this.verifyInternalKey(authorization);
    const operations = await this.worker.getOperationObservability(dispatchAttemptId, salesOrderId);
    return { dispatchAttemptId, salesOrderId, operations };
  }

  private verifyInternalKey(authorization: string | undefined): void {
    const internalKey = this.configService.get<string>('CHANNEL_ADAPTER_INTERNAL_KEY');
    if (!internalKey) {
      this.logger.error('CHANNEL_ADAPTER_INTERNAL_KEY is not configured.');
      throw new UnauthorizedException('Internal key not configured');
    }
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== internalKey) throw new UnauthorizedException('Invalid internal key');
  }
}
