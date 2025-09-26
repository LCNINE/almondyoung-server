import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  Channel,
  NotificationCategory,
  NotificationPriority,
} from '../../shared/enums'; // Adjust path as needed

class AudienceDto {
  @IsEnum(['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'])
  kind: 'ALL_USERS' | 'SELECTED_USERS' | 'FILTERED_USERS';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsObject()
  criteria?: Record<string, any>; // e.g., { membershipType: 'premium', shopCategories: ['fashion'] }
}

class ContentDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreateBulkNotificationDto {
  @IsString()
  @IsNotEmpty()
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
  templateKey?: string; // If using a predefined template

  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => ContentDto)
  content: { [key in Channel]?: ContentDto }; // Direct content for each channel

  @IsOptional()
  @IsString()
  sendAt?: string; // ISO date string for scheduling

  @ValidateNested()
  @Type(() => AudienceDto)
  audience: AudienceDto;

  @IsEnum(NotificationPriority)
  priority: NotificationPriority;

  @IsString()
  createdBy: string;
}
