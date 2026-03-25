// apps/notification/src/template/dto/template-filter.dto.ts
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TemplateFilterDto {
  @ApiPropertyOptional({
    description: '활성화 상태 필터',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean;
}
