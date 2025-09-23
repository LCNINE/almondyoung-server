// apps/notification/src/campaign/dto/campaign-filter.dto.ts
import { IsEnum, IsOptional } from 'class-validator';
import { CampaignStatus, NotificationCategory } from '../../shared/enums';

export class CampaignFilterDto {
    @IsEnum(CampaignStatus)
    @IsOptional()
    status?: CampaignStatus;

    @IsEnum(NotificationCategory)
    @IsOptional()
    category?: NotificationCategory;
}