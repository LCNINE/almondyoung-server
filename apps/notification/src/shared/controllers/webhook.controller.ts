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
  @Controller('api/v1/webhooks')
  export class WebhookController {
    constructor(private readonly webhookService: WebhookService) {}
  
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
    @ApiBody({
      schema: {
        type: 'object',
        example: { message: 'hello', status: 'sent' },
        additionalProperties: true, // 👈 Swagger 스키마 에러 방지
      },
    })
    @ApiResponse({ status: 200, description: '웹훅 처리 성공' })
    async handleTwilio(@Body() data: any) {
      await this.webhookService.handleTwilioWebhook(data);
      return { received: true };
    }
  
    @Post('kakao')
    @HttpCode(200)
    @ApiOperation({
      summary: 'Kakao 웹훅 처리',
      description: 'Kakao 알림톡 서비스의 웹훅 이벤트를 처리합니다.',
    })
    @ApiBody({
        schema: {
          type: 'object',
          example: { message: 'hello', status: 'sent' },
          additionalProperties: true, // <- schema 안에 쓰면 가능
        },
      })
              
    @ApiResponse({ status: 200, description: '웹훅 처리 성공' })
    async handleKakao(@Body() data: any) {
      await this.webhookService.handleKakaoWebhook(data);
      return { received: true };
    }
  }
  