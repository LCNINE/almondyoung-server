// apps/notification/src/template/dto/create-template.dto.ts
import { IsString, IsObject, IsOptional, IsEnum } from 'class-validator';
import { NotificationCategory } from '../../shared/enums';

export class CreateTemplateDto {
    @IsString()
    templateKey: string;

    @IsString()
    name: string;

    @IsEnum(NotificationCategory)
    category: NotificationCategory; // 카테고리 필수

    @IsObject()
    contents: Record<string, Record<string, {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    }>>;

    @IsObject()
    variablesSchema: Record<string, any>;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}