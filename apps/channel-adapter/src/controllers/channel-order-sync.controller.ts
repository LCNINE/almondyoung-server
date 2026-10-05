import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Public } from '@app/authorization';
import { OrderPollerOrchestrator, OrderSyncOutcome } from '../services/order-collection/order-poller.orchestrator';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';

export class SyncOrderBodyDto {
  @ApiPropertyOptional({ description: '해시가 같아도 OrderModified 를 낸다. 백필 전용' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('adapter-order-sync')
@ApiBearerAuth()
// 호출자는 운영 스크립트(백필)와, 나중에 운영자의 «채널 먼저» 흐름(#1016 35번 행)이라 사용자 JWT 가 없다.
// 전역 JwtAuthGuard 를 면제하는 대신 **모든 핸들러가** verifyInternalKey 로 CHANNEL_ADAPTER_INTERNAL_KEY 를
// 검증한다 — 핸들러를 더할 때 그 호출을 빠뜨리면 무인증으로 열린다.
@Public()
@Controller('adapter/orders')
export class ChannelOrderSyncController {
  private readonly logger = new Logger(ChannelOrderSyncController.name);

  constructor(
    private readonly orderPoller: OrderPollerOrchestrator,
    private readonly configService: ConfigService,
  ) {}

  @Post(':channel/:externalOrderId/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 주문 하나를 지금 다시 가져와 폴링과 같은 처리를 태운다 (#1016 5번 행)' })
  async sync(
    @Headers('authorization') authorization: string | undefined,
    @Param('channel') channel: string,
    @Param('externalOrderId') externalOrderId: string,
    @Body() body: SyncOrderBodyDto,
  ): Promise<{ outcome: Exclude<OrderSyncOutcome, 'channel_inactive'> }> {
    this.verifyInternalKey(authorization);
    if (!isSyncableChannel(channel)) {
      throw new BadRequestException(`Order sync is not supported for channel: ${channel}`);
    }
    const { outcome } = await this.orderPoller.syncOrder(channel, externalOrderId, { force: body?.force === true });
    if (outcome === 'channel_inactive') {
      throw new ConflictException(`Channel ${channel} is inactive (sales_channels.is_active=false)`);
    }
    return { outcome };
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
