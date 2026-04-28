import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetUsersQueryDto {
  @ApiPropertyOptional({
    description: '통합 검색어 (사용자명, 이메일, 로그인ID에서 검색)',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: '페이지 번호', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: '페이지당 아이템 수',
    minimum: 1,
    maximum: 1000,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    description: '역할 이름 필터 (예: admin, master, user)',
  })
  @IsOptional()
  @IsString()
  roleName?: string;

  @ApiPropertyOptional({
    description: '정렬 필드',
    enum: ['createdAt', 'username', 'email', 'lastActivityAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsEnum(['createdAt', 'username', 'email', 'lastActivityAt'])
  sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';

  @ApiPropertyOptional({
    description: '정렬 순서',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
