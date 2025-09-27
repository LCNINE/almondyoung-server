// apps/notification/src/provider/dto/create-provider.dto.ts
import { IsString, IsEnum, IsObject, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { Channel } from '../../shared/enums';

export class CreateProviderDto {
    @IsEnum(Channel)
    channel: Channel;

    @IsString()
    providerName: string; // 'sendgrid', 'twilio', 'kakao', 'fcm'

    @IsObject()
    config: Record<string, any>; // Provider-specific configuration

    @IsBoolean()
    @IsOptional()
    isActive?: boolean = true;

    @IsNumber()
    @IsOptional()
    priority?: number = 0; // Higher priority = preferred provider

    @IsObject()
    @IsOptional()
    capabilities?: {
        bulkSend?: boolean;
        scheduling?: boolean;
        tracking?: boolean;
        templating?: boolean;
        personalization?: boolean;
        maxRecipientsPerRequest?: number;
        rateLimit?: {
            requests: number;
            period: string; // '1m', '1h', '1d'
        };
    };

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}