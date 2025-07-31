// apps/notification/src/template/dto/update-template.dto.ts
import { IsString, IsObject, IsOptional } from 'class-validator';

export class UpdateTemplateDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsObject()
    @IsOptional()
    contents?: Record<string, Record<string, {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    }>>;

    @IsObject()
    @IsOptional()
    variablesSchema?: Record<string, any>;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
}