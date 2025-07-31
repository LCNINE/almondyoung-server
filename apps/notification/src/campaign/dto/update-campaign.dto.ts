// apps/notification/src/campaign/dto/update-campaign.dto.ts
import { IsString, IsEnum, IsOptional, IsObject, IsDateString, IsNumber, IsArray } from 'class-validator';
import { Channel } from '../../shared/enums';

export class UpdateCampaignDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @IsEnum(Channel, { each: true })
    @IsOptional()
    channels?: Channel[];

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

    @IsNumber()
    @IsOptional()
    priority?: number;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}