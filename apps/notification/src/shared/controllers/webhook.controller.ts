// apps/notification/src/shared/controllers/webhook.controller.ts
import {
    Controller,
    Post,
    Body,
    Param,
    Headers,
    HttpCode,
    Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookService } from '../services/webhook.service';
import { ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';

@Controller('api/v1/webhooks')
export class WebhookController {
    constructor(private readonly webhookService: WebhookService) { }

    @Post('resend')
    @HttpCode(200)
    async handleResend(
        @Body() event: ResendWebhookEvent,
    ) {
        await this.webhookService.handleResendWebhook(event);
        return { received: true };
    }

    @Post('twilio')
    @HttpCode(200)
    async handleTwilio(
        @Body() data: any,
    ) {
        await this.webhookService.handleTwilioWebhook(data);
        return { received: true };
    }

    @Post('kakao')
    @HttpCode(200)
    async handleKakao(@Body() data: any) {
        await this.webhookService.handleKakaoWebhook(data);
        return { received: true };
    }
}