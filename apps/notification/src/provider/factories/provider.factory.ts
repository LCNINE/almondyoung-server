// apps/notification/src/provider/factories/provider.factory.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationProvider } from '../interfaces/notification-provider.interface';
import { ResendProvider } from '../providers/email/resend.provider';
import { TwilioProvider } from '../providers/sms/twilio.provider';
import { NHNProvider } from '../providers/kakao/nhn.provider';
import { FCMProvider } from '../providers/push/fcm.provider';

@Injectable()
export class ProviderFactory {
    constructor(
        private readonly configService: ConfigService,
    ) { }

    create(
        providerName: string,
        providerId: string,
        config: Record<string, any>
    ): NotificationProvider | null {
        switch (providerName.toLowerCase()) {
            case 'resend':
                return new ResendProvider(providerId, config, this.configService);
            case 'twilio':
                return new TwilioProvider(providerId, config, this.configService);
            case 'kakao':
            case 'nhn-kakao':
            case 'nhn':
                return new NHNProvider(providerId, config, this.configService);
            case 'fcm':
                return new FCMProvider(providerId, config, this.configService);
            default:
                return null;
        }
    }
}