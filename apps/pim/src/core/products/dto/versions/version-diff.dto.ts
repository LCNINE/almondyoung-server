import { ApiProperty } from '@nestjs/swagger';

export class VersionDiffItemDto {
  @ApiProperty({ description: '필드명' })
  field: string;

  @ApiProperty({ description: '이전 값' })
  oldValue: any;

  @ApiProperty({ description: '새 값' })
  newValue: any;
}

