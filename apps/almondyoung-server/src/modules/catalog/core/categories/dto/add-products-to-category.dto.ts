import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class AddProductsToCategoryDto {
  @ApiProperty({
    description: '추가할 상품 버전 ID 배열 (active 버전의 Version ID)',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  versionIds: string[];
}
