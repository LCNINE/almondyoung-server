// apps/notification/src/template/dto/preview-template.dto.ts
import { IsEnum, IsObject, IsArray } from 'class-validator';
import { Language, Channel } from '../../shared/enums';

export class PreviewTemplateDto {
    @IsArray()
    @IsEnum(Channel, { each: true })
    channels: Channel[]; // 미리보기할 채널들

    @IsEnum(Language)
    language: Language;

    @IsObject()
    payload: Record<string, any>;
}