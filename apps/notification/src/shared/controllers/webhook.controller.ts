// apps/notification/src/shared/controllers/webhook.controller.ts
import {
    Controller,
    Post,
    Body,
    Headers,
    HttpCode,
    Req,
    BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookService } from '../services/webhook.service';
import { ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';

// Request 타입 확장
interface RequestWithRawBody extends Request {
    rawBody?: string;
}

@Controller('api/v1/webhooks')
export class WebhookController {
    constructor(private readonly webhookService: WebhookService) { }

    @Post('resend')
    @HttpCode(200)
    async handleResend(
        @Req() req: RequestWithRawBody,
        @Body() body: ResendWebhookEvent,
        @Headers('svix-id') svixId: string,
        @Headers('svix-timestamp') svixTimestamp: string,
        @Headers('svix-signature') svixSignature: string,
    ) {
        // Svix 헤더 확인
        if (!svixId || !svixTimestamp || !svixSignature) {
            throw new BadRequestException('Missing webhook headers');
        }

        const headers = {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        };

        // Raw body가 있으면 string으로 사용, 없으면 parsed body 사용
        const payload = req.rawBody ? req.rawBody : body;

        await this.webhookService.handleResendWebhook(payload, headers);

        return { received: true };
    }

    @Post('twilio')
    @HttpCode(200)
    async handleTwilio(@Body() data: any) {
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