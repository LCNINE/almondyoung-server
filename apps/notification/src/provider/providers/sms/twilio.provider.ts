// apps/notification/src/provider/providers/sms/twilio.provider.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio = require('twilio');
import { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
import {
  NotificationProvider,
  NotificationMessage,
  NotificationResult,
  BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  fromNumber?: string;
  statusCallbackUrl?: string;
  useTestCredentials?: boolean;
}

interface TwilioMessageOptions {
  body: string;
  to: string;
  from?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
  validityPeriod?: number;
  maxPrice?: number;
  attemptCount?: number;
  smartEncoded?: boolean;
  shortenUrls?: boolean;
  sendAsMms?: boolean;
}

export class TwilioProvider implements NotificationProvider {
  private readonly logger: StructuredLogger;
  private readonly providerId: string;
  private readonly config: TwilioConfig;
  private readonly client: twilio.Twilio;
  private isHealthy: boolean = true;
  private lastHealthCheckTime: number = 0;
  private readonly healthCheckInterval = 60000; // 1분

  constructor(
    providerId: string,
    config: Record<string, any>,
    private readonly configService: ConfigService,
  ) {
    this.logger = new StructuredLogger(new Logger(TwilioProvider.name));
    this.providerId = providerId;

    // 설정 초기화 - DB config 우선, 없으면 환경변수
    this.config = {
      accountSid: config.accountSid || this.configService.get<string>('TWILIO_ACCOUNT_SID')!,
      authToken: config.authToken || this.configService.get<string>('TWILIO_AUTH_TOKEN')!,
      messagingServiceSid: config.messagingServiceSid || this.configService.get<string>('TWILIO_MESSAGING_SERVICE_SID'),
      fromNumber: config.fromNumber || this.configService.get<string>('TWILIO_FROM_NUMBER'),
      statusCallbackUrl: config.statusCallbackUrl || this.configService.get<string>('TWILIO_STATUS_CALLBACK_URL'),
      useTestCredentials: config.useTestCredentials || false,
    };

    // 필수 설정값 검증
    if (!this.config.accountSid) {
      throw new Error('TWILIO_ACCOUNT_SID is required');
    }
    if (!this.config.authToken) {
      throw new Error('TWILIO_AUTH_TOKEN is required');
    }

    // Twilio 클라이언트 초기화
    this.client = twilio(this.config.accountSid, this.config.authToken, {
      lazyLoading: true,
      autoRetry: true,
      maxRetries: 3,
    });

    this.logger.log('Twilio provider initialized', {
      accountSid: this.config.accountSid,
      fromNumber: this.config.fromNumber,
      messagingServiceSid: this.config.messagingServiceSid,
    });
  }

  getName(): string {
    return 'Twilio SMS';
  }

  getProviderId(): string {
    return this.providerId;
  }

  async isAvailable(): Promise<boolean> {
    // 캐싱된 헬스 체크 결과 사용
    const now = Date.now();
    if (now - this.lastHealthCheckTime < this.healthCheckInterval) {
      return this.isHealthy;
    }

    try {
      // 계정 정보 조회로 헬스체크
      const account = await this.client.api.accounts(this.config.accountSid).fetch();

      this.isHealthy = account.status === 'active';
      this.lastHealthCheckTime = now;

      if (!this.isHealthy) {
        this.logger.warn('Twilio account is not active', {
          status: account.status,
          friendlyName: account.friendlyName,
        });
      }

      return this.isHealthy;
    } catch (error: any) {
      this.logger.error('Health check failed', {
        error: error.message,
        code: error.code,
      });

      this.isHealthy = false;
      this.lastHealthCheckTime = now;
      return false;
    }
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const metadata = message.metadata || {};

      // 전화번호 포맷팅
      const toNumber = this.formatPhoneNumber(message.to);

      // Twilio 메시지 옵션 구성
      const messageOptions: TwilioMessageOptions = {
        body: message.content,
        to: toNumber,
      };

      // From 설정 (Messaging Service 또는 전화번호)
      if (this.config.messagingServiceSid) {
        messageOptions.messagingServiceSid = this.config.messagingServiceSid;
      } else {
        messageOptions.from = metadata.fromNumber || this.config.fromNumber;
      }

      // 콜백 URL 설정
      if (this.config.statusCallbackUrl) {
        messageOptions.statusCallback = this.config.statusCallbackUrl;
      }

      // 추가 옵션 설정
      if (metadata.validityPeriod) {
        messageOptions.validityPeriod = metadata.validityPeriod;
      }
      if (metadata.maxPrice) {
        messageOptions.maxPrice = metadata.maxPrice;
      }
      if (metadata.smartEncoded !== undefined) {
        messageOptions.smartEncoded = metadata.smartEncoded;
      }
      if (metadata.shortenUrls !== undefined && this.config.messagingServiceSid) {
        messageOptions.shortenUrls = metadata.shortenUrls;
      }
      if (metadata.sendAsMms !== undefined) {
        messageOptions.sendAsMms = metadata.sendAsMms;
      }

      // 메시지 발송
      const twilioMessage = await this.client.messages.create(messageOptions);

      this.logger.log('SMS sent successfully', {
        sid: twilioMessage.sid,
        to: twilioMessage.to,
        status: twilioMessage.status,
        segments: twilioMessage.numSegments,
        price: twilioMessage.price,
      });

      return {
        success: true,
        messageId: twilioMessage.sid,
        providerResponse: {
          sid: twilioMessage.sid,
          status: twilioMessage.status,
          dateSent: twilioMessage.dateSent,
          segments: twilioMessage.numSegments,
          price: twilioMessage.price,
          priceUnit: twilioMessage.priceUnit,
        },
      };
    } catch (error: any) {
      return this.handleError(error, message.to);
    }
  }

  async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
    const results: NotificationResult[] = [];
    const failures: Array<{ to: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    // Twilio는 개별 발송이 기본, Messaging Service 사용 시 자동 배치 처리
    // Rate limiting을 피하기 위해 병렬 처리 제한
    const BATCH_SIZE = 10; // 동시 발송 수 제한

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(batch.map((message) => this.send(message)));

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const sendResult = result.value;
          results.push(sendResult);

          if (sendResult.success) {
            successCount++;
          } else {
            failureCount++;
            failures.push({
              to: batch[index].to,
              error: sendResult.error || 'Unknown error',
            });
          }
        } else {
          failureCount++;
          failures.push({
            to: batch[index].to,
            error: result.reason?.message || 'Send failed',
          });
        }
      });

      // Rate limiting 회피를 위한 지연
      if (i + BATCH_SIZE < messages.length) {
        await this.delay(100); // 0.1초 대기
      }
    }

    return {
      successCount,
      failureCount,
      results: results.length > 0 ? results : undefined,
      failures: failures.length > 0 ? failures : undefined,
    };
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // 이미 E.164 형식인지 확인
    if (phoneNumber.startsWith('+')) {
      return phoneNumber;
    }

    // 한국 번호 처리
    const cleaned = phoneNumber.replace(/[^\d]/g, '');

    // 한국 번호를 국제 형식으로 변환
    if (cleaned.startsWith('010') || cleaned.startsWith('011')) {
      return '+82' + cleaned.substring(1);
    } else if (cleaned.startsWith('82')) {
      return '+' + cleaned;
    } else if (cleaned.length === 10 && cleaned.startsWith('10')) {
      // 010 없이 10으로 시작하는 경우
      return '+82' + cleaned;
    }

    // 미국 번호 (기본)
    if (cleaned.length === 10) {
      return '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return '+' + cleaned;
    }

    // 그 외의 경우 그대로 반환 (Twilio가 처리)
    return phoneNumber;
  }

  private handleError(error: any, to: string): NotificationResult {
    this.logger.error('Failed to send SMS', {
      to,
      error: error.message,
      code: error.code,
      moreInfo: error.moreInfo,
    });

    return {
      success: false,
      error: this.extractErrorMessage(error),
      providerResponse: {
        code: error.code,
        message: error.message,
        moreInfo: error.moreInfo,
        status: error.status,
      },
    };
  }

  private extractErrorMessage(error: any): string {
    // Twilio 에러 코드 매핑
    const errorMessages: Record<number, string> = {
      10002: 'Trial account restrictions - verify phone number',
      21211: 'Invalid phone number',
      21214: 'Phone number not verified for trial account',
      21408: 'Permission denied - number not owned by account',
      21610: 'Recipient opted out of messages',
      21614: 'Invalid mobile number',
      30003: 'Messaging Service not found',
      30004: 'Message blocked',
      30005: 'Unknown destination',
      30006: 'Landline or unreachable carrier',
      30007: 'Carrier violation',
      30008: 'Unknown error',
      30009: 'Missing required parameter',
      30034: 'Message price exceeds max price',
    };

    if (error.code && errorMessages[error.code]) {
      return errorMessages[error.code];
    }

    return error.message || 'Unknown error';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 추가 기능: 메시지 상태 조회
  async getMessageStatus(messageSid: string): Promise<any> {
    try {
      const message = await this.client.messages(messageSid).fetch();

      return {
        sid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        dateSent: message.dateSent,
        dateUpdated: message.dateUpdated,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
        price: message.price,
        priceUnit: message.priceUnit,
        numSegments: message.numSegments,
      };
    } catch (error: any) {
      this.logger.error('Failed to get message status', {
        messageSid,
        error: error.message,
      });
      throw error;
    }
  }

  // 추가 기능: 메시지 리스트 조회
  async listMessages(options?: {
    to?: string;
    from?: string;
    dateSent?: Date;
    limit?: number;
  }): Promise<MessageInstance[]> {
    try {
      const messages = await this.client.messages.list({
        to: options?.to,
        from: options?.from,
        dateSent: options?.dateSent,
        limit: options?.limit || 20,
      });

      return messages;
    } catch (error: any) {
      this.logger.error('Failed to list messages', {
        error: error.message,
      });
      throw error;
    }
  }

  // 추가 기능: 메시지 취소 (예약 메시지만 가능)
  async cancelMessage(messageSid: string): Promise<void> {
    try {
      await this.client.messages(messageSid).update({
        status: 'canceled',
      });

      this.logger.log('Message cancelled', { messageSid });
    } catch (error: any) {
      this.logger.error('Failed to cancel message', {
        messageSid,
        error: error.message,
      });
      throw error;
    }
  }

  // 추가 기능: 전화번호 검증
  async validatePhoneNumber(phoneNumber: string): Promise<{
    valid: boolean;
    phoneNumber?: string;
    countryCode?: string;
    nationalFormat?: string;
    carrier?: any;
  }> {
    try {
      const lookup = await this.client.lookups.v1.phoneNumbers(phoneNumber).fetch({ type: ['carrier'] });

      return {
        valid: true,
        phoneNumber: lookup.phoneNumber,
        countryCode: lookup.countryCode,
        nationalFormat: lookup.nationalFormat,
        carrier: lookup.carrier,
      };
    } catch (error: any) {
      this.logger.warn('Phone number validation failed', {
        phoneNumber,
        error: error.message,
      });

      return {
        valid: false,
      };
    }
  }
  // Twilio Verify 템플릿 관리 메서드들
  async getTemplates(): Promise<any[]> {
    try {
      const templates = await this.client.verify.v2.templates.list({ limit: 1000 });
      return templates.map((template) => ({
        sid: template.sid,
        friendlyName: template.friendlyName,
        channels: template.channels,
        translations: template.translations,
        status: template.translations?.en?.status || 'unknown',
      }));
    } catch (error: any) {
      this.logger.error('Failed to get Twilio templates', {
        error: error.message,
      });
      throw error;
    }
  }

  async createTemplate(templateData: { friendlyName: string; text: string; channels: string[] }): Promise<any> {
    try {
      // Twilio Verify 템플릿 생성은 별도 API가 필요
      // 여기서는 기본 템플릿 정보만 반환
      this.logger.info('Twilio template creation requested', {
        friendlyName: templateData.friendlyName,
        channels: templateData.channels,
      });

      return {
        message: 'Twilio template creation requires manual setup in Twilio Console',
        friendlyName: templateData.friendlyName,
        channels: templateData.channels,
        text: templateData.text,
      };
    } catch (error: any) {
      this.logger.error('Failed to create Twilio template', {
        error: error.message,
      });
      throw error;
    }
  }

  async getTemplateStatus(templateSid: string): Promise<any> {
    try {
      const templates = await this.getTemplates();
      const template = templates.find((t) => t.sid === templateSid);

      if (!template) {
        throw new Error(`Template ${templateSid} not found`);
      }

      return {
        sid: template.sid,
        status: template.status,
        friendlyName: template.friendlyName,
        channels: template.channels,
      };
    } catch (error: any) {
      this.logger.error('Failed to get template status', {
        templateSid,
        error: error.message,
      });
      throw error;
    }
  }

  getConfig(): TwilioConfig {
    return this.config;
  }
}
