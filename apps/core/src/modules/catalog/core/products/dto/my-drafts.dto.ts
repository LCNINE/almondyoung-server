import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto';

export class ListMyDraftsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '상품명 검색 키워드 (부분 일치)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['updatedAt', 'createdAt'], description: '정렬 기준 (기본 updatedAt)' })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt'])
  sort?: 'updatedAt' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '정렬 방향 (기본 desc)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class MyDraftListItemDto {
  @ApiProperty() masterId: string;
  @ApiProperty() versionId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) thumbnail: string | null;
  @ApiProperty({ type: String, nullable: true }) brand: string | null;
  @ApiProperty() productType: string;
  @ApiProperty({ enum: ['draft'] }) status: 'draft';
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
