import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrderCollectionFailureService } from '../services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  OrderCollectionFailureReason,
} from '../services/order-collection/channel-order-provider.interface';
import { OrderCollectionFailureStatus } from '../types';

@ApiTags('adapter-order-collection-failures')
@Controller('adapter/order-collection-failures')
export class OrderCollectionFailuresController {
  constructor(
    private readonly failures: OrderCollectionFailureService,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  @Get()
  @ApiOperation({ summary: '격리된 주문 수집 실패 목록 조회' })
  @ApiQuery({ name: 'channel', required: false, example: 'medusa' })
  @ApiQuery({
    name: 'reason',
    required: false,
    enum: [CHANNEL_PRODUCT_IDENTIFICATION_FAILED, COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['quarantined', 'replayed'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async list(
    @Query('channel') channel?: string,
    @Query('reason') reason?: OrderCollectionFailureReason,
    @Query('status') status?: OrderCollectionFailureStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const data = await this.failures.list({
      channel,
      reason,
      status,
      limit: parseOptionalInt(limit),
      offset: parseOptionalInt(offset),
    });

    return {
      success: true,
      count: data.length,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '격리된 주문 수집 실패 상세 조회' })
  async inspect(@Param('id') id: string) {
    const failure = await this.failures.findById(id);
    if (!failure) {
      throw new NotFoundException(`Order collection failure not found: ${id}`);
    }

    return {
      success: true,
      data: failure,
      replayPath: {
        fix:
          failure.reason === CHANNEL_PRODUCT_IDENTIFICATION_FAILED
            ? 'Set pimVariantId on the affected Medusa variant metadata, then replay this failure.'
            : 'Collected Medusa order changes are not replayable. Handle this as a separate CS/order amendment workflow.',
        endpoint: `POST /adapter/order-collection-failures/${id}/replay`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/replay')
  @ApiOperation({ summary: '격리된 주문 수집 실패 재처리' })
  async replay(@Param('id') id: string) {
    const result = await this.orderPoller.replayFailure(id);
    if (!result) {
      throw new NotFoundException(`Order collection failure not found: ${id}`);
    }

    return {
      success: true,
      result,
      timestamp: new Date().toISOString(),
    };
  }
}

function parseOptionalInt(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
