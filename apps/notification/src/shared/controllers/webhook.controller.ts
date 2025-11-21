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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBody,
} from '@nestjs/swagger';
import { WebhookService } from '../services/webhook.service';
import { ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';

// Request 타입 확장
interface RequestWithRawBody extends Request {
  rawBody?: string;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) { }

  @Post('resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend 웹훅 처리',
    description: 'Resend 이메일 서비스의 웹훅 이벤트를 처리합니다.',
  })
  @ApiHeader({ name: 'svix-id', description: 'Svix ID', required: true })
  @ApiHeader({
    name: 'svix-timestamp',
    description: 'Svix 타임스탬프',
    required: true,
  })
  @ApiHeader({ name: 'svix-signature', description: 'Svix 서명', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'email.sent',
            'email.delivered',
            'email.delivery_delayed',
            'email.complained',
            'email.bounced',
            'email.opened',
            'email.clicked',
            'email.failed',
          ],
          example: 'email.sent',
        },
        created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:00:00Z' },
        data: {
          type: 'object',
          properties: {
            email_id: { type: 'string', example: 'em_12345' },
            from: { type: 'string', example: 'noreply@almondyoung.com' },
            to: {
              type: 'array',
              items: { type: 'string' },
              example: ['user@example.com'],
            },
            subject: { type: 'string', example: 'Welcome to AlmondYoung' },
            created_at: { type: 'string', format: 'date-time', example: '2024-01-15T10:00:00Z' },
            broadcast_id: { type: 'string', example: 'br_67890' },
            tags: {
              type: 'object',
              additionalProperties: { type: 'string' },
              example: { campaign: 'onboarding' },
            },
            bounce: {
              type: 'object',
              properties: {
                message: { type: 'string', example: 'Mailbox not found' },
                type: { type: 'string', enum: ['Permanent', 'Temporary'] },
                subType: { type: 'string', example: 'InvalidEmail' },
              },
            },
            click: {
              type: 'object',
              properties: {
                ipAddress: { type: 'string', example: '192.168.0.1' },
                link: { type: 'string', example: 'https://almondyoung.com/verify' },
                timestamp: { type: 'string', format: 'date-time' },
                userAgent: { type: 'string', example: 'Mozilla/5.0' },
              },
            },
          },
        },
      },
    },
  })

  @ApiResponse({ status: 200, description: '웹훅 처리 성공' })
  @ApiResponse({ status: 400, description: '잘못된 웹훅 헤더' })
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
  @ApiOperation({
    summary: 'Twilio 웹훅 처리',
    description: 'Twilio SMS 서비스의 웹훅 이벤트를 처리합니다.',
  })
  @ApiHeader({
    name: 'X-Twilio-Signature',
    description: 'Twilio 웹훅 서명 (프로덕션 환경 권장)',
    required: false,
  })
  @ApiBody({
    schema: {
      type: 'object',
      example: { MessageSid: 'SM123', MessageStatus: 'delivered', To: '+1234567890' },
      additionalProperties: true,
    },
  })
  @ApiResponse({ status: 200, description: '웹훅 처리 성공' })
  @ApiResponse({ status: 401, description: '웹훅 서명 검증 실패' })
  async handleTwilio(
    @Req() req: Request,
    @Body() data: any,
    @Headers('X-Twilio-Signature') signature?: string,
  ) {
    const requestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    await this.webhookService.handleTwilioWebhook(data, signature, requestUrl);
    return { received: true };
  }

  @Post('kakao')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Kakao 웹훅 처리',
    description: 'NHN KakaoTalk 알림톡 서비스의 웹훅 이벤트를 처리합니다.',
  })
  @ApiHeader({
    name: 'X-Toast-Webhook-Signature',
    description: 'NHN 웹훅 서명 (프로덕션 환경 필수)',
    required: false,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hooksId: { type: 'string', example: '202007271010101010sadasdavas' },
        webhookConfigId: { type: 'string' },
        productName: { type: 'string', example: 'KakaoTalk Bizmessage' },
        appKey: { type: 'string' },
        event: {
          type: 'string',
          enum: ['MESSAGE_RESULT_UPDATE', 'TEMPLATE_STATUS_UPDATE'],
          example: 'MESSAGE_RESULT_UPDATE',
        },
        hooks: {
          type: 'array',
          items: { type: 'object' },
        },
      },
      additionalProperties: true,
    },
  })
  @ApiResponse({ status: 200, description: '웹훅 처리 성공' })
  @ApiResponse({ status: 401, description: '웹훅 서명 검증 실패' })
  async handleKakao(
    @Req() req: RequestWithRawBody,
    @Body() body: any,
    @Headers('X-Toast-Webhook-Signature') signature?: string,
  ) {
    // Raw body가 있으면 string으로 사용, 없으면 parsed body 사용
    const payload = req.rawBody ? req.rawBody : body;

    await this.webhookService.handleKakaoWebhook(payload, signature);
    return { received: true };
  }
}
