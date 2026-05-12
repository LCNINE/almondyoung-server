import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CategoryTagGroupLinkDto } from './category-tag-group-link.dto';

export class ReplaceTagGroupLinksDto {
  @ApiProperty({
    description: '태그 그룹 연결 목록',
    type: [CategoryTagGroupLinkDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTagGroupLinkDto)
  links: CategoryTagGroupLinkDto[];
}
