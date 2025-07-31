// apps/notification/src/dispatcher/dto/send-notification.dto.ts
import { IsString, IsEnum, IsOptional, IsObject, IsDateString, IsArray } from 'class-validator';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';

export class SendNotificationDto {
    @IsString()
    userId: string;

    @IsArray()
    @IsEnum(Channel, { each: true })
    channels: Channel[];

    @IsEnum(NotificationCategory)
    category: NotificationCategory; // 카테고리 필수

    @IsString()
    @IsOptional()
    templateKey?: string;

    @IsString()
    @IsOptional()
    eventKey?: string;

    @IsObject()
    @IsOptional()
    content?: Record<string, {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    }>;

    @IsObject()
    @IsOptional()
    payload?: Record<string, any>;

    @IsString()
    @IsOptional()
    correlationId?: string;

    @IsDateString()
    @IsOptional()
    sendAt?: string;

    @IsEnum(NotificationPriority)
    @IsOptional()
    priority?: NotificationPriority;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}