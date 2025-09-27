// apps/notification/src/provider/dto/provider-filter.dto.ts
import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { Channel } from '../../shared/enums';
import { ProviderStatus } from '../enums/provider-status.enum';

export class ProviderFilterDto {
    @IsEnum(Channel)
    @IsOptional()
    channel?: Channel;

    @IsEnum(ProviderStatus)
    @IsOptional()
    status?: ProviderStatus;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    isActive?: boolean;

    @IsOptional()
    providerName?: string;
}