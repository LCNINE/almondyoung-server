// apps/notification/src/provider/factories/provider.factory.ts
import { DemoNotificationProvider } from '../providers/demo/demo.provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationProvider } from '../interfaces/notification-provider.interface';
import { ResendProvider } from '../providers/email/resend.provider';
import { NHNSmsProvider } from '../providers/sms/nhn-sms.provider';
import { NHNProvider } from '../providers/kakao/nhn.provider';
import { FCMProvider } from '../providers/push/fcm.provider';

@Injectable()
export class ProviderFactory {
  constructor(private readonly configService: ConfigService) {}

  create(providerName: string, providerId: string, config: Record<string, any>): NotificationProvider | null {
    if (this.configService.get<string>('APP_STAGE') === 'demo') {
      if (this.configService.get<string>('EXTERNAL_INTEGRATIONS_MODE') !== 'mock') {
        throw new Error('Demo notification requires mocked integrations');
      }
      return new DemoNotificationProvider(providerId, providerName);
    }
    const name = providerName.toLowerCase();

    // Resend Email Provider
    if (name.includes('resend')) {
      return new ResendProvider(providerId, config, this.configService);
    }

    // NHN Cloud SMS Provider — 알림톡 분기보다 **먼저** 검사해야 한다. 부분일치라 'NHN SMS' 가
    // `name.includes('nhn')` 에 먼저 걸리면 알림톡 프로바이더가 만들어진다.
    if (name.includes('nhn') && name.includes('sms')) {
      return new NHNSmsProvider(providerId, config, this.configService);
    }

    // NHN KakaoTalk Provider
    if (name.includes('nhn') || name.includes('kakao')) {
      return new NHNProvider(providerId, config, this.configService);
    }

    // Firebase FCM Push Provider
    if (name.includes('fcm')) {
      return new FCMProvider(providerId, config, this.configService);
    }

    return null;
  }
}
