// apps/notification/src/provider/dto/update-provider.dto.ts
import { IsObject, IsOptional, IsBoolean, IsNumber, IsEnum } from 'class-validator';
import { ProviderStatus } from '../enums/provider-status.enum';

export class UpdateProviderDto {
    @IsObject()
    @IsOptional()
    config?: Record<string, any>;

    @IsEnum(ProviderStatus)
    @IsOptional()
    status?: ProviderStatus;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @IsNumber()
    @IsOptional()
    priority?: number;

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
            period: string;
        };
    };

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}
