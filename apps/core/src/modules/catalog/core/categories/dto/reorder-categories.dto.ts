import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsArray, IsUUID, ArrayNotEmpty } from 'class-validator';

export class ReorderCategoriesDto {
  @ApiPropertyOptional({
    description: '부모 카테고리 ID (null이면 루트 카테고리들의 순서 변경)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    description: '정렬할 카테고리 ID 배열 (순서대로)',
    type: [String],
    example: ['id1', 'id2', 'id3'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  categoryIds: string[];
}
