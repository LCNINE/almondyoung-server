import { Controller, HttpCode, Post, Req, UnauthorizedException, UseGuards, Headers } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { FastifyRequest } from 'fastify';
import { isValidSignature, SmsReceivedWebhook } from '../utils/inbound-sms';
import { InboundSmsManager } from '../services/inbound-sms.manager';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';

@ApiTags('sms-gate')
@Public()
@Controller('sms-gate/webhooks')
@UseGuards(SmsGateEnabledGuard)
export class SmsGateWebhookController {
  constructor(
    private readonly inbound: InboundSmsManager,
    private readonly configService: ConfigService,
  ) {}

  @Post('received')
  @HttpCode(200)
  async received(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-signature') signature?: string,
    @Headers('x-timestamp') timestamp?: string,
  ) {
    this.verify(req.rawBody, timestamp, signature);
    await this.inbound.handleReceived(req.body as SmsReceivedWebhook);
    return { success: true };
  }

  private verify(rawBody: Buffer | undefined, timestamp?: string, signature?: string): void {
    const key = this.configService.get<string>('SMS_GATE_WEBHOOK_SIGNING_KEY');
    if (!key) {
      if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('웹훅 서명키가 설정되지 않았습니다');
      return;
    }
    if (!rawBody || !isValidSignature(key, rawBody, timestamp, signature)) {
      throw new UnauthorizedException('웹훅 서명 검증에 실패했습니다');
    }
  }
}
