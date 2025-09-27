// apps/notification/src/provider/dto/test-provider.dto.ts
import { IsString, IsObject, IsOptional, IsEnum } from 'class-validator';
import { Channel } from '../../shared/enums';

export class TestProviderDto {
    @IsString()
    providerId: string;

    @IsString()
    to: string; // Test recipient

    @IsString()
    @IsOptional()
    subject?: string;

    @IsString()
    content: string;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}

export class TestProviderResponseDto {
    providerId: string;
    providerName: string;
    channel: Channel;
    success: boolean;
    messageId?: string;
    error?: string;
    latencyMs: number;
    timestamp: Date;
    providerResponse?: any;
}