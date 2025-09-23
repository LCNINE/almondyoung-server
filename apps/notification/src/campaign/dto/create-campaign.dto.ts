// apps/notification/src/campaign/dto/create-campaign.dto.ts
import { IsString, IsEnum, IsOptional, IsObject, IsDateString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';
import { TargetGroupDto } from './target-group.dto';

export class CreateCampaignDto {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsEnum(NotificationCategory)
    category: NotificationCategory; // 카테고리 필수

    @IsArray()
    @IsEnum(Channel, { each: true })
    channels: Channel[]; // 관리자가 선택한 채널들

    @IsString()
    @IsOptional()
    templateId?: string;

    @IsObject()
    @IsOptional()
    content?: Record<string, {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    }>;

    @IsDateString()
    @IsOptional()
    sendAt?: string;

    @IsEnum(NotificationPriority)
    @IsOptional()
    priority?: NotificationPriority;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;

    @IsString()
    createdBy: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TargetGroupDto)
    targetGroups: TargetGroupDto[];
}
