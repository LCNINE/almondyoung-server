// apps/notification/src/provider/dto/provider-config.dto.ts
import { IsString, IsObject, IsOptional, IsNumber, IsBoolean } from 'class-validator';

// Base configuration that all providers share
export class BaseProviderConfigDto {
    @IsBoolean()
    @IsOptional()
    sandbox?: boolean = false;

    @IsNumber()
    @IsOptional()
    timeout?: number = 30000; // 30 seconds

    @IsNumber()
    @IsOptional()
    retryAttempts?: number = 3;

    @IsObject()
    @IsOptional()
    headers?: Record<string, string>;
}

// Email Provider Configuration
export class EmailProviderConfigDto extends BaseProviderConfigDto {
    @IsString()
    apiKey: string;

    @IsString()
    fromEmail: string;

    @IsString()
    @IsOptional()
    fromName?: string;

    @IsString()
    @IsOptional()
    replyToEmail?: string;

    @IsObject()
    @IsOptional()
    defaultTags?: Record<string, string>;

    @IsBoolean()
    @IsOptional()
    trackOpens?: boolean = true;

    @IsBoolean()
    @IsOptional()
    trackClicks?: boolean = true;
}

// SMS Provider Configuration
export class SmsProviderConfigDto extends BaseProviderConfigDto {
    @IsString()
    accountSid?: string; // For Twilio

    @IsString()
    authToken?: string; // For Twilio

    @IsString()
    @IsOptional()
    apiKey?: string; // For other providers

    @IsString()
    @IsOptional()
    apiSecret?: string; // For other providers

    @IsString()
    fromNumber: string;

    @IsString()
    @IsOptional()
    messagingServiceSid?: string; // For Twilio

    @IsBoolean()
    @IsOptional()
    enableDeliveryReports?: boolean = true;
}

// Kakao Provider Configuration
export class KakaoProviderConfigDto extends BaseProviderConfigDto {
    @IsString()
    apiKey: string;

    @IsString()
    senderKey: string;

    @IsString()
    plusFriendId: string;

    @IsString()
    @IsOptional()
    appKey?: string;

    @IsString()
    @IsOptional()
    secretKey?: string;

    @IsBoolean()
    @IsOptional()
    useTemplateCode?: boolean = true;
}

// Push Provider Configuration
export class PushProviderConfigDto extends BaseProviderConfigDto {
    @IsObject()
    @IsOptional()
    firebaseServiceAccount?: any; // For FCM

    @IsString()
    @IsOptional()
    serverKey?: string; // Legacy FCM

    @IsString()
    @IsOptional()
    senderId?: string;

    @IsString()
    @IsOptional()
    projectId?: string;

    @IsObject()
    @IsOptional()
    apns?: {
        teamId: string;
        keyId: string;
        bundleId: string;
        production: boolean;
        privateKey: string;
    };

    @IsObject()
    @IsOptional()
    defaultOptions?: {
        priority?: 'high' | 'normal';
        ttl?: number;
        collapseKey?: string;
    };
}
