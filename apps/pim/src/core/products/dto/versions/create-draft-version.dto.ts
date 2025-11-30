import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class CreateDraftVersionDto {
  @ApiProperty({
    description: '부모 버전 ID. 미제공 시 현재 active 버전을 부모로 사용',
    example: '01234567-89ab-cdef-0123-456789abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  parentVersionId?: string;

  @ApiProperty({
    description: '매핑 정보 복사 여부 (옵션, 품목, 가격정책)',
    default: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  copyMappings?: boolean;
}

