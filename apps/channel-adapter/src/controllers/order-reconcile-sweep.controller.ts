import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsString } from 'class-validator';
import { Public, ServiceKeyRoute } from '@app/authorization';
import { ChannelOrderReconcileService } from '../services/order-reconcile/channel-order-reconcile.service';
import { isSyncableChannel } from '../services/order-collection/syncable-channels';
import { errorMessage } from '../services/order-collection/order-processing-stage.error';

export class SweepBodyDto {
  @IsString()
  channel!: string;

  @IsISO8601()
  updatedAfter!: string;
}

@ApiTags('adapter-order-reconcile')
@ApiBearerAuth()
// 배포 직후 한 번 운영자가 부른다(스펙 §9). 사용자 JWT 가 없어 `ChannelOrderSyncController` 처럼 전역 가드를 면제하고
// **모든 핸들러가** verifyInternalKey 로 CHANNEL_ADAPTER_INTERNAL_KEY 를 검증한다.
@Public()
@ServiceKeyRoute()
@Controller('adapter/order-reconcile')
export class OrderReconcileSweepController {
  private readonly logger = new Logger(OrderReconcileSweepController.name);

  constructor(
    private readonly service: ChannelOrderReconcileService,
    private readonly configService: ConfigService,
  ) {}

  @Post('sweep')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '전체 기간 훑기 — 항상 관찰 모드, 다시 배달하지 않는다. 결과는 로그' })
  async sweep(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: SweepBodyDto,
  ): Promise<{ accepted: true }> {
    this.verifyInternalKey(authorization);
    const channel = body.channel;
    if (!isSyncableChannel(channel)) throw new BadRequestException(`Unsupported channel: ${channel}`);
    // ALB 유휴 제한(60초) 안에 끝나지 않을 수 있어 기다리지 않는다.
    void this.service
      .runCycle(channel, { updatedAfter: new Date(body.updatedAfter), now: new Date(), observeOnly: true })
      .then((report) => this.logger.log(`[${channel}] 처음 한 번 훑기 완료: ${JSON.stringify(report)}`))
      .catch((error: unknown) => this.logger.error(`[${channel}] 처음 한 번 훑기 실패: ${errorMessage(error)}`));
    return { accepted: true };
  }

  private verifyInternalKey(authorization: string | undefined): void {
    const internalKey = this.configService.get<string>('CHANNEL_ADAPTER_INTERNAL_KEY');
    if (!internalKey) throw new UnauthorizedException('Internal key not configured');
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== internalKey) throw new UnauthorizedException('Invalid internal key');
  }
}
