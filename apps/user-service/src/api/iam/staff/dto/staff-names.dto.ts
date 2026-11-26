import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export const STAFF_NAMES_MAX_IDS = 100;

const splitIds = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : value;

export class StaffNamesQueryDto {
  @ApiProperty({ type: String, description: `직원 id 목록(콤마 구분, 최대 ${STAFF_NAMES_MAX_IDS}개)` })
  @Transform(splitIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STAFF_NAMES_MAX_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class StaffNameDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
