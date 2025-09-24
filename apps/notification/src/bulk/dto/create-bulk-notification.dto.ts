// apps/notification/src/bulk/dto/create-bulk-notification.dto.ts
import { IsString, IsArray, IsEnum, IsOptional, IsObject, ValidateNested, IsDateString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationCategory, NotificationPriority, Channel } from '../../shared/enums';

export class AudienceCriteria {
  @IsOptional()
  @IsString()
  membershipType?: 'general' | 'premium';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shopCategories?: string[];

  @IsOptional()
  @IsBoolean()
  isMarketingEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}

export class BulkAudience {
  @IsEnum(['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'])
  kind: 'ALL_USERS' | 'SELECTED_USERS' | 'FILTERED_USERS';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceCriteria)
  criteria?: AudienceCriteria;
}

export class ChannelContent {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class BulkContent {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelContent)
  EMAIL?: ChannelContent;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelContent)
  SMS?: ChannelContent;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelContent)
  KAKAO?: ChannelContent;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelContent)
  PUSH?: ChannelContent;
}

export class CreateBulkNotificationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @IsArray()
  @IsEnum(Channel, { each: true })
  channels: Channel[];

  @IsOptional()
  @IsString()
  templateKey?: string;

  @ValidateNested()
  @Type(() => BulkContent)
  content: BulkContent;

  @ValidateNested()
  @Type(() => BulkAudience)
  audience: BulkAudience;

  @IsOptional()
  @IsDateString()
  sendAt?: string;

  @IsEnum(NotificationPriority)
  priority: NotificationPriority;

  @IsString()
  createdBy: string;
}
