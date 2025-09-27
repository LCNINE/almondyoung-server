// apps/notification/src/template/dto/template-filter.dto.ts
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class TemplateFilterDto {
    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    isActive?: boolean;
}